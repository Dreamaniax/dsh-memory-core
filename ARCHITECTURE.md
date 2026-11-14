# DSH Memory Core v0.1 — 架构设计

- 状态：Phase 1 收口；Sprint 1 storage foundation、Sprint 2 CRUD/provenance 已实现（docs/SPRINT1_REPORT.md、docs/SPRINT2_REPORT.md）；Sprint 3 search/feedback 待实施
- 依据：docs/PHASE0_INVESTIGATION.md
- 范围：Local-first、进程内、SQLite + FTS5、无 LLM/网络依赖

## 1. 目标与非目标

### 目标

1. 为 DSH 插件提供可复用的长期记忆基础设施，多个插件不重复实现存储。
2. 支持 semantic / episodic / procedural / working 四类记忆（working 由调用方决定是否持久化）。
3. 支持来源追踪、生命周期状态、版本历史、用户反馈、关键词检索。
4. 所有核心能力离线可用；不依赖 LLM、embedding、向量库或外部 API。
5. 单进程内共享一个 Memory Service；同时保留纯 Library 供测试、CLI 和非 DSH 场景使用。
6. 数据跨进程重启持久；迁移/备份/恢复可验证。

### 非目标（v0.1）

- 向量检索、embedding 生成。
- 自动 LLM 记忆抽取、自动 consolidation。
- 多 agent/多机分布式同步。
- 复杂用户画像。
- 独立 HTTP 服务或跨进程 IPC。
- 认证/授权系统；namespace 只是数据隔离，不是安全边界。
- 完整的管理 UI。

## 2. 系统上下文

~~~text
DSH host process (Cordis Context)
┌─────────────────────────────────────────────────────────────┐
│  Weekly Retro        Prompt Optimizer       Future plugins  │
│      │                     │                       │        │
│      └───────────┬─────────┴───────────┬───────────┘        │
│                  │ ctx.memoryCore      │                    │
│         ┌────────▼─────────────────────▼────────┐           │
│         │        DSH Memory Core Service       │           │
│         │  Public API → Manager → Search        │           │
│         │  Repositories → SQLite Store          │           │
│         └────────────────┬─────────────────────┘           │
│                          │ node:sqlite                      │
│                 $DSH_HOME/memory-core/memory.sqlite3         │
└─────────────────────────────────────────────────────────────┘
~~~

浏览器 client 插件不直接访问 Memory Core；如果未来需要展示记忆，宿主插件通过自有 HTTP 路由或 client 半读取，不把 SQLite 暴露给浏览器。

## 3. 分层架构

### 3.1 Public Memory API

职责：

- 稳定、类型化的方法契约（createMemory/getMemory/listMemories/updateMemory/deleteMemory/purgeMemory/searchMemories/addSource/getSources/submitFeedback/getFeedbackHistory/getMemoryVersions）。
- 输入校验（zod schema + 业务约束）。
- namespace 必填与边界检查。
- 统一错误映射（MemoryError code）。
- 返回可预测的 DTO；不返回数据库行、不暴露 SQL。

明确不负责：事务编排、SQL、FTS 语法、文件/连接生命周期。

### 3.2 Memory Manager

职责：

- 用例编排：创建/读取/更新/删除/搜索/反馈。
- 状态机与版本控制：expectedVersion、version++、memory_versions 快照。
- 事务边界：一个用例一个事务；跨表写入原子。
- 来源关联、反馈幂等、软删除与独立 purge 策略。
- 时钟、ID、审计字段注入。

### 3.3 Domain Services

- **MemoryService**：记忆内容、类型、状态、过期、版本。
- **SourceService**：来源去重、关联、清理。
- **SearchService**：查询规范化、FTS/LIKE 选择、过滤、排序、分页、摘要。
- **FeedbackService**：confirm/correct/reject/flag、幂等、版本联动。

领域服务不直接拼接 SQL；通过 Repository 接口访问数据。

### 3.4 Repository + Transaction Layer

- **MemoryRepository**：memory_items / memory_versions 的参数化 SQL。
- **SourceRepository**：sources / memory_sources。
- **FeedbackRepository**：memory_feedback。
- **UnitOfWork**：transaction(fn)、BEGIN IMMEDIATE、COMMIT/ROLLBACK、busy 重试。
- Repository 只做数据映射；业务规则在 Manager/Services。

### 3.5 SQLite Storage Layer

- **SqliteStore**：打开/关闭连接、PRAGMA、application_id、迁移、备份、健康检查。
- **Migrator**：版本化 SQL、checksum、schema_migrations、user_version。
- **SqliteErrors**：SQLite 错误码到 MemoryError 的映射。

驱动隔离：其余层只依赖 DatabaseSync 的薄接口或 Repository 接口；未来替换驱动时业务层不变。

### 3.6 Search Layer

- **KeywordSearch**：FTS5 trigram 主路径；短查询 LIKE 回退。
- **FtsQueryBuilder**：把用户输入变成安全的 FTS5 phrase；绝不让用户输入成为 SQL 语法。
- **SnippetBuilder**：FTS snippet 或 LIKE 截断；输出去标记的纯文本。
- **SearchIndexMaintenance**：rebuild、integrity-check、迁移后重建。

### 3.7 Cordis Plugin Adapter

- 一个宿主进程只挂载一个 Memory Core Service。
- Service 名：**memoryCore**。
- 生命周期：插件激活时打开库并迁移；ctx.effect 在卸载时 close。
- 配置：path、journalMode、busyTimeoutMs、synchronous、autoMigrate、backupBeforeMigrate、limits。
- 失败策略：打开/迁移失败让插件激活失败，不静默降级到内存库。

## 4. 关键接口

### 4.1 公共 API

~~~ts
interface MemoryApi {
  createMemory(input: CreateMemoryInput): Promise<Memory>
  getMemory(input: GetMemoryInput): Promise<Memory | null>
  listMemories(input: ListMemoriesInput): Promise<Page<Memory>>
  updateMemory(input: UpdateMemoryInput): Promise<Memory>
  deleteMemory(input: DeleteMemoryInput): Promise<void>
  purgeMemory(input: PurgeMemoryInput): Promise<void>
  searchMemories(input: SearchMemoriesInput): Promise<Page<SearchHit>>
  addSource(input: AddSourceInput): Promise<Source>
  getSources(input: GetSourcesInput): Promise<Source[]>
  submitFeedback(input: SubmitFeedbackInput): Promise<FeedbackResult>
  getFeedbackHistory(input: GetFeedbackHistoryInput): Promise<Page<Feedback>>
  getMemoryVersions(input: GetMemoryVersionsInput): Promise<Page<MemoryVersion>>
  backupTo(path: string): Promise<BackupResult>
  healthCheck(): Promise<HealthReport>
  close(): Promise<void>
}
~~~

详细字段与错误码见 API_REFERENCE.md。

### 4.2 Repository 接口（示意）

~~~ts
interface MemoryRepository {
  insert(item: MemoryRow, tx: Tx): void
  findById(namespaceId: string, id: string, tx?: Tx): MemoryRow | null
  update(item: MemoryRow, expectedVersion: number, tx: Tx): boolean
  softDelete(namespaceId: string, id: string, expectedVersion: number, now: number, tx: Tx): boolean
  purge(namespaceId: string, id: string, tx: Tx): boolean
  list(query: ListQuery, tx?: Tx): { rows: MemoryRow[]; total: number }
  insertVersion(version: MemoryVersionRow, tx: Tx): void
  listVersions(namespaceId: string, memoryId: string, tx?: Tx): MemoryVersionRow[]
}
~~~

### 4.3 Store 接口（示意）

~~~ts
interface SqliteStore {
  readonly db: DatabaseSync
  transaction<T>(fn: (tx: Tx) => T): T
  migrate(): MigrationReport
  backupTo(path: string): Promise<void>
  healthCheck(): HealthReport
  close(): Promise<void>
}
~~~

## 5. 关键数据流

### 5.1 createMemory

1. API 校验 namespace/type/content/status/sources；身份是 (namespaceId, id)。
2. 生成 UUID、now、version=1；同一 namespace 内查重，其他 namespace 允许相同 id。
3. BEGIN IMMEDIATE。
4. 插入 memory_items（fts_rowid 由 SQLite 生成）。
5. 插入 memory_versions（change_type=create，snapshot_json，content_hash）。
6. 解析/创建 sources，插入 memory_sources。
7. COMMIT。
8. 返回 Memory DTO。

任何一步失败：ROLLBACK；不留下半条记忆、半条来源。

### 5.2 updateMemory

1. 校验 expectedVersion 与 patch；patch 不允许 status/confirmedAt/deletedAt/origin/id/namespace/version。
2. BEGIN IMMEDIATE。
3. 读当前行；不存在或 namespace 不匹配 -> NOT_FOUND；已删除 -> MEMORY_DELETED。
4. 版本不等 -> VERSION_CONFLICT。
5. 应用内容字段 patch；version++；updated_at=now。
6. UPDATE ... WHERE namespace_id=? AND id=? AND version=expectedVersion。
7. 插入 memory_versions（change_type=update）。
8. COMMIT；FTS 触发器按 fts_rowid 同步索引。

### 5.3 searchMemories

1. 校验 namespace/query/filters/limit/offset。
2. 规范化 query；判断长度/字符集。
3. 选择 FTS 或 LIKE 回退。
4. 构造参数化 SQL：JOIN memory_items，过滤 namespace/status/type/expires。
5. 排序：FTS 用 BM25（权重 title 5/content 1/tags 2），回退用 updated_at。
6. 分页 + 总数；生成 snippet。
7. 返回 SearchHit（不暴露 SQLite 行）。

### 5.4 submitFeedback

1. 校验 action/requestId/expectedVersion/patch；correct 必须有 patch，其他 action 禁止 patch。
2. BEGIN IMMEDIATE。
3. 查 (namespace, request_id)：存在且 request_hash 相同 -> 返回 existing + duplicate=true；hash 不同 -> IDEMPOTENCY_CONFLICT。
4. 读 memory；不存在/已删 -> 对应错误；新请求校验 expectedVersion。
5. 校验 action 与状态迁移；应用修改；只有内容/状态/confirmedAt 实际变化时才 version++。
6. 插入 memory_versions（如变化）；插入 memory_feedback（append-only，含 request_hash）。
7. COMMIT。
8. 返回 FeedbackResult（feedback + 最新 memory）。

### 5.5 deleteMemory / purgeMemory

- 软删除 deleteMemory：status=deleted、deleted_at=now、version++、版本快照；保留 versions/sources/feedback；搜索默认排除；要求 expectedVersion。
- 永久删除 purgeMemory：独立特权操作，要求 expectedVersion + confirmationToken=PURGE:<namespace>:<id>；DELETE memory_items；级联删除 versions/memory_sources/feedback；清理 auto_created 且无其他引用的 sources；保留共享 sources；不写版本。
- 备份中可能仍包含已删除内容；purge 不等于历史备份擦除，文档必须明示。
- 状态变更只走 createMemory 初始值、submitFeedback、deleteMemory/purgeMemory；updateMemory 不修改状态。

## 6. 进程内集成模型

### 6.1 为什么是 Service 而不是每个插件一个 Store

- 避免多个连接/多个迁移器竞争同一个 DB。
- 统一生命周期与关闭；避免插件卸载后连接泄漏。
- 统一配置、备份、健康检查。
- 消费者只依赖 ctx.memoryCore，不复制存储代码。

### 6.2 消费者用法

~~~ts
ctx.inject(['memoryCore'], (ctx) => {
  const memory = ctx.memoryCore
  // await memory.createMemory(...)
})
~~~

### 6.3 纯 Library 用法

~~~ts
import { openMemoryCore } from 'dsh-memory-core'

const core = await openMemoryCore({ path: '/tmp/memory.sqlite3' })
await core.createMemory({ namespaceId: 'weekly-retro', type: 'episodic', content: '...' })
await core.close()
~~~

Library 模式适合测试、CLI、迁移工具；生产插件应使用 Service，以确保单实例与生命周期。

## 7. 目录结构

~~~text
dsh-memory-core/
├── src/
│   ├── index.ts                     # Library 公共导出
│   ├── plugin.ts                    # Cordis Service 适配器
│   ├── api/
│   │   ├── memory-api.ts            # 公共 API 门面
│   │   ├── contracts.ts             # 输入/输出 DTO
│   │   ├── validation.ts            # zod schema
│   │   └── errors.ts
│   ├── core/
│   │   ├── memory-manager.ts        # 用例编排/事务
│   │   ├── memory-service.ts
│   │   ├── source-service.ts
│   │   ├── feedback-service.ts
│   │   ├── search-service.ts
│   │   └── memory-types.ts
│   ├── repositories/
│   │   ├── memory-repository.ts
│   │   ├── source-repository.ts
│   │   ├── feedback-repository.ts
│   │   └── rows.ts
│   ├── storage/
│   │   ├── constants.ts
│   │   ├── sqlite-store.ts
│   │   ├── migrations.ts
│   │   └── sqlite-errors.ts
│   ├── search/
│   │   ├── keyword-search.ts
│   │   └── query-builder.ts
│   └── utils/
│       ├── clock.ts
│       ├── fs.ts
│       ├── ids.ts
│       └── json.ts
├── migrations/
│   └── 001_initial.sql
├── tests/
│   ├── integration/
│   ├── unit/
│   ├── fixtures/
│   └── helpers/
├── benchmarks/
│   └── 10k.mjs
├── examples/
│   ├── weekly-retro/
│   └── prompt-optimizer/
├── docs/
│   ├── PHASE0_INVESTIGATION.md
│   ├── PHASE0_EVIDENCE.md
│   ├── SECURITY_PRIVACY.md
│   └── adr/
├── ARCHITECTURE.md
├── DATABASE_SCHEMA.md
├── API_REFERENCE.md
├── IMPLEMENTATION_PLAN.md
├── README.md
├── package.json
├── tsconfig.json
├── tsconfig.build.json
└── cordis.patch.yml
~~~

与最初建议的 memory-store.test.ts / memory-search.test.ts 对应关系：测试按能力拆到 tests/integration 与 tests/unit，避免单文件过大；文件名可保留 database.test.mjs、crud.test.mjs、search.test.mjs 等。

## 8. 事务、并发与失败模型

### 8.1 连接

- 每个 Service 一个 DatabaseSync 连接。
- PRAGMA：foreign_keys=ON、journal_mode=WAL（可配置）、busy_timeout=5000、synchronous=NORMAL（可配置）。
- 所有写事务用 BEGIN IMMEDIATE，避免读事务升级写锁导致 BUSY。
- 事务内不 await 外部 I/O；不做长事务。

### 8.2 并发

- 进程内：JS 单线程 + 写队列串行化；读操作短小。
- 跨进程：WAL 允许读写并发；写写冲突由 busy_timeout + 有限重试处理；仍冲突则 STORAGE_BUSY。
- 乐观并发：version 字段防止 last-writer-wins 覆盖；冲突返回 VERSION_CONFLICT。
- 不提供跨进程内存缓存；DB 是唯一事实源。

### 8.3 失败

- 打开失败/迁移失败：插件激活失败，不降级到 :memory:（除非显式配置 :memory: 用于测试）。
- SQLITE_CORRUPT / integrity_check 失败：拒绝继续写，提示恢复备份。
- 事务失败：ROLLBACK；错误映射；不吞错。
- close 后调用：CLOSED。

## 9. 安全与隐私边界

- 所有值参数化绑定；动态 SQL 只允许固定列名/排序白名单。
- 输入校验拒绝 NUL、超长、非法枚举、非法 UUID、非法 ISO 时间。
- namespace 只做隔离；不宣称认证。
- 默认不记录正文；日志只记录 code/namespace/id 哈希/耗时。
- 错误 details 不含 content；不把 SQL 原文返回给调用方。
- DB 文件 0600、目录 0700；备份同样。
- 不联网；不写遥测。
- purgeMemory 不清理历史备份；文档明示，提供备份保留/清理策略。

## 10. 决策记录

见 docs/adr/：

- 0001 TypeScript + ESM + tsc
- 0002 node:sqlite
- 0003 进程内 Service + Library
- 0004 FTS5 trigram + LIKE 回退
- 0005 迁移与备份
- 0006 namespace + 软删除
- 0007 包入口与分发
- 0008 namespace-scoped identity
- 0009 状态只走反馈 + 软/永久删除分离

## 11. 依赖决策

| 依赖 | 类型 | 用途 | 是否可避免 |
| --- | --- | --- | --- |
| node:sqlite | Node 内置 | SQLite/FTS5 | 否（核心） |
| zod ^4.4 | runtime | API 输入校验 | 可手写，但不建议；宿主已有 4.4.3 |
| @deepseek-ai/cordis | peer | Service/插件生命周期 | 否（仅 plugin 入口） |
| @deepseek-ai/schemastery | peer | 插件 Config schema | 否（仅 plugin 入口） |
| typescript 5.9.3 | dev | 编译 | 否 |
| @types/node 24.x | dev | node:sqlite 等类型 | 否 |

不引入：better-sqlite3、sql.js、vitest、tsdown、ORM、HTTP 框架、向量库。

## 12. 待批准 / 已收口

已在本轮收口：

- 身份：namespace-scoped (namespace_id, id)；不同 namespace 可复用 id（ADR 0008）。
- 状态：updateMemory 不改 status；状态只走反馈与 delete/purge（ADR 0009）。
- 删除：deleteMemory 只软删除；purgeMemory 独立特权操作。
- FTS：显式 fts_rowid，避免 VACUUM 破坏 external content。
- 反馈：request_hash 幂等；correct 必须 patch；working 必须有 expiresAt。

仍需你确认的产品取舍（不阻塞 Sprint 2；Sprint 3/4 可继续）：

1. 备份保留 3 份、是否加密。
2. 归档/降权的默认阈值（v0.2，不在 v0.1）。
3. 跨 namespace 关系是否需要（v0.2 关系表设计）。
4. createMemory 是否要支持“同 id + 同 payload 幂等返回”（v0.1 目前是 DUPLICATE_ID）。
5. 分页是否在 v0.2 改为 opaque cursor（v0.1 用 offset）。

完整审批清单见 IMPLEMENTATION_PLAN.md 第 10 节。