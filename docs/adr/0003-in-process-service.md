# ADR 0003 — 进程内 Cordis Service + 可独立 Library

- 状态：Accepted（v0.1 已实现并验证）
- 日期：2026-11-14

## 背景

DSH 宿主插件共享同一个 Cordis Context/进程；服务可通过 ctx.inject 共享。多个插件不应各自打开连接/迁移同一 DB。测试/CLI 需要无宿主依赖的使用方式。

## 决策

主集成：一个 Cordis Service，名字 memoryCore，插件激活时打开/迁移 DB，ctx.effect 关闭。
次集成：导出 openMemoryCore() Library 工厂，供测试、CLI、迁移工具使用。
不提供 HTTP/IPC。

## 备选

- 每个插件各自 new Store：连接/迁移竞争，生命周期泄漏。
- 独立 HTTP 服务：增加端口/鉴权/进程管理，v0.1 无必要。
- 纯 Library：消费者重复实现单例与关闭逻辑。

## 后果

- 消费者通过 ctx.memoryCore 使用；测试通过 Library。
- 多宿主进程共享 DB 时依赖 SQLite 锁与 version 乐观锁；无跨进程事件。
- Sprint 4 已在隔离 DSH_HOME 中验证 Service 生命周期、重启持久化与关闭清理。