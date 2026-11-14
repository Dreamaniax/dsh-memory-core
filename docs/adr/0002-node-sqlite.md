# ADR 0002 — 使用 node:sqlite 作为 SQLite 驱动

- 状态：Proposed（待批准）
- 日期：2026-11-14

## 背景

需要 SQLite + FTS5 + 事务 + 外键 + 备份。DSH 桌面 Electron 44.7.0 / Node 24.21.0；系统 Node 22.22。实测 node:sqlite 导出 DatabaseSync/backup，SQLite 3.53.4，FTS5/trigram/WAL/外键/backup 可用。

## 决策

使用 Node 内置 node:sqlite，不引入原生模块。用薄驱动层隔离，便于未来替换。

## 备选

- better-sqlite3：成熟，但 Electron ABI 149 需要重编译/分发，跨平台成本高。
- sql.js/WASM：持久化与并发弱。
- DSH storageDomain JSON：无 SQL/FTS/事务。

## 后果

- 零原生依赖，跨平台安装简单。
- node:sqlite 仍标记 Experimental；需锁定 Node 版本并做升级测试。
- 同步 API 可能阻塞事件循环；用短查询/索引/限界缓解。