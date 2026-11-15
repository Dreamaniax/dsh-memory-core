# ADR 0008 — Namespace-scoped identity (namespace_id, id)

- 状态：Accepted（v0.1 已实现并验证）
- 日期：2026-11-14
- 关联：DATABASE_SCHEMA.md、API_REFERENCE.md、ADR 0006

## 背景

现有草案同时出现两种互斥语义：

1. memory_items.id 是全局主键，ID 在所有 namespace 内唯一。
2. 设计要求“不同 namespace 可使用相同 ID”，且未来 derived_from / related_to / supersedes / supports 关系需要明确端点。

两者不能同时成立。必须选定一个身份模型，并让 Schema、API、索引、外键、日志与测试一致。

## 决策

v0.1 采用 namespace-scoped identity：

- 一条记忆的身份是 (namespace_id, id)，不是单独的 id。
- 不同 namespace 可以拥有相同 id；同一 namespace 内 id 唯一。
- memory_items 使用内部整数 fts_rowid INTEGER PRIMARY KEY AUTOINCREMENT 作为 FTS external-content rowid；(namespace_id, id) 是业务唯一键。
- 所有关联表（versions、memory_sources、feedback）使用 (namespace_id, memory_id) 复合外键。
- sources 同样使用 (namespace_id, id)；来源去重键 (namespace_id, source_type, external_ref)。
- API 所有方法都要求 namespaceId；id 只在 namespace 内有意义。
- 外部系统的本地 ID 放 sources.external_ref 或 metadata，不冒充 Memory Core 的 id。
- 不提供全局 ID；未来若需要跨 namespace 关系或多机同步，增加可选 global_uid（UUID，唯一，nullable）并通过迁移回填，而不是现在引入双 ID。

## 备选

### A. 全局 UUID 主键（原先起草）

- 优点：全局句柄简单；跨 namespace 关系/同步直接；日志不含 namespace 也不歧义。
- 缺点：无法满足“不同 namespace 可使用相同 ID”；调用方导入时必须做全局映射；与“namespace 是隔离边界”的语义不完全一致。
- 结论：不采用为 v0.1 默认；保留为未来 global_uid 扩展。

### B. Namespace-scoped 复合身份（本决策）

- 优点：namespace 是一等身份边界；允许局部 ID 复用；复合外键从数据库层阻止跨 namespace 关联；多租户语义清晰。
- 缺点：所有外键/关系必须携带 namespace；跨 namespace 关系更冗长；没有天然全局句柄；日志必须带 namespace。
- 结论：采用。

### C. 双 ID（global uid + scoped id）

- 优点：同时满足全局句柄与局部复用。
- 缺点：两套 ID 增加 API/索引/迁移/心智负担；v0.1 没有跨 namespace 同步用例。
- 结论：暂不采用；作为未来迁移路径。

## 后果

- getMemory/updateMemory/deleteMemory/purgeMemory 一律要求 namespace；仅凭 id 不能定位。
- memory_versions 主键为 (namespace_id, memory_id, version)；不再有独立版本 ID。
- memory_feedback 主键为 (namespace_id, id)，并保留 (namespace_id, request_id) 幂等唯一键。
- memory_sources 主键为 (namespace_id, memory_id, source_id)。
- FTS 的 content_rowid 使用 fts_rowid，避免 VACUUM 改变隐式 rowid 后索引错位。
- 测试必须覆盖：同一 id 在两个 namespace 可共存；同一 namespace 重复 id 被拒绝；跨 namespace 关联被复合外键拒绝；日志/错误只带 namespace + id。
- 若未来需要跨 namespace 关系，先新增 global_uid 与关系表迁移，不在 v0.1 预建。

## 迁移路径（若未来改为全局 ID）

1. 加 global_uid TEXT UNIQUE，回填 UUID；不改变现有复合键。
2. 关系表使用 global_uid 作为端点；旧 API 保留 namespace+id。
3. 通过双写/回填校验后，再决定是否把 global_uid 提升为对外主键。
4. 全程不删除已有 namespace-scoped 数据；迁移可回滚（保留备份）。