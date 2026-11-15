# Phase 1 收口报告 — 契约、身份与 Sprint 1 边界

- 状态：Phase 1 契约收口完成；Sprint 1 已完成并通过验收（详见 docs/SPRINT1_REPORT.md）
- 日期：2026-11-14
- 事实源：ARCHITECTURE.md、DATABASE_SCHEMA.md、API_REFERENCE.md、IMPLEMENTATION_PLAN.md、docs/adr/0008-identity-scope.md、docs/adr/0009-mutation-and-purge.md
- 历史草案：DSH_MEMORY_CORE_V0.1_ARCHITECTURE.md 已标记为 historical，不作为实施依据

## 1. 本轮解决的冲突

| 冲突 | 旧状态 | 收口决策 | 影响文档 |
| --- | --- | --- | --- |
| ID 作用域 | memory_items.id 是全局主键，同时又要求不同 namespace 可复用 ID | namespace-scoped identity (namespace_id, id)；fts_rowid 为内部 FTS 行号 | DATABASE_SCHEMA、API_REFERENCE、ARCHITECTURE、ADR 0008、PLAN |
| 状态修改入口 | updateMemory 可 patch status，绕过 feedback | updateMemory 不改 status/confirmedAt/origin；状态只走 feedback/delete/purge | API_REFERENCE、ADR 0009、PLAN、SECURITY |
| 删除语义 | deleteMemory 用 mode 混合软/硬删除 | deleteMemory 只软删除；purgeMemory 独立 token | API_REFERENCE、DATABASE_SCHEMA、ADR 0009、README |
| 反馈幂等 | 只有 request_id 唯一，无法判断同 key 不同 payload | memory_feedback.request_hash；相同 hash 返回 duplicate，不同 hash 冲突 | DATABASE_SCHEMA、API_REFERENCE、PLAN |
| FTS 行号稳定性 | 使用隐式 rowid，VACUUM 可能改变 | memory_items.fts_rowid INTEGER PRIMARY KEY AUTOINCREMENT；FTS external content 使用它 | DATABASE_SCHEMA、ARCHITECTURE |
| 来源关系命名 | memory_sources.relation 含 supersedes，与未来 memory-to-memory supersedes 混淆 | source role 只保留 origin/corroborates/contradicts；memory 关系 v0.2 独立表 | DATABASE_SCHEMA、API_REFERENCE、CAPACITY |
| working 记忆 | 可持久化但无 TTL | working 必须有 expiresAt；DB CHECK + API 校验 | DATABASE_SCHEMA、API_REFERENCE、PLAN |
| 备份/永久删除 | 硬删除未明确备份残留 | purge 不清理历史备份；备份保留 3 份、0600；文档明示 | DATABASE_SCHEMA、SECURITY、CAPACITY |

## 2. 一致性核对

| 维度 | Schema | API | ADR | 计划 | 状态 |
| --- | --- | --- | --- | --- | --- |
| namespace 隔离 | 所有表带 namespace_id；复合外键 | 所有方法要求 namespaceId | 0006/0008 | 测试矩阵 | 一致 |
| ID 唯一性 | (namespace_id, id) 唯一；fts_rowid 内部 | id 只在 namespace 内唯一 | 0008 | Sprint 1/2 | 一致 |
| 状态转换 | status CHECK；版本快照 | update 不改 status；feedback/delete/purge | 0009 | Sprint 2/3 | 一致 |
| 版本历史 | memory_versions 复合 PK；快照/hash | getMemoryVersions Page | 0009 | Sprint 2/3 | 一致 |
| 反馈幂等 | request_id + request_hash 唯一 | duplicate/IDEMPOTENCY_CONFLICT | 0009 | Sprint 3 | 一致 |
| 来源关联 | sources + memory_sources 复合 FK | addSource/getSources；source role 三值 | 0006/0008 | Sprint 2 | 一致 |
| 删除 | 软删除 + purge 级联 | deleteMemory 软；purgeMemory token | 0009 | Sprint 2 | 一致 |
| 备份 | backup()/VACUUM INTO；3 份 | backupTo | 0005 | Sprint 1 | 一致 |
| FTS | trigram；fts_rowid；触发器 | searchMemories；LIKE 回退 | 0004/0008 | Sprint 3 | 一致 |
| 容量/演进 | 不预建关系表 | 无 v0.1 关系 API | 0008 | CAPACITY | 一致 |

## 3. 仍需你决定的产品取舍（不阻塞 Sprint 1）

1. 备份保留 3 份是否足够；是否要加密备份（会增加依赖/恢复复杂度）。
2. 可恢复归档的默认阈值（时间/置信度/大小）与是否自动降权；v0.2 设计，不在 v0.1。
3. 跨 namespace 关系是否需要；若需要，v0.2 关系表要带双 namespace 或 global_uid。
4. createMemory 是否要支持“同 id + 同 payload 幂等返回”；v0.1 目前同 namespace 重复 id 直接 DUPLICATE_ID。
5. 分页是否在 v0.2 改为 opaque cursor；v0.1 使用 offset + total。
6. 是否为 purge 增加宿主 capability 白名单（v0.1 仅 API token）。
7. 自动巩固是否允许在无用户确认时创建 candidate；v0.1 不实现，v0.2 需明确。

## 4. Sprint 1 文件清单（实际）

~~~text
package.json
tsconfig.json
tsconfig.build.json
.gitignore
src/index.ts
src/storage/constants.ts
src/storage/sqlite-errors.ts
src/storage/migrations.ts
src/storage/sqlite-store.ts
src/utils/clock.ts
src/utils/fs.ts
migrations/001_initial.sql
tests/helpers/temp-dir.mjs
tests/integration/database.test.mjs
tests/integration/migrations.test.mjs
~~~

## 5. Sprint 1 验收结果

- SQLite Store、迁移 runner、001 Schema、备份、健康检查与基础测试已实现。
- CRUD API、search、feedback、Cordis 插件、examples 未实现（Sprint 2/3/4）。
- 未接入真实 DSH profile；所有测试数据库在临时目录；未修改现有插件。
- 实际命令：npm run typecheck（exit 0）；npm test（13 pass / 0 fail）；npm run test:coverage（13 pass；lines 91.96%）。
- 通过：初始化、身份唯一性、跨 namespace 外键、持久化、迁移回滚、checksum、未来版本拒绝、备份恢复、VACUUM 后 FTS 一致。
- 未完全达标：core storage 的 sqlite-store line 82.89%、sqlite-errors 66.67%；Sprint 2/3 补测试，Sprint 4 复核 85%。

## 6. 容量结论摘要

- 低情景十年约 0.4–0.8 GB；中情景 5–10 GB；高情景 45–65 GB（估算，非实测）。
- 高情景主要成本是版本快照和 3 份未压缩备份；先做无损压缩/归档，再做有损巩固。
- 默认不检索、可恢复归档、永久删除是三种状态；年龄不是 purge 理由。
- 关系表 v0.2 再加；v0.1 用 memory_sources 保持来源可追溯。