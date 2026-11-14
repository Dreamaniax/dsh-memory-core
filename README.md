# DSH Memory Core

Reusable, local-first long-term memory infrastructure for the DSH plugin ecosystem.

> 状态：Phase 0/1 契约已收口；Sprint 1（SQLite foundation）与 Sprint 2（CRUD + provenance）已实现，23 项集成测试通过。
> 当前可运行范围：SQLite Store、迁移、001 Schema、备份、健康检查、namespace-scoped CRUD/版本/软删除/purge、来源追踪。search/feedback/Cordis 插件仍在 Sprint 3/4。

## 为什么

DSH 插件（Weekly Retro、Prompt Optimizer、未来的 research/workflow agents）都需要长期记忆：semantic / episodic / procedural、来源追踪、生命周期、用户反馈、关键词检索。每个插件各写一套 JSON/SQLite 会重复实现存储、迁移、备份与安全边界。

Memory Core 提供一个共享的进程内服务与可独立导入的库：

- **Local-first**：无网络、无 LLM API、无向量库。
- **Plugin-agnostic**：不依赖任何消费方业务代码。
- **Traceable**：来源、版本、反馈、审计。
- **Controlled mutation**：校验、事务、乐观并发、软删除与独立 purge。
- **Replaceable storage**：消费者只用公共 API，不碰 SQLite。

## v0.1 范围

- SQLite + FTS5（node:sqlite）。
- 六张业务表：memory_items、memory_versions、sources、memory_sources、memory_feedback、memory_fts。
- 四类记忆：working / semantic / episodic / procedural。
- 状态：candidate / active / flagged / rejected / deleted；过期由 expires_at 计算。
- 来源：direct / inferred / imported + sources 多对多。
- 反馈：confirm / correct / reject / flag；request_id 幂等；版本历史。
- API（Sprint 2 已实现）：createMemory、getMemory、listMemories、updateMemory、deleteMemory、addSource、getSources、getMemoryVersions、backupTo、healthCheck、close。
- API（Sprint 3）：searchMemories、submitFeedback、getFeedbackHistory。
- Library 工厂已可用；进程内 Cordis Service（memoryCore）在 Sprint 4 接线。

明确不做：向量库、embedding、自动 LLM 抽取、自动 consolidation、多机同步、复杂用户画像、HTTP 服务。

## 架构速览

~~~text
Consumer plugins
      │ ctx.memoryCore
┌─────▼──────────────────────────────┐
│ Memory API (validation/errors)     │
│ Memory Manager (use cases/tx)      │
│ Services (memory/source/search/    │
│           feedback)                │
│ Repositories (parameterized SQL)   │
│ SQLite Store + Migrator + FTS5     │
└─────┬──────────────────────────────┘
      │ node:sqlite
$DSH_HOME/memory-core/memory.sqlite3
~~~

## 文档

- [Phase 0 环境调查报告](docs/PHASE0_INVESTIGATION.md)
- [Phase 0 证据日志](docs/PHASE0_EVIDENCE.md)
- [架构设计](ARCHITECTURE.md)
- [数据库 Schema](DATABASE_SCHEMA.md)
- [API 契约](API_REFERENCE.md)
- [安全与隐私](docs/SECURITY_PRIVACY.md)
- [容量与演进](docs/CAPACITY_AND_EVOLUTION.md)
- [Phase 1 收口报告](docs/PHASE1_CLOSEOUT.md)
- [Sprint 1 实施报告](docs/SPRINT1_REPORT.md)
- [Sprint 2 实施报告](docs/SPRINT2_REPORT.md)
- [实施计划与验收](IMPLEMENTATION_PLAN.md)
- ADRs：
  - [0001 TypeScript ESM](docs/adr/0001-typescript-esm.md)
  - [0002 node:sqlite](docs/adr/0002-node-sqlite.md)
  - [0003 进程内 Service + Library](docs/adr/0003-in-process-service.md)
  - [0004 FTS5 trigram](docs/adr/0004-fts5-trigram.md)
  - [0005 迁移与备份](docs/adr/0005-migrations-backup.md)
  - [0006 namespace 与删除](docs/adr/0006-namespace-deletion.md)
  - [0007 包入口](docs/adr/0007-package-entries.md)
  - [0008 namespace-scoped identity](docs/adr/0008-identity-scope.md)
  - [0009 状态/删除分离](docs/adr/0009-mutation-and-purge.md)

## 待批准的关键决策

1. TypeScript + ESM + Node >=22.19；tsc 构建；node:test 测试。
2. node:sqlite 驱动；不引入原生模块。
3. 进程内 Cordis Service + Library；v0.1 无 HTTP/IPC。
4. 默认路径 $DSH_HOME/memory-core/memory.sqlite3。
5. 六表 schema；身份是 (namespaceId, id)，不同 namespace 可复用 id。
6. FTS5 trigram + <3 字符 LIKE 回退；无向量。
7. createMemory 默认 candidate；update 不改 status，状态只走 feedback/delete/purge。
8. deleteMemory 只软删除；purgeMemory 独立特权 token；purge 级联 versions/feedback，备份可能保留已删内容。
9. namespace 只是隔离，不是认证。
10. 包名 dsh-memory-core + ./plugin 入口；不修改现有插件。

完整审批清单见 [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) 第 10 节。

## 用法

Sprint 2 已可通过库工厂使用；Cordis 插件入口在 Sprint 4 接线。

独立脚本/测试：

~~~ts
import { openMemoryCore } from 'dsh-memory-core'

const core = await openMemoryCore({ path: '/tmp/memory.sqlite3' })
const memory = await core.createMemory({
  namespaceId: 'weekly-retro',
  type: 'episodic',
  status: 'active',
  content: '2026-W46：周报采集被 npm 网络阻塞。',
  sources: [{ type: 'plugin', externalRef: 'weekly-retro/run-1' }],
})
const page = await core.listMemories({ namespaceId: 'weekly-retro' })
console.log(page.total, memory.id)
await core.close()
~~~

DSH 插件（Sprint 4 接线后）：

~~~ts
ctx.inject(['memoryCore'], (ctx) => {
  const memory = ctx.memoryCore
  // await memory.createMemory(...)
})
~~~

## 开发命令

~~~bash
export npm_config_cache="$PWD/.tmp/npm-cache"
npm install --no-audit --no-fund
npm run typecheck
npm test
npm run test:coverage
~~~

## 非目标与后续

v0.1 的边界与 v0.2 backlog 见 [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) 第 9 节。
重点：中文分词/双索引、向量检索、自动抽取、多 agent 同步、恢复 API、多租户授权、加密备份。

## License

TBD（建议 MIT，待确认）。