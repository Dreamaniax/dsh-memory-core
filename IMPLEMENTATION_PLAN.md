# DSH Memory Core v0.1 — 实施计划与验收

- 状态：Phase 0/1 已收口；Sprint 1、Sprint 2、Sprint 3、Sprint 4（Cordis 集成与发布准备）已完成；代码/测试/隔离挂载已验证，许可证与公开发布仍待确认
- 原则：小步可验证；每阶段有验收命令、证据、回滚点；不修改无关现有插件
- 依据：docs/PHASE0_INVESTIGATION.md、ARCHITECTURE.md、DATABASE_SCHEMA.md、API_REFERENCE.md

## 1. 阶段总览

| 阶段 | 目标 | 主要产出 | 验收 | 依赖 |
| --- | --- | --- | --- | --- |
| Phase 0 | 环境调查与架构决策 | 调查报告、ADRs、风险清单 | 用户批准 | 无 |
| Phase 1 | 架构/Schema/API 契约 | ARCHITECTURE、DATABASE_SCHEMA、API_REFERENCE | 用户批准 | Phase 0 |
| Sprint 1 | SQLite foundation | Store、Migrator、001 schema、备份、基础测试 | 初始化/持久化/迁移/备份测试通过 | Phase 1 |
| Sprint 2 | CRUD + provenance | Repositories、Manager、API、版本/namespace/来源 | P0 API 与集成测试通过 | Sprint 1 |
| Sprint 3 | Search + feedback | FTS/LIKE、反馈、过期、删除清理、基准 | 搜索/反馈/删除/注入测试 + 10k 基准 | Sprint 2 |
| Sprint 4 | Integration + release | Cordis 插件、DSH 挂载验证、示例、文档、发布清单 | 隔离 DSH_HOME 真实挂载 + 全量测试 + 文档 | Sprint 3 |

## 2. Sprint 1 — SQLite Foundation

### 任务

1. 初始化包：package.json、tsconfig.json、tsconfig.build.json、.gitignore。
2. 建立 src 目录骨架与 errors/clock/fs/constants 工具。
3. 实现 SqliteStore：
   - 打开 DB、目录 0700、文件 0600。
   - PRAGMA foreign_keys=ON、journal_mode=WAL、busy_timeout、synchronous。
   - application_id 校验、user_version 读取。
   - transaction(fn)（BEGIN IMMEDIATE/COMMIT/ROLLBACK、嵌套拒绝、busy 重试）。
   - backupTo（backup()，失败回退 VACUUM INTO；integrity_check）。
   - close/healthCheck。
4. 实现 Migrator：
   - 读取 migrations/NNN_*.sql。
   - schema_migrations、checksum、user_version。
   - 迁移前备份、失败回滚、未来版本拒绝、外来库拒绝。
5. 编写 migrations/001_initial.sql（按 DATABASE_SCHEMA.md）。
6. 测试：
   - 空库初始化；表/索引/触发器/application_id/user_version。
   - 身份：同一 id 在两个 namespace 可共存；同一 namespace 重复 id 被拒绝；跨 namespace 关联被复合外键拒绝。
   - FTS rowid：memory_items.fts_rowid 是显式 INTEGER PRIMARY KEY；VACUUM 后 FTS 仍可查询。
   - 重复打开幂等。
   - 持久化：写入后 close/reopen 仍可读。
   - 外键：跨 namespace 关联被拒绝；父删除级联。
   - 迁移：0->1；模拟 1->2；失败回滚；checksum 不一致；未来版本/外来库拒绝。
   - 备份：在线备份可读；integrity_check ok；恢复副本可查询。
   - working 记忆缺 expires_at 被 CHECK 拒绝；feedback request_hash/长度约束。
7. 写 docs/PHASE0_EVIDENCE.md 的后续更新（记录实际测试输出）。

### 验收命令

~~~bash
export npm_config_cache="$PWD/.tmp/npm-cache"
npm install --no-audit --no-fund
npm run build
node --test tests/integration/database.test.mjs
~~~

### 通过标准

- 上述命令退出码 0。
- 测试覆盖：初始化、持久化、外键、迁移、备份。
- 生成的 DB 在临时目录；无生产数据。
- 失败时不留下半迁移状态；错误信息可操作。

### 回滚点

- 本阶段只新增文件，不改现有 profile/插件。
- 如失败：删除新增的 src/tests/migrations；项目仍未接入 DSH。

## 3. Sprint 2 — CRUD 与来源追踪

### 任务

1. contracts.ts：全部 DTO 与输入类型。
2. validation.ts：zod schema（namespace、UUID、枚举、长度、metadata、ISO 时间、patch）。
3. errors.ts：MemoryError + code + details 脱敏。
4. rows.ts + repositories：
   - memory insert/find/update/softDelete/purge/list/versions（身份键 namespace_id + id）。
   - sources 去重/关联/查询/孤儿清理。
   - feedback 在 Sprint 3 已完成。
5. memory-manager.ts：create/get/list/update/delete/purge 用例与事务。
6. source-service.ts。
7. memory-api.ts：公共门面；所有输入校验；错误映射。
8. 测试：
   - CRUD 全路径；返回类型稳定。
   - namespace 隔离；跨 namespace getMemory 返回 null（不泄露存在性），update/delete/purge 返回 NOT_FOUND。
   - 版本冲突；expectedVersion 缺失/错误。
   - 重复 ID（调用方提供 id）在同一 namespace -> DUPLICATE_ID；不同 namespace 可复用。
   - updateMemory 不允许改 status/confirmedAt/origin；状态只走 feedback/delete/purge。
   - 来源创建/去重/关联/查询；purge 孤儿清理与共享保留。
   - 输入校验：空 namespace、非法类型/状态/置信度/时间、working 缺 expiresAt、超长、未知字段。
   - SQL 注入字符串进入 content/title/tags/namespace，断言库结构完好。
9. 覆盖率目标：核心服务行/函数 >= 80%（Sprint 3 提升到 85%）。

### 验收命令

~~~bash
npm run build
node --test tests/unit tests/integration/crud.test.mjs tests/integration/sources.test.mjs tests/integration/namespace.test.mjs
node --test --experimental-test-coverage tests/unit tests/integration
~~~

### 通过标准

- P0 API（create/get/list/update/delete/addSource/getSources）全部有成功与失败用例。
- 事务失败可回滚；无半条 memory/version/source。
- 错误 details 不含正文。
- 覆盖率报告落盘（coverage/ 或 stdout 摘要）。

### 回滚点

- 本阶段仍不接入真实 profile；测试 DB 全部临时目录。
- 如 API 契约需要调整，先改 docs/API_REFERENCE.md 再改代码。

## 4. Sprint 3 — 搜索、反馈、生命周期

### 任务

1. keyword-search.ts + query-builder.ts：
   - FTS5 trigram MATCH；phrase 引号转义；AND 多词。
   - 短查询 LIKE 回退；%/_/\ 转义。
   - namespace/type/status/expires 过滤；BM25 权重；snippet 去标记。
2. search-service.ts + API searchMemories。
3. feedback-service.ts + feedback repository：
   - confirm/correct/reject/flag；request_id 幂等；version+history 同事务。
   - append-only；UPDATE 触发器拒绝。
4. 过期：isExpired；search 排除；list 可选。
5. 删除：软删除、purge、级联、孤儿 source、搜索排除。
6. FTS 维护：rebuild、integrity-check、迁移后重建。
7. 测试：
   - 英文关键词、中文 2/3/4 字符、混合中英。
   - BM25 排序、type/status/namespace 过滤、分页、total。
   - FTS 与正文同步（insert/update/delete/soft delete/hard delete）。
   - SQL/FTS 注入：引号、NEAR、*、^、:、OR 1=1、DROP TABLE；断言无错误注入。
   - 反馈四种 action；幂等重复；payload 不同冲突；correction 原子性；版本历史。
   - 过期排除；deleted/rejected 默认排除。
   - 10k 基准脚本。
8. 覆盖率目标：核心服务行/函数 >= 85%。

### 验收命令

~~~bash
npm run typecheck
npm run build
npm test
npm run test:coverage
node benchmarks/10k.mjs > .tmp/bench-10k.json
~~~

### 通过标准

- 中文/英文检索用例全部通过；2 字符中文明确走 LIKE 回退。
- 反馈幂等与 correction 版本历史有测试证据。
- FTS integrity-check 通过；重建后结果一致。
- 10k 基准输出 JSON，记录 p50/p95、写入耗时、DB 大小；不设硬性 CI 阈值，但报告中给出基线。

### 实现结果（已完成）

- 搜索：`src/search/query-builder.ts`、`src/search/keyword-search.ts`、`src/core/search-service.ts`；FTS trigram + 短查询 LIKE 回退，BM25 title 5/content 1/tags 2，type/status/namespace/expiry 过滤。
- 反馈：`src/core/feedback-service.ts`、`src/repositories/feedback-repository.ts`；四种 action、requestHash 幂等、版本快照与反馈同事务、软删除历史、purge 级联。
- 版本写入抽到 `src/core/version-writer.ts`，MemoryManager 与 FeedbackService 共用。
- 验证：43 项测试通过；整体 lines 95.75%、branches 84.79%、functions 94.63%；核心 service 行/函数均 >=85%。
- 10k 基准已落盘到 `docs/SPRINT3_REPORT.md`：10,000 条记忆，创建 p50 0.346ms / p95 1.966ms，搜索 p50 6.121ms / p95 23.492ms，DB 118,390,784 bytes（FTS 52,445,184 bytes）。
- 无新增迁移；复用 001 schema 的 memory_feedback、memory_versions、memory_fts。

### 回滚点

- 不修改现有插件；不部署到真实 profile。
- 如果 trigram 方案不达预期，保留 LIKE 回退路径；v0.2 再评估双索引/分词。

## 5. Sprint 4 — 集成与发布

### 任务

1. plugin.ts：Cordis Service（memoryCore），Config、inject、Service.init、close effect。
2. package exports：根 library 与 ./plugin；cordis.patch.yml。
3. 真实 DSH 挂载验证：
   - 临时 DSH_HOME；复制/链接 web profile；安装本包到临时 profile node_modules。
   - patch 插入 memory-core + 测试探针插件（fixture，不属于生产包）。
   - 启动 dsh --profile web --patch ... --no-open --port ...。
   - 探针路由调用 ctx.memoryCore 创建/搜索/关闭；curl 断言。
4. 示例：
   - examples/weekly-retro：读取周报产物，写入 episodic/procedural 记忆并搜索。
   - examples/prompt-optimizer：写入 procedural 记忆，提交 confirm/correct 反馈。
   - 示例只依赖公共 API，不导入内部实现；不修改现有插件。
5. 文档：README、ARCHITECTURE、DATABASE_SCHEMA、API_REFERENCE、IMPLEMENTATION_PLAN、SECURITY_PRIVACY、ADRs、限制与 v0.2 backlog。
6. 发布清单：版本、files 字段、许可证、peerDependencies、npm pack 内容检查。
7. 可选：性能报告、备份恢复演练记录。

### 验收命令

~~~bash
npm run build
node --test tests/unit tests/integration
bash tests/integration/dsh-boot-verify.sh
node examples/weekly-retro/ingest.mjs --selftest
node examples/prompt-optimizer/ingest.mjs --selftest
npm pack --dry-run
~~~

### 通过标准

- 隔离 DSH_HOME 启动成功；探针路由证明 ctx.memoryCore 可用；日志无插件激活错误。
- 示例在临时 DB 上可重复运行。
- npm pack 包含 lib、migrations、docs、cordis.patch.yml；不包含 tests 临时数据。
- 无现有插件文件被修改（git diff 证明）。

### 回滚点

- 所有集成测试使用临时 DSH_HOME，不碰真实 profile。
- 如果 loader 不支持 ./plugin 子路径，回退：根入口改为插件、库入口改为 ./core，或增加 wrapper 包；先改 ADR/文档再改代码。

### 实现结果（已完成）

- 入口：根 Library 入口保留；新增 `./plugin` 与 `cordis.patch.yml`；默认 DB `$DSH_HOME/memory-core/memory.sqlite3`。
- 挂载：`bash tests/integration/dsh-boot-verify.sh` exit 0；隔离 DSH_HOME 中 probe 通过 `ctx.memoryCore` 完成 create/get/search/feedback/close，重启读取同一 memoryId，干净关闭无 WAL/SHM；测试未写入真实 profile。
- 示例：`node examples/weekly-retro/ingest.mjs --selftest`、`node examples/prompt-optimizer/ingest.mjs --selftest` 均 exit 0。
- 包审计：`npm pack --dry-run` 138 files / 约 125.6 KB packed；无 DB/tests/临时数据/密钥。
- 测试：47/47 通过；lines 95.80%、branches 85.07%、functions 94.72%。
- 仍未完成：License 决策、tarball 安装门禁、npm 发布、Windows 验证、备份加密/保留策略、仓库历史中的本机路径清理（公开前）。详见 docs/SPRINT4_REPORT.md。

## 6. 测试矩阵（映射用户 11 项要求）

| # | 要求 | 测试文件 | 关键断言 |
| --- | --- | --- | --- |
| 1 | Database initialization | tests/integration/database.test.mjs | 表/索引/触发器/app_id/user_version；重复打开幂等 |
| 2 | CRUD operations | tests/integration/memory-api.test.mjs | create/get/list/update/delete 返回值与状态 |
| 3 | Foreign-key integrity | tests/integration/database.test.mjs, memory-api.test.mjs | 跨 namespace 拒绝；级联删除 |
| 4 | Keyword search | tests/integration/search.test.mjs, tests/unit/query-builder.test.mjs | 英文/中文 2/3/4 字符/混合/过滤/排序/分页/snippet |
| 5 | Duplicate ID handling | tests/integration/memory-api.test.mjs | 同 namespace 重复 id -> DUPLICATE_ID；不同 namespace 可复用 |
| 6 | Memory state transitions | tests/integration/memory-api.test.mjs, feedback.test.mjs | update 不改 status；confirm/correct/reject/flag 矩阵；非法迁移 |
| 7 | User feedback | tests/integration/feedback.test.mjs | 四种 action；requestHash 幂等/冲突；版本快照；软删除历史 |
| 8 | Persistence across restarts | tests/integration/database.test.mjs, memory-api.test.mjs, feedback.test.mjs | close/reopen 后记忆/版本/来源/反馈仍在 |
| 9 | Database migrations | tests/integration/migrations.test.mjs | 升级/失败回滚/checksum/未来版本 |
| 10 | Invalid inputs & SQL injection | tests/integration/memory-api.test.mjs, search.test.mjs | 拒绝 + FTS/LIKE 特殊字符不执行 + 库结构完好 |
| 11 | Deletion and cleanup | tests/integration/memory-api.test.mjs, search.test.mjs, feedback.test.mjs | 软删除；purge token/级联、孤儿 source、搜索排除、反馈级联 |

## 7. 风险登记与缓解

| 风险 | 概率 | 影响 | 缓解 |
| --- | --- | --- | --- |
| node:sqlite 仍为 Experimental，API 变化 | 中 | 中 | 薄驱动层；引擎 Node >=22.19；升级前跑全量测试 |
| trigram 对 <3 字符中文无效 | 高 | 中 | LIKE 回退 + 文档；测试覆盖；v0.2 分词/双索引 |
| FTS 索引与正文不一致 | 中 | 高 | 触发器 + integrity-check + rebuild + 测试 |
| 跨进程写冲突 | 中 | 中 | WAL + busy_timeout + BEGIN IMMEDIATE + 重试 + version 乐观锁 |
| 同步 SQLite 阻塞宿主事件循环 | 中 | 中 | 查询限界、索引、短事务；10k 基准；未来 worker 化 |
| 迁移失败/数据损坏 | 低 | 高 | 迁移前备份、事务回滚、fail-closed、恢复文档 |
| purge 与备份残留冲突 | 高 | 中 | 文档明示；备份保留策略；未来安全擦除方案 |
| namespace 被误当鉴权 | 中 | 高 | 文档/API 明示；未来多租户另做授权 |
| loader 不支持子路径入口 | 低 | 中 | Sprint 4 真实挂载；回退 wrapper/根入口方案 |
| Windows 路径/权限差异 | 中 | 中 | CI/实机验证；使用 path.join；避免 WAL 网络盘 |
| 覆盖率达 85% 成本高 | 中 | 低 | 先覆盖核心服务；排除类型/纯 DTO；分阶段提升 |
| 隐私正文进入日志/错误 | 中 | 高 | 统一 logger 脱敏；错误 details 白名单；测试断言 |

## 8. 交付物映射

| 交付物 | 阶段 | 文件 |
| --- | --- | --- |
| 环境调查报告 | Phase 0 | docs/PHASE0_INVESTIGATION.md, docs/PHASE0_EVIDENCE.md |
| 架构设计 | Phase 1 | ARCHITECTURE.md |
| ADRs | Phase 1 | docs/adr/*.md |
| SQLite schema | Phase 1/2 | DATABASE_SCHEMA.md, migrations/001_initial.sql |
| Memory API 实现 | Sprint 2/3（完成） | src/api, src/core, src/repositories |
| 自动化测试 | Sprint 1-3 | tests/unit, tests/integration |
| 文档 | Sprint 4 | README.md, API_REFERENCE.md, SECURITY_PRIVACY.md |
| Demo 集成 | Sprint 4 | examples/weekly-retro, examples/prompt-optimizer |
| 容量与演进 | Phase 1 | docs/CAPACITY_AND_EVOLUTION.md |
| Phase 1 收口 | Phase 1 | docs/PHASE1_CLOSEOUT.md |
| 限制与 v0.2 | Sprint 4 | README.md 的 Limitations / v0.2 backlog |

## 9. v0.2 Backlog（明确不在 v0.1）

### 长期存储与压缩方向（2026-11-14 补充）

新增讨论采用“认知启发、AI 原生”的方向：保留可核查的来源与版本，让情景记忆逐步形成候选知识；存储压缩、检索降权、归档和永久删除是不同操作。v0.1 仍以可靠的 SQLite/FTS5 基础为交付边界，不在 Sprint 1 添加自动摘要、巩固引擎、记忆链接或向量检索。

容量与演进设计已落盘：**docs/CAPACITY_AND_EVOLUTION.md**。该文档列出库文件、WAL、FTS、版本快照、来源、反馈和备份的增长项；按低/中/高使用情景给出十年容量公式与区间；说明原始证据/情景事件/派生知识的分离与来源可追溯；评估 derived_from、related_to、supersedes、supports 的迁移路径；记录检索隐藏、可恢复归档、永久删除对索引/版本/来源/备份的影响。所有数字均为情景估算，不是实测。

未来依次评估：存储统计与备份成本；内容哈希去重和无损归档；有来源支撑且需用户确认的候选巩固；冲突/替代关系；按任务和 token 预算构造上下文。用相同数据集比较检索准确性、证据可追溯性、字节数、延迟和 token 消耗，避免仅以压缩率决定方案。

1. 中文分词/双 FTS 索引（unicode61 + trigram）或 jieba 预分词。
2. 向量检索与 embedding（可选、可插拔）。
3. 自动 LLM 抽取与候选生成。
4. 记忆合并/去重/consolidation。
5. 多 agent/多机同步与冲突解决。
6. 恢复已删除记忆、版本回滚 API。
7. 多租户认证/授权。
8. 管理 UI/HTTP API/LLM tools。
9. 加密备份、安全擦除、保留策略自动化。
10. 后台维护任务（过期清理、索引重建、完整性巡检）。

## 10. 审批清单（Sprint 1 前必须确认）

请逐项确认或修改：

1. 语言/运行时：TypeScript + ESM + Node >=22.19；tsc 构建；node:test 测试。
2. SQLite 驱动：node:sqlite；不引入 better-sqlite3/原生模块。
3. 集成模型：进程内 Cordis Service（memoryCore）+ 可独立导入 Library；无 HTTP/IPC。
4. 默认数据目录：$DSH_HOME/memory-core/memory.sqlite3；支持配置覆盖。
5. 六表 schema；身份是 (namespace_id, id)，不同 namespace 可复用 id；软删除默认、purge 显式 token。
6. FTS：单 trigram 索引 + <3 字符 LIKE 回退；BM25；不引入向量。
7. createMemory 默认 candidate；update 不改 status，状态只走 feedback/delete/purge。
8. purge 级联 feedback/versions、清理孤儿 source、备份可能保留已删内容。
9. namespace 只是隔离，不是认证。
10. 包名/入口：dsh-memory-core + ./plugin；不修改现有插件，示例独立。
11. 测试目标：node:test 全量通过；核心覆盖 >=85%；10k 基准报告。
12. 迁移失败 fail-closed、迁移前备份、保留 3 份、不自动重建。
13. 运行时依赖：仅 zod ^4.4（宿主已有 4.4.3，用于输入校验）；开发依赖仅 typescript 5.9.3 与 @types/node 24.x；node:sqlite 为内置，无原生模块。
14. 包管理：独立仓库用 npm + package-lock.json；安装进 DSH profile 时用 pnpm（DSH 内置 11.28.5）。
15. 身份作用域：namespace-scoped (namespace_id, id)；不同 namespace 可复用 id（ADR 0008）。
16. 状态/删除：update 不改 status；deleteMemory 只软删；purgeMemory 独立 token（ADR 0009）。

## 11. 当前状态

- Phase 0 调查：完成（文档已落盘）。
- Phase 1 架构/Schema/API：收口完成（ADR 0008/0009，契约一致）。
- Sprint 1：**完成**。SqliteStore、迁移、001 Schema、备份、13 项测试通过；详见 docs/SPRINT1_REPORT.md。
- Sprint 2：**完成**。contracts/validation/errors、repositories、MemoryManager、MemoryApi、来源追踪、namespace 隔离、版本快照、软删除/purge；23 项集成测试通过；详见 docs/SPRINT2_REPORT.md。
- Sprint 3：**完成**。FTS5 trigram + 短查询 LIKE 回退、BM25、snippet、type/status/namespace/expiry 过滤；confirm/correct/reject/flag、requestHash 幂等、版本快照同事务、软删除历史、purge 级联；43 项测试通过；详见 docs/SPRINT3_REPORT.md。
- Sprint 4：**完成（发布准备）**。Cordis `memoryCore` Service、`./plugin`、`cordis.patch.yml`、隔离 DSH_HOME 真实挂载、两个独立示例、npm pack 审计；47 项测试通过；详见 docs/SPRINT4_REPORT.md。
- 生产代码：CRUD + provenance + search/feedback + DSH Service 可用。
- 自动化测试：47 项通过；整体 lines 95.80%、branches 85.07%、functions 94.72%；核心 service 行/函数 >=85%。
- 下一步：License 决策、公开/发布审计（历史路径、文件模式、Windows）、v0.2 backlog。
