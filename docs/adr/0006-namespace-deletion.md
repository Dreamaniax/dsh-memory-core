# ADR 0006 — namespace 隔离、软删除默认、永久删除独立

- 状态：Partially superseded by ADR 0008（身份）与 ADR 0009（状态/删除）；保留 namespace 隔离原则
- 日期：2026-11-14

## 背景

多个插件共享一个 DB；需要逻辑隔离。用户要求 candidate/active 分离、生命周期状态、用户授权删除、来源/反馈行为明确。

## 决策

- 所有表带 namespace_id；所有查询强制 namespace；复合外键阻止跨 namespace 关联。
- namespace 不是认证；多租户需在可信边界另做授权。
- 默认软删除（status=deleted + deleted_at），保留 versions/sources/feedback；默认查询/搜索排除。
- 永久删除是独立 purgeMemory，要求显式 confirmationToken；级联 versions/memory_sources/memory_feedback；清理 autoCreated 孤儿 sources；共享 sources 保留。
- 反馈正常生命周期 append-only；purge 是唯一物理清理路径；备份可能保留已删内容。
- 身份为 (namespace_id, id)；复合外键阻止跨 namespace 关联（ADR 0008）。

## 备选

- 无 namespace：插件间数据混在一起。
- purge 默认：误删不可恢复。
- 反馈/版本不级联：purge 后留下无法归属的数据。

## 后果

- 软删除会保留正文，磁盘占用增长；v0.2 可加保留/清理策略。
- 备份残留是已知隐私限制，必须文档明示。
- 本 ADR 的“硬删除”表述由 ADR 0009 的 purgeMemory 取代；不再使用 deleteMemory.mode='hard'。