# DSH Memory Core v0.1 — Phase 0 环境调查报告

- 状态：待用户批准（Phase 0/1 收口）
- 调查日期：2026-11-14
- 调查对象：DSH Desktop 0.2.2-rc.3（Electron 44.7.0 / Node 24.21.0 / pnpm 11.28.5）
- 工作目录：/Users/dreamania/Library/CloudStorage/OneDrive-Personal/RA/dsh-memory-core
- 结论置信度：代码与运行时证据充分；尚未在本机启动一个自定义插件做端到端挂载，该验证放在 Sprint 4 验收。

## 1. 一句话结论

DSH 的宿主插件运行在同一个 Cordis 进程内，插件是 ESM 模块，核心可以用 TypeScript 编写并编译为 ESM；运行时自带 Node 24.21 的 **node:sqlite**，已实测支持 FTS5、trigram tokenizer、WAL、外键与在线备份。因此 v0.1 应采用 **进程内 Cordis Service + 可独立导入的 Library**，用 **node:sqlite** 直接建库，不引入原生模块、不引入 HTTP 服务、不引入向量库。

## 2. 环境事实清单

| 项目 | 实测值 | 证据 |
| --- | --- | --- |
| 工作目录 | 空目录，非 git 仓库 | pwd / ls -la / git status |
| 系统 Node | v22.22.0 | node --version |
| 系统 npm | 10.9.4 | npm --version |
| 系统 Python | 3.9.6 | python3 --version |
| 系统 sqlite3 CLI | 3.54.0 | sqlite3 --version |
| DSH 桌面版 | 0.2.2-rc.3 | runtime/primary-runtime/runtime.json |
| Electron | 44.7.0 | ELECTRON_RUN_AS_NODE 探测 |
| Electron 内置 Node | 24.21.0，ABI 149 | 同上 |
| DSH 内置 pnpm | 11.28.5 | runtime.json / pnpm --version |
| DSH 内置 SQLite | 3.53.4，FTS5 可用 | node:sqlite 实测 |
| DSH 用户目录 | ~/.dsh | dsh-home-paths 源码 |
| DSH 存储根 | $DSH_HOME/storages | dsh-base/cordis.patch.yml |
| 插件框架 | Cordis 4.1.x | 各 core 包 peerDependencies |
| 配置校验 | @deepseek-ai/schemastery 3.18.5 | 插件 Config 用法 |
| 数据校验 | zod 4.4.3（宿主已安装） | dsh-storage-domain 使用 zod |
| 第三方插件样例 | dsh-weekly-retro 0.4.9 | 已安装且源码可用 |
| TypeScript 可用版本 | 5.9.3（npm registry） | npm view typescript@5.9 |
| @types/node 可用版本 | 24.19.2 | npm view @types/node@24 |

## 3. DSH 运行时与插件架构

### 3.1 语言与模块格式

- DSH core 包以 TypeScript 源码发布，运行入口是编译后的 ESM JavaScript；包声明 **type: module**、**main: lib/index.js**、**exports**。
- 第三方插件同样以 ESM 加载，例如 dsh-weekly-retro 的 package.json 声明 **type: module** 与 **main: lib/index.js**。
- 结论：Memory Core 用 TypeScript 编写、编译为 ESM 是符合宿主约定的第一选择；不建议用 Python 作为核心实现，因为插件生命周期、服务注入与打包链路都在 Node/Cordis 侧。

### 3.2 插件生命周期

Cordis 的插件模型：

- 插件可以是函数，也可以是带 apply 的对象/类；**ctx.plugin()** 启动插件并返回 Fiber。
- 插件可声明 **inject**，Cordis 在依赖服务可用后才激活。
- 插件可声明 **Config**（schemastery schema），配置由 profile 的 cordis.patch.yml 或命令行覆盖层提供。
- 服务通过 **Service** 基类或 **ctx.provide(name, value)** 注册，依赖方用 **ctx.inject([...], cb)** 或 **ctx.get(name)** 读取。
- 清理用 **ctx.effect(() => () => cleanup)**；插件卸载时自动执行。
- 异步初始化用 **Service.init** 符号；dsh-session-query-sqlite 就是这样打开 SQLite 的。

实际源码证据：

- dsh-session-query-sqlite/src/index.ts：class 继承 Service，static inject、static Config、Service.init 中 await 打开 SQLite，ctx.effect 中 close。
- dsh-app-boot/src/index.ts：boot() 创建一个 Context，ctx.provide('dshHomePath', dshHomePath)，然后 ctx.plugin(Loader) 并加载整棵 profile 插件树。
- dsh-base/cordis.patch.yml：storage、storage-json、storage-domain 等行都在同一个 Context 中挂载。

### 3.3 进程模型：插件是否共享内存

- 宿主侧插件共享 **同一个 DSH 宿主进程与同一个 Cordis Context**；不是每个插件一个进程。
- 证据：boot() 只创建一个 **new Context()**，Loader 在同一 Context 内挂载所有 profile bundle；storageDomain 等服务被多个插件共享。
- 浏览器侧 client 插件是另一条链路（Web 页面），但 Memory Core v0.1 只做宿主侧数据与服务，不需要 client 半。
- 结论：**进程内 Service 方案成立，v0.1 不需要 HTTP 或 IPC**。
- 注意：同一台机器上可能同时运行 Desktop 与 CLI/web 两个宿主进程。它们会各自打开同一个 SQLite 文件，因此数据库层必须按多进程安全设计（WAL、busy_timeout、BEGIN IMMEDIATE、有限重试），但 v0.1 不承诺跨进程内存缓存一致性。

### 3.4 持久化与数据目录

- DSH 用户数据根：**$DSH_HOME**，默认 **~/.dsh**；解析顺序为显式 configured path > $DSH_HOME > ~/.dsh。
- dsh-home-paths 提供 **dshHomePath(...segments)**，app-boot 把它注册为 Cordis 服务。
- dsh-base 的 storage-json 后端配置为 **root: dshHomePath('storages')**；dsh-context 的缓存、session_projcache、image-gen spend 等都在 ~/.dsh/storages 下。
- session 日志在 ~/.dsh/sessions；weekly-retro 产物在 ~/.dsh/learning。
- 结论：Memory Core 默认库路径建议为 **$DSH_HOME/memory-core/memory.sqlite3**。理由：storages 目录的语义属于 JSON storage 后端，混放自定义 SQLite 文件会让备份与运维边界模糊；独立目录更清晰，同时仍受 DSH_HOME 覆盖与权限体系统一管理。

### 3.5 已有存储抽象能否复用

DSH 有完整的 **ctx.storage** / **ctx.storageDomain**：

- dsh-storage：后端注册表，支持多个后端并存。
- dsh-storage-json：JSON 后端，single 或 per-record 布局，原子写。
- dsh-storage-domain：schema 校验的 KV 域，zod 校验、domain/changed 事件、每域写链。
- 当前桌面 composition 只挂载 json 后端；没有随包发布可用的 SQLite storage 后端（源码包列表只有 dsh-storage、dsh-storage-domain、dsh-storage-json）。

不采用 storageDomain 作为 Memory Core 主存储的原因：

1. 它没有 SQL 查询、JOIN、外键、FTS5、二级索引。
2. 没有跨表事务；memory + versions + sources + feedback 的原子性无法保证。
3. JSON single 布局每次写重写整个 unit；per-record 布局也不适合关系查询。
4. 它的领域模型是 KV 记录，不是关系型记忆图谱。

结论：**复用其路径/权限/服务注入约定，但不复用其存储引擎**。Memory Core 自己用 node:sqlite 建库，并通过 Cordis Service 暴露给其他插件。

### 3.6 沙箱与安全边界

- DSH 对 agent 的工具执行有文件/命令沙箱（workspace-write、bash-sandbox 等）。
- **插件宿主代码不在该沙箱内**：插件被 import 到宿主进程，拥有 Node 进程权限。Memory Core 不能假设调用方已经过沙箱，必须在 API 层做输入校验、参数化 SQL、大小限制与错误脱敏。
- 结论：安全责任在 Memory Core 自身；不把 namespace 当认证；不记录正文；默认不联网。

## 4. 构建、测试与包管理约定

### 4.1 包管理

- DSH profile 使用 pnpm（内置 11.28.5），profile 的 node_modules 是 pnpm 布局。
- 系统 PATH 没有 pnpm；可用 DSH 内置路径调用。
- 系统 npm 10.9.4 可用，但默认 ~/.npm-cache 在当前沙箱下不可写；开发时用 workspace 内缓存目录即可（npm_config_cache=.tmp/npm-cache）。
- 建议：Memory Core 独立仓库用 npm + package-lock.json 管理开发依赖；挂载进 DSH profile 时用 pnpm 的 file:/link: 安装。不要把 profile 的 node_modules 当成项目依赖目录。

### 4.2 测试

- DSH core 包使用 vitest/tsdown 等工具；第三方插件 dsh-weekly-retro 使用 **Node 内置脚本 + node:assert** 的 .mjs 测试，并用 boot-verify.sh 在隔离 DSH_HOME 中真实启动 web 进程做冒烟。
- Node 22.22 与 24.21 都支持 **node:test**、**--experimental-test-coverage**、**node:sqlite**。
- 建议：Memory Core 用 **node:test + node:assert**，测试文件为 .mjs，导入编译后的 lib/*.js；不引入 vitest，减少依赖与网络风险。类型检查用 tsc --noEmit。
- 覆盖率用 node --test --experimental-test-coverage；目标为核心服务行/函数覆盖 >= 85%。

### 4.3 构建

- TypeScript 5.9.3 + @types/node 24.19.2。
- tsconfig：module/moduleResolution NodeNext、target ES2023、strict、declaration、sourceMap、outDir lib。
- 生产入口 lib/index.js（library）与 lib/plugin.js（Cordis 插件）。
- tests 导入 lib，不直接跑 TS，避免 Node TS 类型剥离对 .js 扩展名解析的差异。

## 5. SQLite 与 FTS5 实测

### 5.1 运行时能力

在 Electron 44.7.0 / Node 24.21.0 中执行 node:sqlite 探测：

- 导出：DatabaseSync、StatementSync、Session、backup、constants。
- SQLite 版本：3.53.4。
- FTS5 可用。
- WAL、foreign_keys、busy_timeout 可用。
- VACUUM INTO 可用。
- backup(db, dest) 可用，生成的副本可读。
- PRAGMA integrity_check 返回 ok。
- FTS5 integrity-check 命令可执行。

系统 Node 22.22.0 同样支持 DatabaseSync、backup、FTS5 trigram。

### 5.2 中文与英文检索行为

实测数据：

- unicode61 把连续中文当成一个整词；查询“复盘”无法命中“每周复盘”，查询“每周复盘”才命中。适合英文词，不适合中文子串。
- trigram 对 >= 3 个 Unicode 字符的中文子串有效；查询“每周复”/“每周复盘”命中“每周复盘”。
- trigram 对 2 个中文字符（如“复盘”）不命中，这是 trigram 的固有限制。
- LIKE 回退对 2 个中文字符有效（“%复盘%”命中）。
- trigram 对英文子串有效（optimizer 命中）；BM25 权重可用。
- 外部内容表 + INSERT/UPDATE/DELETE 触发器可保持 FTS 与正文同步；更新后旧词不再命中，新词命中。
- snippet() 能对命中内容加标记并截断。
- 未转义的 MATCH 输入会被 FTS5 当成查询语法，可能报 unterminated string；必须把用户输入作为带引号的 phrase 绑定，或走 LIKE 回退。

结论：v0.1 采用 **单个 trigram FTS5 索引 + 短查询 LIKE 回退**，并在文档中明确限制；v0.2 再评估双语双索引或中文分词器。

### 5.3 事务与外键

- SQLite DDL 可事务化；迁移可在 BEGIN IMMEDIATE / COMMIT / ROLLBACK 中执行。
- foreign_keys 是连接级 PRAGMA，必须每次连接开启；测试会覆盖跨 namespace 的复合外键。
- STRICT 表可用；TEXT UUID 主键可用；隐式 rowid 可作为 FTS external content 的 content_rowid。
- 复合外键需要父表 (id, namespace_id) 唯一约束；这样能从数据库层阻止跨 namespace 关联。

### 5.4 备份

- backup() 可在线生成一致副本；VACUUM INTO 也可用。
- 迁移前备份、健康检查、恢复流程均可行。
- 备份文件含敏感正文，权限必须 0600；备份保留策略要写入文档，purge 不会自动清理历史备份。

## 6. 兼容性与约束

- 已验证平台：macOS arm64（本机）。
- 未验证平台：Windows x64。node:sqlite 是 Node 内置，理论上跨平台；但文件权限、路径、WAL 在 Windows/网络盘上的行为需要 CI 或实机验证。
- 项目目录在 OneDrive 同步盘；**数据库不应放在项目目录**，必须放 $DSH_HOME 或临时测试目录，避免同步盘锁与 WAL 问题。
- DSH 桌面版 Node 24.21；CLI 可能使用 Node 22.19+；代码需兼容 >= 22.19。
- node:sqlite 仍标记 Experimental，API 可能变化；用薄驱动层隔离。
- 插件加载器对子路径入口（dsh-memory-core/plugin）的支持尚未实测；Sprint 4 必须做真实挂载验证。若不支持，回退方案是把根入口做成插件、库入口改为子路径，或提供独立 wrapper 包。

## 7. 技术选型对比

| 方案 | 结论 | 原因 |
| --- | --- | --- |
| TypeScript + ESM + node:sqlite | 采用 | 与 DSH 一致；零原生依赖；FTS5/WAL/备份均可用 |
| Python 核心 | 不采用 | 插件生命周期在 Node/Cordis；跨进程/打包成本高 |
| better-sqlite3 | 不采用 | Electron ABI 149 需要重编译与分发；node:sqlite 已够用 |
| sql.js / WASM | 不采用 | 持久化、并发、FTS 能力弱；不适合长期记忆 |
| ctx.storageDomain JSON | 不采用为主存储 | 无 SQL/JOIN/FTS/事务；只复用路径与权限约定 |
| 独立 HTTP 服务 | v0.1 不采用 | 宿主插件同进程；增加进程、端口、鉴权、生命周期复杂度 |
| 纯 Library，不做 Service | 部分采用 | 保留 Library 便于测试/CLI；生产用 Service 保证单实例与生命周期 |
| 向量库/embedding | 明确不做 | v0.1 范围外；关键词检索足够 |

## 8. 开放问题与 Phase 1 收口状态

1. createMemory 默认状态用 candidate 还是 active？**已收口：默认 candidate，显式 feedback confirm 激活。**
2. 永久删除是否级联 feedback/versions？**已收口：purgeMemory 级联；备份可能仍保留（ADR 0009）。**
3. namespace 只是隔离标识，不是认证；**已接受；文档与 API 明确不把 namespace 当鉴权。**
4. 中文检索 trigram + 短查询 LIKE 回退？**已收口：v0.1 采用，文档明示限制。**
5. 包名与入口 dsh-memory-core + ./plugin 是否被 loader 接受？**未验证；Sprint 4 真实挂载验收，失败则回退 wrapper/根入口。**
6. 是否在 v0.1 暴露 HTTP/LLM 工具？**已收口：不暴露，只做 Service + Library。**
7. 是否修改 weekly-retro 现有插件？**已收口：只提供 examples，不改现有插件。**
8. 数据库默认目录？**已收口：$DSH_HOME/memory-core/memory.sqlite3。**
9. 备份保留几份、是否加密？**待你决定：建议 3 份、不加密、0600；不阻塞 Sprint 1。**
10. working 类型是否默认持久化？**已收口：支持持久化但必须 expiresAt；不自动短期缓存。**
11. 记忆 ID 是全局唯一还是 namespace 内唯一？**已收口：namespace-scoped (namespace_id, id)，不同 namespace 可复用；ADR 0008。**
12. updateMemory 能否改 status？**已收口：不能；状态只走 feedback/delete/purge；ADR 0009。**
13. deleteMemory 是否含硬删除？**已收口：只软删除；purgeMemory 独立 token；ADR 0009。**

## 9. 复现证据

详见 docs/PHASE0_EVIDENCE.md。关键命令：

~~~bash
node --version
npm --version
ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" -e "console.log(process.versions)"
node -e "const s=require('node:sqlite'); console.log(Object.keys(s))"
~~~

关键源码位置（位于 DSH 安装包的 app.asar 内；调查期间临时提取到 .tmp，不随仓库提交）：

- dsh/node_modules/@deepseek-ai/dsh-app-boot/src/index.ts（boot/Context/dshHomePath）
- dsh/node_modules/@deepseek-ai/dsh-home-paths/src/index.ts（DSH_HOME 解析）
- dsh/node_modules/@deepseek-ai/dsh-session-query-sqlite/src/{schema,index,query}.ts（node:sqlite/FTS5 先例）
- dsh/node_modules/@deepseek-ai/dsh-base/cordis.patch.yml（composition 与 storage root）
- dsh/node_modules/@deepseek-ai/dsh-storage-domain/README.md（KV 域限制）

## 10. 建议

批准本报告中的技术栈、进程模型、数据目录与 node:sqlite 决策后，进入 Sprint 1；在 Sprint 1 只做 SQLite foundation 与迁移/备份测试，不碰业务 API；Sprint 4 做真实 DSH 挂载验证。