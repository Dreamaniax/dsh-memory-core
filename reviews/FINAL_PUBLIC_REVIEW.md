# Final Public-Source Review — DSH Memory Core v0.1.0

- 日期：2026-11-16
- 审查对象：Dreamaniax/dsh-memory-core，代码提交 81f9cd45d653e409b7a32e2d4eccaeab34678db4
- 代码 tree：c0d9e9fb895a6762b1ef5dd9287d2d14a866cfc4
- 结论：**适合公开 GitHub 源码**，保持包 private、不做 npm 发布；接受既定历史路径处理方案
- 仓库实际可见性（审查时）：**private**；tags 0；GitHub Releases 0
- 发布后记（2026-11-16）：用户随后明确授权公开发布；当前仓库/npm 状态与最终发布证据见 docs/RELEASE_READINESS.md 和 docs/RELEASE_CHECKLIST.md。本报告保留公开前审查口径。

## 1. 审查范围与工作区

本次审查覆盖：

1. 当前 Git 工作区、HEAD/tree、origin 与 GitHub 远端引用。
2. 代码审查基准 81f9 的 82 个跟踪文件、14 个可达 commit、158 个唯一 blob；加入本报告后的最终 tree 为 83 个跟踪文件，包内容不变。
3. 从 Git tree 构建的真实 npm tarball，以及将该 tarball 安装到隔离 DSH_HOME 后的挂载、重启持久化和关闭行为。
4. GitHub 实际可见性、tags、Releases 和包清单中的 private 标志。

先前审查已在临时目录对同一提交 81f9cd4 做过检查，目录随后删除；本次重新创建临时 clean checkout 独立复核，所有门禁均为本次新运行，没有引用旧输出作为本次证据。两处临时目录的绝对路径不在本报告复述，避免把本机绝对路径写回仓库。

## 2. Git 与 GitHub 状态

| 项目 | 本次结果 |
| --- | --- |
| 审查时代码提交 | 81f9cd45d653e409b7a32e2d4eccaeab34678db4 |
| 审查时代码 tree | c0d9e9fb895a6762b1ef5dd9287d2d14a866cfc4 |
| origin/main 与 GitHub refs/heads/main（审查时） | 81f9cd45d653e409b7a32e2d4eccaeab34678db4 |
| 远端代码 commit 的 tree | c0d9e9fb895a6762b1ef5dd9287d2d14a866cfc4 |
| 工作树 | clean，main...origin/main |
| GitHub 可见性 | private=true，visibility=private，archived=false，default_branch=main |
| Tags / Releases | 0 / 0 |
| package.json private | true |

GitHub API 返回的远端代码 commit tree 与本地代码 HEAD tree 完全一致，因此本次审查的代码提交就是 GitHub 当前 main 所指提交。

本次审查产生的文档提交在代码提交之上；其最终 Git 标识见最终回复和 git log。该提交新增 reviews/FINAL_PUBLIC_REVIEW.md 并更新 docs/RELEASE_CHECKLIST.md，不改变代码。

## 3. 门禁结果（本次新运行）

全部命令在 clean checkout 中运行；npm cache 使用隔离目录；DSH_HOME 使用临时目录。

| 门禁 | 命令 | 退出状态 | 证据 |
| --- | --- | --- | --- |
| Git clean checkout | git clone --no-hardlinks | 0 | HEAD 81f9cd4；tree c0d9e9；工作树 clean |
| 文件模式 | git ls-files -s | 0 | 80 x 100644，2 x 100755；两个 100755 都是直接执行的 shell 脚本 |
| 依赖安装 | npm ci --ignore-scripts --no-audit --no-fund | 0 | added 8 packages in 4s；使用全新隔离 cache |
| 类型检查 | npm run typecheck | 0 | 无错误 |
| 全量测试 | npm test | 0 | 47 tests，47 pass，0 fail，0 skipped，201.347584 ms |
| 覆盖率 | npm run test:coverage | 0 | lines 95.80%，branches 85.07%，functions 94.72% |
| 两个示例 | npm run test:examples | 0 | weekly-retro 与 prompt-optimizer 均 ok |
| 真实 tarball + 隔离挂载 | npm run test:tarball | 0 | 136,056 bytes；140 entries/files；requiredFiles 9；全部 0644；forbiddenPaths 0；contentFindings 0；zod 4.4.3；memoryId b27896bf-330c-44cd-92d3-2c44e6377570；DSH mount verification passed；tarball release gate passed |
| 独立 tarball 审计 | 从 git archive HEAD 构建后运行 check-tarball.mjs | 0 | 136,056 bytes；140 files；sha256 9ec2e66d83af9cd5d3a252b817e96b8577b2fd240568a20cdc241bd254daf0db |

tarball gate 的隔离挂载完成了 create/get/search/feedback/healthCheck/close、进程重启后读取同一 memoryId，以及关闭后无残留 WAL/SHM。数据库位于临时 DSH_HOME，不是真实 ~/.dsh。

真实 DSH profile 的 mtime 在审查前后保持 2026-11-12 15:28:55，未被测试写入。

### 最终文档树复核

包含更新后的 checklist 与本报告的文档树重新运行 npm run test:tarball：exit 0；136,782 bytes；140 entries/files；requiredFiles 9；全部 0644；forbiddenPaths 0；contentFindings 0；隔离挂载 memoryId 1a1694cf-42bd-4522-bc3b-fba151f03e41；DSH 挂载验证通过；tarball release gate passed。

从同一文档树用 git archive 独立构建的 tarball：136,782 bytes；140 files；check-tarball.mjs exit 0；sha256 33c84ab3079229685adde510dafbd205d85f4d24517c535341db886194a405be。

相对已通过上述 gate 的文档树，本报告的最终修订仅修改 reviews/；该目录不在 npm tarball 的 files 列表中，因此最终修订后的包内容与上述 gate 相同。

## 4. 当前树与历史审计

### 审查代码提交 81f9 的 tree

- 82 个跟踪文件；80 个 100644，2 个 100755。
- 本报告在 81f9 之外新增 reviews/FINAL_PUBLIC_REVIEW.md；最终 tree 为 83 个文件：81 个 100644、2 个 100755。
- 无数据库、WAL/SHM、.env、私钥、日志、会话正文、真实用户记忆或凭据。
- 无真实本机绝对路径。
- 无个人邮箱、GitHub token 或 AWS/Slack/OpenAI 风格凭据。
- 唯一路径样式命中是 tests/integration/check-tarball.mjs 中的审计正则（用户主目录、home 目录和云同步目录关键字），不是实际路径；tests 不进入 npm tarball。
- 唯一 token 样式命中是同一个测试文件中的 github token 扫描正则，不是实际 token；tarball contentFindings 为 0。

### 全部可达历史

- 代码审查基准 81f9 是 14 个 commit、158 个唯一 blob、0 个二进制 blob。
- 81f9 之后的报告/文档提交只新增 checklist 与 reviews/ 下的报告文件，不改变源码、迁移或包内容；因此最终 tree 只多出 1 个跟踪文件。
- 最大 blob 34,161 bytes，是 DSH_MEMORY_CORE_V0.1_ARCHITECTURE.md。
- 无数据库、日志、私钥、token、真实用户记忆或会话内容。
- 无 commit message 中的本机路径或凭据。
- 仅有的两条早期本机绝对路径位于 commit 2b214e6、87f63bf、c885311：
  - DSH_MEMORY_CORE_V0.1_ARCHITECTURE.md:14 的一个本机开发目录；
  - docs/PHASE0_INVESTIGATION.md:6 的云同步仓库目录。
- 这两条路径的具体值不在本报告复述；当前 HEAD 已不含它们。
- 按既定方案接受并保留，不重写历史、不 force-push。
- 提交身份是仓库维护者的已配置 Git 身份，不是凭据；公开后提交元数据可见。

### 文件与包内容

- 两个 100755：tests/integration/dsh-boot-verify.sh、tests/integration/dsh-tarball-verify.sh；均为直接执行的验证脚本。
- tarball 140 个文件全部为 0644，目录为 0755；无 tests、node_modules、数据库、缓存或日志。
- tarball 包含 LICENSE、README、docs、examples、lib、migrations 和 cordis.patch.yml。

## 5. 未验证或未执行的项

以下项目明确未验证，不应写成已通过：

- Windows 与 Linux 未运行；仅在 macOS arm64 上实测。
- 完全离线、空 npm cache 的首次安装未证明；tarball gate 的 cache 预热仍需要 npm registry 提供 zod packument 与 tarball。
- npm registry 发布未执行；包仍是 private:true。
- GitHub 可见性切换、公开 Release/tag 未执行，且本次未获授权。
- 公开后的 GitHub issue/PR、分支保护、社区流程未配置。
- node:sqlite 仍标记 Experimental；跨 Node 版本的 API/ABI 稳定性未承诺。

## 6. 公开后的实际影响

1. 所有源码和 Git 历史都会公开，包括早期两条本机绝对路径和提交维护者身份。两条路径已按既定方案保留；它们不含凭据、真实记忆或会话正文。公开后被 fork、克隆或缓存的内容无法保证撤回。
2. MIT License 允许使用、修改、再分发和商业使用；MIT 不含明确专利授权。依赖许可已核对，无与 MIT 分发冲突的运行时依赖。
3. GitHub 公开不等于 npm 发布。package.json 仍是 private:true；用户不能从 npm registry 安装，只能从源码构建 tarball 后安装，直到单独授权 npm 发布。
4. 备份默认保留最近 3 份、未加密、不异地；purge 不会清除备份、WAL、文件系统快照或云同步版本历史。公开文档应保留这些限制说明。
5. 不要在云同步工作副本中直接 npm pack；该环境可能产生 0700 文件模式。发布用 tarball 应从普通 clean checkout 或 git archive 构建；本次最终 tarball 已确认全部 0644。

## 7. 公开后可用的源码安装方式

在普通 clean checkout 中：

~~~bash
git clone https://github.com/Dreamaniax/dsh-memory-core.git
cd dsh-memory-core
npm ci
npm run build
TARBALL="$(npm pack --silent | tail -n 1)"
~~~

准备一个已存在的 DSH profile；开发/验收应使用隔离 DSH_HOME。以下 PROFILE 指该 profile 目录：

~~~bash
npm install "$PWD/$TARBALL" --prefix "$PROFILE" \
  --no-save --legacy-peer-deps --ignore-scripts --no-audit --no-fund
~~~

然后在该 profile 的 package.json 中增加 file: 依赖并登记 bundle：

~~~json
{
  "dependencies": {
    "dsh-memory-core": "file:/absolute/path/to/dsh-memory-core-0.1.0.tgz"
  },
  "dsh": {
    "profile": {
      "bundles": ["dsh-memory-core"]
    }
  }
}
~~~

要求：Node >=22.19.0，DSH >=0.2.2-rc.1；首次构建需要 npm registry。macOS arm64 已实测；Windows/Linux 未验证，不宣称支持。完整配置、备份、恢复和删除边界见 README。

## 8. 结论

**这个准确提交适合公开 GitHub 源码。** 代码、历史、tarball 内容、文件模式和隔离 DSH 挂载门禁均通过；仓库仍保持私有，package 仍为 private:true，未做可见性切换、Release 或 npm 发布。

没有代码级剩余修复。唯一需要用户确认的仍是既定历史决定：接受两条早期本机绝对路径并保留历史。如果改为要求历史中零本机路径，最短方案是重写历史或建立新历史；这会改变 commit SHA，本次未执行。

本报告位于 reviews/，不在 npm tarball 的 files 列表中；最终文档/报告提交的 Git 标识见仓库 git log 和本次回复。代码审查基准仍为 81f9cd45d653e409b7a32e2d4eccaeab34678db4。
