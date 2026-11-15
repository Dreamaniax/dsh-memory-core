# ADR 0007 — 包入口：Library 根入口 + ./plugin 子路径

- 状态：Accepted（v0.1 已实现并验证）
- 日期：2026-11-14

## 背景

消费者需要 import { openMemoryCore } from 'dsh-memory-core'；DSH loader 需要加载 Cordis 插件模块。根入口若同时导入 Cordis，会让纯 Library 测试依赖宿主 peer。

## 决策

- 根 exports "." -> lib/index.js（Library，不依赖 Cordis）。
- exports "./plugin" -> lib/plugin.js（Cordis Service）。
- cordis.patch.yml 使用 name: dsh-memory-core/plugin。
- peerDependencies: @deepseek-ai/cordis、@deepseek-ai/schemastery（仅 plugin 入口需要）。
- 若 loader 不支持子路径，Sprint 4 回退：根入口改为插件，Library 移到 ./core，或提供独立 wrapper 包。

## 备选

- 根入口同时导出 Library + 插件：简单，但根 import Cordis，测试/非 DSH 场景需要 peer。
- 独立插件包：多一个包，分发复杂。

## 后果

- Sprint 4 已在隔离 DSH_HOME 中真实验证：dsh-memory-core/plugin 通过 ./plugin 子路径加载，ctx.memoryCore 可用。
- 消费者文档明确两个入口：根 Library 与 ./plugin。