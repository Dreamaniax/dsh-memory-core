# Release Readiness Report — DSH Memory Core v0.1.0

- 日期：2026-11-16
- 仓库：Dreamaniax/dsh-memory-core（public）
- npm：`@dreamaniax/dsh-memory-core@0.1.0`（public）
- 状态：v0.1.0 已公开发布；MIT License；GitHub 仓库与 npm 包均已公开
- 基线：Sprint 4 发布收口代码/门禁到 commit dd8c16c；本报告描述其后的候选变更
- 安全更新（2026-11-16）：运行时 zod 从 4.4.3 升级到 4.6.6，修复 GHSA-mrhx-c7xc-m3w5；本文件中 4.4.3/47 项测试的早期门禁输出是历史记录，最新证据见 reviews/PRIVACY_SECURITY_AUDIT.md

## 1. 结论

| 门禁 | 状态 | 证据 |
| --- | --- | --- |
| 文件模式规范化 | 通过 | commit f6a65be 规范为 77×100644 + 1×100755；加入 LICENSE 后候选 HEAD 为 80×100644 + 2×100755（两个直接执行的验证脚本） |
| 干净依赖安装 | 通过（全新 cache + registry） | 全新临时 clone 执行 npm ci，exit 0 |
| typecheck / build | 通过 | npm run typecheck；npm run build，均 exit 0 |
| 全量测试 | 通过 | 50 / 50，0 fail |
| 覆盖率 | 通过 | 行 96.19% / 分支 85.85% / 函数 94.84%（最近一次全量运行） |
| 许可证 | 通过（选定 MIT） | LICENSE + package.json `license: MIT` + README；依赖许可无冲突（见 §5） |
| 两个消费者示例 | 通过 | weekly-retro、prompt-optimizer 的 --selftest 均 exit 0 |
| 隔离 DSH_HOME 挂载 | 通过 | 候选代码提交上 ctx.memoryCore create/get/search/feedback/close、重启持久化、干净关闭；memoryId 889d83ce-17ba-4768-b941-1107f76f30cb |
| 真实 tarball 安装 + 挂载 | 通过 | 候选代码提交：135,294 bytes、140 files、memoryId 4eacf925-3b5d-4b82-8f58-b59e8134f6d5；基线 commit 542182d 上为 4655d9fc-86ae-4d9f-b09a-c8d06a9d8411 |
| tarball 依赖缓存 | 通过 | 冷缓存先用 npm cache add 缓存 zod packument + tarball，再以 --offline 安装；未手工复制依赖 |
| tarball 内容审计 | 通过 | 140 个文件全部 0644；含 LICENSE；无数据库/测试/缓存/密钥/个人路径 |
| Git 当前树审计 | 通过 | 当前 tracked 文件无密钥、真实记忆、个人绝对路径 |
| Git 历史审计 | 通过（接受保留） | 全部 commit 无密钥/二进制/数据库；早期 commit 保留两条本机绝对路径，决定不重写 |
| Windows | 未验证 | 仅在 macOS arm64 上实测；本版本不宣称支持 Windows |
| npm registry 发布 | 通过 | `@dreamaniax/dsh-memory-core@0.1.0`，`publishConfig.access=public`；不使用已被他人占用的 unscoped 名称 |

## 2. 真实 tarball 安装证据

干净副本来自 git archive，不包含 node_modules、lib 构建产物或 .tmp。安装命令由
tests/integration/dsh-boot-prepare.mjs 执行；profile 安装前先显式预热 npm cache：

~~~bash
npm cache add zod@4.6.6 --cache <repo>/.tmp/npm-cache \
  --prefer-offline --fetch-retries=1 --fetch-timeout=30000 --no-audit --no-fund
npm install <tarball> --prefix <temp-profile-dir> --no-save --legacy-peer-deps \
  --ignore-scripts --no-audit --no-fund --offline --fetch-retries=0 \
  --fetch-timeout=15000 --cache <repo>/.tmp/npm-cache
~~~

失败复现：测试缓存里可能只有 `zod-4.4.3.tgz` 而没有 packument；此时
`npm install <tarball> --offline` 会报 `ENOTCACHED`，网络慢时非 offline 安装会卡在
`fetch manifest zod@4.4.3`。这是测试缓存的预热缺口，不是 package.json 缺少依赖。
修复用 `npm cache add` 让 npm 自己解析并缓存 packument + tarball，然后 profile 安装
强制 `--offline`，不手工复制 node_modules；冷缓存首次仍需要 npm registry 一次。

随后 DSH 从该临时 profile 启动，probe 通过 ctx.memoryCore 执行
create/get/search/feedback/healthCheck/close；进程重启后读到同一 memoryId。commit
542182d 上 tarball gate 的结果（全新临时 clone + 全新 gate cache）：

~~~json
{
  "ok": true,
  "memoryId": "4655d9fc-86ae-4d9f-b09a-c8d06a9d8411",
  "database": "<temp DSH_HOME>/memory-core/memory.sqlite3",
  "writeHits": 1,
  "feedbackTotal": 1
}
DSH mount verification passed
~~~

该验证使用隔离 DSH_HOME；真实 ~/.dsh/profiles/web 的 mtime 仍为 2026-11-12 15:28:55。

同时在全新临时 clone（HEAD 542182d，全新 npm cache）
按顺序重跑：`npm ci` exit 0；`npm run typecheck` exit 0；`npm test` 47/47 pass、
0 fail、212.797667 ms、exit 0；`npm run test:examples` exit 0；`npm run test:tarball`
exit 0（130,527 bytes、139 files、memoryId 4655d9fc-86ae-4d9f-b09a-c8d06a9d8411）。
clone 工作区保持 clean。

文档 commit 864b693 上再次运行 `test:tarball`（全新 gate cache）exit 0：132,309 bytes、
139 files、all 0644、memoryId dbbfb11f-c203-4e27-baa3-9f09edac3ce1、writeHits 1、
feedbackTotal 1。packed size 会随文档内容变化，最终以 gate 输出为准。

DSH 宿主可能自行更新 desktop profile 的 pnpm 元数据，这不属于本仓库测试写入。

本次候选复跑结果：

- 本地工作树：`npm run typecheck` exit 0；`npm run build` exit 0；`npm test` 47/47 pass、0 fail、213.500792 ms；`npm run test:coverage` 行 95.80% / 分支 85.07% / 函数 94.72%；`npm run test:examples` exit 0（weekly-retro、prompt-optimizer 均通过）。
- `npm run test:dsh` exit 0：隔离 DSH_HOME 挂载通过，memoryId 889d83ce-17ba-4768-b941-1107f76f30cb。
- `npm run test:tarball` exit 0：135,294 bytes、140 entries、140 files、requiredFiles 9、全部 0644、forbiddenPaths 0、contentFindings 0；隔离挂载 memoryId 4eacf925-3b5d-4b82-8f58-b59e8134f6d5。
- 首次候选 tarball 尝试在 `npm cache add zod@4.4.3` 处失败（registry 超时）；缓存预热后复跑通过。冷缓存首次仍需要 registry 一次，不能写成完全离线通过。
- 干净 clone（候选代码提交，非工作树）：`npm ci` exit 0；`npm run typecheck` exit 0；`npm test` 47/47 pass、0 fail、206.882042 ms；coverage 95.80% / 85.07% / 94.72%；`npm run test:examples` exit 0；`npm run test:dsh` exit 0（memoryId 5253ff24-9230-4f26-aea0-1e0fbfe5179b）；`npm run test:tarball` exit 0（memoryId 8f7108a9-db51-43f6-a6fb-3caac5db8ce1）；clone 工作区 clean。

可重复命令：

~~~bash
npm run test:tarball
~~~

该脚本从 git archive HEAD 生成干净源，执行 npm ci、build、pack，校验 tarball 的
条目/模式/必需文件/敏感内容，再用该 tarball 跑隔离 DSH 挂载验证。gate 自己预热
zod 缓存并以 `--offline` 安装 profile；它不会把工作区或 node_modules 复制进 tarball。

## 3. tarball 内容审计

最近一次干净构建的 tarball 数据：

| 项 | 值 |
| --- | ---: |
| 条目数 | 140（候选包预检；含 LICENSE，最终以 gate 输出为准） |
| 文件数 | 140（候选包预检） |
| packed size | 候选代码提交的 gate：135,294 bytes；文档进一步更新会改变 packed size，最终以实际 gate 输出为准 |
| unpacked size | 约 490 KB |
| 所有文件模式 | 0644 |
| 可执行文件 | 0 |
| 数据库 / WAL / SHM | 0 |
| tests / node_modules / .tmp / coverage | 0 |
| 密钥、token、个人绝对路径 | 0 |

包含：LICENSE、lib（js/d.ts/map）、migrations/001_initial.sql、cordis.patch.yml、根文档、
docs/、examples/。不包含：types/（仅编译期）、测试、数据库、缓存、日志。

## 4. Git 当前树与历史审计

审计范围：当前 tracked 文件、全部历史 commit 的文件名与内容、忽略/未跟踪工作区。

- 当前树：无数据库、WAL/SHM、.env、密钥、日志、node_modules、测试数据或本机绝对路径；
  无真实 DSH profile 内容；无会话正文。
- 历史 commit：无二进制 blob，最大 blob 34,161 bytes；无数据库/日志/密钥文件；无
  secret-like 字符串、私钥、GitHub token 或真实用户记忆。
- 历史中仅有的本机路径命中：
  - commit 2b214e6 DSH_MEMORY_CORE_V0.1_ARCHITECTURE.md:14：一个本机开发目录绝对路径
  - commit 2b214e6 / c885311 / 87f63bf docs/PHASE0_INVESTIGATION.md:6：本仓库的云同步绝对路径
  - 当前 HEAD 已不再包含这些路径（Sprint 4 已脱敏）。
- 所有 commit 的 author/committer 使用仓库维护者的已配置 Git 身份；这是提交元数据，
  不是凭据。
- 发布收口已删除 .tmp/；重新运行门禁可能再生成测试日志、临时挂载数据库、提取的 asar
  或临时脚本，其中可能出现临时 DSH web token、本机路径和提交邮箱。它被 .gitignore 忽略，
  不在 Git 历史或 tarball 中；每次发布前都应删除，不能作为交付物。

历史处理决定：**接受并保留现有历史**（用户已确认）。两条路径是开发机工作目录，
不含凭据、真实用户记忆或会话正文；当前树已经脱敏。改写已推送历史会改变 commit SHA、
要求所有克隆重新同步，收益与风险不成比例。本次不执行 history rewrite 或 force-push；
公开时在 README/审计报告中说明这两条是开发机路径即可。

以下备选仅记录，未执行：

1. 重写历史：用 git filter-repo 替换这两个路径，然后 force-push；需要协调所有克隆，
   且会改写 commit SHA。
2. 新历史：以当前树开一个新仓库/新 root commit，保留旧仓库为归档；最干净，但丢失
   现有提交谱系。

## 5. 许可证

已选定 **MIT**，并已落地：

- 根目录 [LICENSE](../LICENSE)：标准 MIT 文本，Copyright (c) 2026 Dreamaniax。
- `package.json` 的 `"license": "MIT"`；`files` 显式包含 `LICENSE`。
- [README.md](../README.md) 的 License 段已从 TBD 替换为 MIT 与依赖说明。
- `tests/integration/check-tarball.mjs` 要求 `package/LICENSE` 存在，且
  `manifest.license === "MIT"`。

依赖许可核对（来自已安装包与 package-lock）：

| 包 | 版本 | 许可 | 与分发的关系 |
| --- | --- | --- | --- |
| zod | 4.6.6 | MIT | 运行时依赖；随 profile 安装，不在本包 tarball 内 |
| @deepseek-ai/cordis | 4.1.0 | MIT | peer dependency，由 DSH 宿主提供 |
| @deepseek-ai/schemastery | 3.19.0 | MIT | peer dependency，由 DSH 宿主提供 |
| @deepseek-ai/cosmokit | 1.9.0 | MIT | 传递依赖 |
| @standard-schema/spec | 1.1.0 | MIT | 传递依赖 |
| undici-types | 7.24.6 | MIT | 开发/传递依赖 |
| @types/node | 24.19.2 | MIT | 仅开发期类型 |
| typescript | 5.9.3 | Apache-2.0 | 仅构建期 devDependency，不随 tarball 分发 |

未发现 GPL/AGPL/SSPL 等 copyleft 或与 MIT 分发不兼容的运行时依赖。MIT 允许使用、修改、
再分发，条件是保留版权与许可声明。TypeScript 的 Apache-2.0 仅约束该开发工具本身，不要
求本项目整体改用 Apache-2.0；若未来把 TypeScript 或其它 Apache-2.0 材料随包分发，需保留
其 NOTICE/许可文本并重新审计。

npm 通常会自动包含 LICENSE，但本包已在 `files` 显式列出，并由 tarball 门禁强制校验。
包已移除 `private` 并发布为 `@dreamaniax/dsh-memory-core@0.1.0`；MIT 为公开分发许可。

## 6. 已知限制与未验证项

- 仅实测 macOS arm64；Windows 未验证，本版本明确不宣称支持；Linux 未验证。
- node:sqlite 仍标记 Experimental；升级 Node/DSH 需要重跑全量测试与挂载。
- namespaceId 不是认证/授权边界；无加密、无多租户隔离。
- purge 只删除当前库行；不会清除历史备份、WAL、云同步版本历史或文件系统快照。
- 迁移前备份默认保留 3 份且不加密；v0.1 不内置加密、异地保留或恢复演练，风险与用户保护方式见 README。
- MIT License 已选定；新增依赖时发布前重新核对许可。
- 干净 `npm ci` 需要 npm registry（或已预热 cache）；tarball gate 的冷缓存需要 registry 提供
  zod packument + tarball，预热后 profile 安装以 `--offline` 执行。完全断网的一次性安装
  仍未证明。
- tarball gate 依赖本机 DSH app 与 macOS 的进程/临时目录行为；Windows 未验证。
- 已执行 npm publish、GitHub 公开切换和 v0.1.0 Release；仍未做 Windows CI、并发写/多进程压力测试。
- 中文 2 字查询走 LIKE，O(n)；无分词器/向量检索。

## 7. 公开发布步骤与状态

已完成（本候选，用户已确认）：

1. 许可证：MIT；LICENSE、package.json、README 和 tarball 门禁均已更新。
2. 历史路径：接受并保留两条本机开发路径；不重写、不 force-push。
3. 平台策略：macOS arm64 已实测；Windows/Linux 标记为未验证，不宣称支持。
4. 备份策略：记录自动迁移备份保留最近 3 份、不加密、不异地；风险、用户保护和恢复步骤写入 README。
5. 门禁：typecheck、build、test、coverage、examples、隔离 DSH 挂载、真实 tarball 安装与挂载均已复跑；结果见 §2。

公开发布执行（2026-11-16，用户已授权）：

6. 在普通 checkout 复核文件模式；云同步工作区的 `npm pack` 会生成 0700，因此发布用 `git archive HEAD` 干净副本，tarball 全部 0644、脚本 100755。
7. 公开前再次扫描 secrets/历史/许可证；仓库已切为 public，创建 v0.1.0 tag/Release。
8. npm 名称：unscoped `dsh-memory-core` 已被他人占用（0.1.10），不能覆盖；改用已确认可用的 scoped 名称 `@dreamaniax/dsh-memory-core`，移除 `private`，加 `publishConfig.access=public`；`npm publish --dry-run` 通过后从干净归档发布。
9. `test:tarball` 的冷缓存首次仍需 registry；发布后 `npm view @dreamaniax/dsh-memory-core version` 与 registry 安装验证作为最终证据。

当前结论：**v0.1.0 已作为 MIT 公开源码和公开 npm 包发布**；Windows/Linux 仍未验证，node:sqlite 仍为 Experimental，备份仍未加密。
