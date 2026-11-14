# ADR 0001 — TypeScript ESM + tsc

- 状态：Proposed（待批准）
- 日期：2026-11-14

## 背景

DSH core 包以 TypeScript 源码发布并编译为 ESM；插件 package.json 使用 type: module 与 lib/index.js。宿主 Node 22.19+/24.21；系统 Node 22.22。Python 运行时存在，但插件生命周期在 Node/Cordis。

## 决策

采用 TypeScript 编写 Memory Core，编译为 ESM JavaScript；使用 tsc 5.9.3 + @types/node 24.x；tsconfig 用 NodeNext、strict、declaration、sourceMap。

## 备选

- 纯 JavaScript + JSDoc：少一步构建，但类型/契约与重构安全性弱。
- tsdown/tsup：DSH core 使用，但 v0.1 不需要打包器；tsc 足够。
- Python：与 Cordis 插件链路不一致。

## 后果

- 需要构建步骤；发布包包含 lib/*.js + *.d.ts。
- 测试导入 lib，避免 Node TS 类型剥离的扩展名差异。
- 类型契约可被消费者复用。