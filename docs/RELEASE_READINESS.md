# Release Readiness Report — DSH Memory Core v0.1.0

- 日期：2026-11-15
- 仓库：Dreamaniax/dsh-memory-core（private）
- 状态：发布准备完成到“可审计的私有候选包”；**未公开发布、未 npm publish、未选择许可证**
- 基线：Sprint 4 的 commit e762b9e；发布收口工作在本文件所在分支

## 1. 结论

| 门禁 | 状态 | 证据 |
| --- | --- | --- |
| 文件模式规范化 | 通过 | commit f6a65be，77 个文件 100644 + 1 个脚本 100755，内容 diff 为 0 |
| 干净依赖安装 | 通过（本地缓存） | 从 git archive 的干净副本执行 npm ci，exit 0 |
| typecheck / build | 通过 | npm run typecheck；npm run build，均 exit 0 |
| 全量测试 | 通过 | 47 / 47，0 fail |
| 覆盖率 | 通过 | 行 95.80% / 分支 85.07% / 函数 94.72%（最近一次全量运行） |
| 两个消费者示例 | 通过 | weekly-retro、prompt-optimizer 的 --selftest 均 exit 0 |
| 隔离 DSH_HOME 挂载 | 通过 | ctx.memoryCore create/get/search/feedback/close、重启持久化、干净关闭 |
| 真实 tarball 安装 + 挂载 | 通过 | npm pack 后安装到临时 profile，再运行同一挂载 probe；commit 1902d0c 上 memoryId 5b186440-0cbc-47d2-beb1-31867612349e |
| tarball 内容审计 | 通过 | 139 个文件全部 0644；无数据库/测试/缓存/密钥/个人路径 |
| Git 当前树审计 | 通过 | 当前 tracked 文件无密钥、真实记忆、个人绝对路径 |
| Git 历史审计 | 有条件通过 | 全部 commit 无密钥/二进制/数据库；早期 commit 保留两条本机绝对路径 |
| Windows | 未验证 | 仅在 macOS arm64 上实测 |
| npm registry 发布 | 未执行 | 包保持 private，未 npm publish |

## 2. 真实 tarball 安装证据

干净副本来自 git archive，不包含 node_modules、lib 构建产物或 .tmp。安装命令由
tests/integration/dsh-boot-prepare.mjs 执行：

~~~bash
npm install <tarball> --prefix <temp-profile-dir> --no-save --legacy-peer-deps \
  --ignore-scripts --no-audit --no-fund --fetch-retries=5 --fetch-timeout=120000 \
  --cache <repo>/.tmp/npm-cache
~~~

随后 DSH 从该临时 profile 启动，probe 通过 ctx.memoryCore 执行
create/get/search/feedback/healthCheck/close；进程重启后读到同一 memoryId。commit
1902d0c 上 tarball gate 的结果：

~~~json
{
  "ok": true,
  "memoryId": "5b186440-0cbc-47d2-beb1-31867612349e",
  "database": "<temp DSH_HOME>/memory-core/memory.sqlite3",
  "writeHits": 1,
  "feedbackTotal": 1
}
DSH mount verification passed
~~~

该验证使用隔离 DSH_HOME；真实 ~/.dsh/profiles/web 的 mtime 仍为 2026-11-12 15:28:55。
DSH 宿主可能自行更新 desktop profile 的 pnpm 元数据，这不属于本仓库测试写入。

可重复命令：

~~~bash
npm run test:tarball
~~~

该脚本从 git archive HEAD 生成干净源，执行 npm ci、build、pack，校验 tarball 的
条目/模式/必需文件/敏感内容，再用该 tarball 跑隔离 DSH 挂载验证。

## 3. tarball 内容审计

最近一次干净构建的 tarball 数据：

| 项 | 值 |
| --- | ---: |
| 条目数 | 139 |
| 文件数 | 139 |
| packed size | 130,396 bytes（commit 1902d0c 的 gate） |
| unpacked size | 约 481 KB |
| 所有文件模式 | 0644 |
| 可执行文件 | 0 |
| 数据库 / WAL / SHM | 0 |
| tests / node_modules / .tmp / coverage | 0 |
| 密钥、token、个人绝对路径 | 0 |

包含：lib（js/d.ts/map）、migrations/001_initial.sql、cordis.patch.yml、根文档、
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
- 未跟踪的 .tmp/ 含测试日志、挂载数据库、提取的 asar 和临时推送脚本；其中可能出现
  临时 DSH web token、本机路径和提交邮箱。它被 .gitignore 忽略，不在 Git 历史或 tarball
  中；发布前应删除，不能作为交付物。

历史处理建议（未执行，需用户授权）：

1. 接受现状：仓库保持 private，公开时明确这些是开发机路径；不改写已推送历史。
2. 重写历史：用 git filter-repo 替换这两个路径，然后 force-push；需要协调所有克隆，
   且会改写 commit SHA。
3. 新历史：以当前树开一个新仓库/新 root commit，保留旧仓库为归档；最干净，但丢失
   现有提交谱系。未获得授权前不执行 2 或 3。

## 5. 许可证

当前没有 LICENSE，package.json 没有 license 字段，README 标注 TBD；不得对外称为
open source。两个候选：

| 许可 | 优点 | 代价 |
| --- | --- | --- |
| MIT | 最短、集成摩擦最低、插件生态常见 | 无显式专利授权 |
| Apache-2.0 | 显式专利授权、贡献/通知条款更完整 | 文本更长，需 NOTICE/合规说明 |

建议：若希望给下游插件作者明确的专利授权，选 Apache-2.0；若只追求最小集成摩擦，
选 MIT。最终由用户决定。

选择后需要改：

- 新增 LICENSE（Apache-2.0 还需 NOTICE，如适用）
- package.json 增加 "license"
- README 的 License 段替换 TBD
- 如发布 npm，评估是否移除 "private": true；公开发布 GitHub 不等同于 npm publish

## 6. 已知限制与未验证项

- 仅实测 macOS arm64；Windows 未验证。
- node:sqlite 仍标记 Experimental；升级 Node/DSH 需要重跑全量测试与挂载。
- namespaceId 不是认证/授权边界；无加密、无多租户隔离。
- purge 只删除当前库行；不会清除历史备份、WAL、云同步版本历史或文件系统快照。
- 迁移前备份默认保留 3 份；备份加密/异地保留/恢复演练仍待产品决定。
- 干净 `npm ci` 使用本机 npm cache；tarball 安装到 profile 时还需要 registry 提供 zod，未证明完全断网可用。
- 未执行 npm publish、GitHub 公开切换、Windows CI、并发写/多进程压力测试。
- 中文 2 字查询走 LIKE，O(n)；无分词器/向量检索。

## 7. 公开发布步骤（建议顺序）

1. 决定许可证并添加 LICENSE/package.json/README 变更。
2. 决定历史路径处理方案；若重写，先备份并通知所有克隆。
3. 在普通 checkout 确认文件模式（100644，脚本 100755），不要依赖云同步工作副本。
4. 选择 Windows 支持策略：补 CI/实机验证，或明确标注 unsupported/untested。
5. 决定备份加密、保留周期和恢复演练 owner。
6. 跑完整门禁：typecheck、test、coverage、examples、test:dsh、test:tarball、pack 审计。
7. 仓库转 public 前再次扫描 secrets/历史/许可证；转 public 后再做 GitHub release/tag。
8. 若要 npm 发布：移除 private、确认包名可用、npm publish --dry-run、再正式 publish。

在以上 1–5 未完成前，当前结论是：**私有候选包可审计、可安装、可挂载；不是公开可发布版本。**
