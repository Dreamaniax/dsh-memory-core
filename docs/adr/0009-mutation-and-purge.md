# ADR 0009 — 状态变更只走反馈；软删除与永久删除分离

- 状态：Proposed（本轮采纳为 Sprint 1 默认）
- 日期：2026-11-14
- 关联：API_REFERENCE.md、ADR 0006、ADR 0008

## 背景

旧契约让 updateMemory 可以直接 patch status，同时 deleteMemory 通过 mode: 'soft' | 'hard' 同时承担软删除与永久删除。两条路径都会绕过审计/确认语义：

- updateMemory({status:'active'}) 可以绕过用户 confirm 反馈，让候选记忆直接进入默认检索。
- deleteMemory({mode:'hard'}) 把一个高危、不可逆操作混进普通 CRUD，误传参即可永久删除。

## 决策

### 状态变更

- updateMemory 只修改内容字段：type/title/content/tags/confidence/metadata/expiresAt。
- updateMemory 不允许修改 status、confirmedAt、deletedAt、origin、version、namespace、id。
- 状态迁移只通过：
  - createMemory 初始 candidate/active；
  - submitFeedback 的 confirm/correct/reject/flag；
  - deleteMemory 的软删除；
  - purgeMemory 的永久删除。
- confirm 是用户确认的唯一入口；设置 confirmed_at，把 candidate/flagged/rejected 转为 active。
- correct 要求非空 patch，设置 status=active、origin=direct、confirmed_at=now，并写新版本。
- reject/flag 只在状态实际变化时写新版本；无变化时仍追加反馈事件，applied_version 为当前版本。

### 删除

- deleteMemory 只做软删除：status=deleted、deleted_at、version++、写版本快照；要求 expectedVersion。
- purgeMemory 是独立的高危管理操作：要求 expectedVersion 与显式 confirmationToken（格式 PURGE:<namespaceId>:<memoryId>）；级联 versions/memory_sources/memory_feedback；清理 auto-created 且无其他引用的 sources；不写版本。
- purgeMemory 不在普通消费者默认能力中；由宿主/管理代码显式调用。
- 备份不会因 purge 自动删除；文档明示。

### Working memory

- 持久化的 working 记忆必须设置 expiresAt；DB CHECK + API 校验双保险。
- 不持久化的 working memory 仍由宿主上下文管理，不属于 Core。

## 备选

- 保留 updateMemory.status：少一个反馈步骤，但破坏“候选/主动分离”和审计。
- 保留 deleteMemory.mode：API 更少，但高危操作容易被误用；权限/确认无法在类型层区分。
- purgeMemory 用布尔 confirm：更简单，但容易误传；采用绑定 namespace/id 的 token。

## 后果

- API 多一个 purgeMemory；deleteMemory 语义更窄、更安全。
- 测试矩阵需覆盖：update 不能改 status；confirm/reject/flag 的版本规则；无变化反馈不增版本；purge 需 token、级联、备份保留。
- 若未来需要“归档”或“恢复”，新增独立 API/状态，不复活 mode:'hard'。