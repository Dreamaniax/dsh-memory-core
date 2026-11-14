# ADR 0005 — 版本化迁移 + 迁移前备份 + fail-closed

- 状态：Proposed（待批准）
- 日期：2026-11-14

## 背景

长期记忆是 canonical data，不能像 disposable index 那样版本不匹配就重建。需要可审计升级、失败回滚、损坏恢复。

## 决策

- migrations/NNN_*.sql，按数字升序。
- schema_migrations 记录 version/name/checksum/applied_at；user_version 快速判断。
- 每个迁移一个事务；失败 ROLLBACK；不自动重建。
- 已有数据迁移前用 backup() 备份，保留最近 3 份；备份失败不迁移。
- 外来 application_id、已有表但 app_id=0、未来版本均拒绝。
- 恢复流程：停进程 -> 替换 DB -> 删除 -wal/-shm -> integrity_check -> 启动。

## 备选

- 版本不匹配直接 DROP/重建（session-query-sqlite 对派生索引这样做）：不适合 canonical memory。
- 只靠 user_version 无审计：无法发现迁移文件被改。
- 迁移前不备份：失败/损坏风险高。

## 后果

- 迁移更安全但启动可能因备份失败而失败（fail-closed）。
- 备份含敏感数据，需权限与保留策略。