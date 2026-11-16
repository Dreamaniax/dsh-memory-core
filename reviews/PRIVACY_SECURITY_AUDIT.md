# DSH Memory Core v0.1.0 — 隐私与安全审计

- 审计日期：2026-11-16
- 审计对象：commit `692785481632f3a75e5029bb625d1d2076ef1c0f`（tree `d7fa483def91f170211fde6dce125c521115ed7b`，parent `f96d8bfbd56af9a3eef21b5173a4a7a349f8c7e6`）
- 审计范围：当前 tracked 树、全部可达 commit/分支/tag、commit 元数据、未跟踪/忽略文件、干净归档 tarball、公共 API 和数据边界
- 仓库状态（审计时）：GitHub private；package.json `private: true`；未切换可见性、未创建公开 Release/tag、未 npm publish
- 结论：**可继续作为私有发布候选；修复本次发现后，没有发现阻止公开源码的当前树秘密或凭据泄露。公开发布仍需用户明确决定；本次审计不等于批准切换可见性。**
- 发布后记（2026-11-16）：用户随后明确授权公开发布；当前仓库/npm 状态与发布证据见 docs/RELEASE_READINESS.md。本报告保留审计时口径。

## 1. 方法与证据来源

- 先读 `reviews/FINAL_PUBLIC_REVIEW.md`、`docs/SECURITY_PRIVACY.md`、`docs/RELEASE_CHECKLIST.md`、README 和 LICENSE，再把旧报告当作线索而不是结论。
- 使用 `dsh-privacy-guard` 的 PUBLIC CODE / PRIVATE DATA / EXPLICIT APPROVAL 规则；测试和示例只用合成数据；真实 `~/.dsh` profile 未写入。
- 当前树与历史用 Git 对象扫描；tarball 用 `git archive HEAD` 生成，再执行 `npm ci`、build、`npm pack`、内容/模式检查和隔离 DSH_HOME 挂载。
- 依赖使用 `npm audit`、`npm ls`、lockfile 和实际安装包检查；联网检查在本次审计时可用，但没有持续漏洞监控。
- 所有报告值均来自本次命令；旧报告中的 47-test / zod 4.4.3 数字是历史记录，不复用为当前证据。

## 2. 发现与修复

| ID | 严重度 | 发现 | 证据 | 处理 | 复测 |
| --- | --- | --- | --- | --- | --- |
| SEC-01 | High | zod 4.4.3 存在 GHSA-mrhx-c7xc-m3w5（过大约束集合导致内存耗尽，CVSS 7.5 / CWE-770） | `npm audit --omit=dev` 报 direct/fixAvailable false，range `<4.6.6` | 升级到 zod 4.6.6；tarball gate 固定 4.6.6 | 完整 `npm audit` 0 漏洞；50/50 测试通过 |
| SEC-02 | Medium | 已有数据目录/DB 的 0700/0600 只在创建时设置；旧目录 0755、DB/WAL/SHM 0644 不会被收紧 | 修复前 probe：目录 0755、DB 0644、WAL/SHM 0644、备份目录 0755；备份文件 0600 | `ensurePrivateDirectory`/`ensurePrivateFile` 打开时 chmod；SQLite 连接前收紧 `-wal`/`-shm` | `permissions.test.mjs`：目录 0700、DB/WAL/SHM 0600、备份目录 0700、备份 0600 |
| SEC-03 | Medium | 版本快照只检查 version 存在，不检查 snapshot 的 id/namespace 与行一致；被篡改的快照可能被当作正常数据返回 | `rowToMemoryVersion` 旧逻辑只验证 version | 要求 snapshot.version/id/namespaceId 与 row 完全相同 | 新增 malformed snapshot 测试，返回 CORRUPT_DATABASE |
| SEC-04 | Low | `openMemoryCore` 和 Cordis facade 的打开/关闭错误可能透出原始 Error，而非统一 `MemoryError` | 源码路径检查 | `openMemoryCore` 统一 `toMemoryError`；facade 使用 `MemoryError` | 新增 open-failure 测试，code STORAGE_ERROR 且消息不含路径/SQL |
| SEC-05 | Low | `.gitignore` 只覆盖 env/db，不覆盖私钥/证书扩展名 | 忽略规则检查 | 增加 pem/key/p12/pfx/crt/cer/der/p8 和常见 SSH key 名称 | 当前树仍无密钥；忽略规则为纵深防御 |
| DOC-01 | Low | 文档声称有日志字段、DELETE 只能由级联执行、权限始终 0700/0600，和实现不完全一致 | `docs/SECURITY_PRIVACY.md`、README | 改为“v0.1 无应用日志/未来日志字段约束”、“直接 SQLite 访问是信任边界”、“已有路径会被收紧” | 文档与代码/测试一致 |
| HIST-01 | Low（已接受） | 早期 commit 保留两条本机绝对路径；后续文档还有 cloud-sync 目录名片段 | 见 §4 | 不重写历史；禁止 force-push；由用户决定公开前是否重写 | 当前树无完整个人路径；tarball contentFindings 0 |

### 2.1 未发现的高风险项

- 当前 tracked 树没有真实姓名、私人邮箱、电话、地址、账号 ID、会话正文、用户记忆、研究秘密、token、私钥、证书或内部服务地址。
- 公共 API 的 SQL 全部参数化；FTS 词项整体加引号并绑定；LIKE 转义 `\`、`%`、`_`；未发现可注入路径。
- namespace 过滤覆盖 CRUD、来源、搜索、反馈和版本读取；未发现跨 namespace 的已确认越权路径。
- 错误映射不复制 SQL 文本；公开 details 只保留结构化字段。
- 当前树没有 DB/WAL/SHM/备份/日志/真实 profile 内容；这些路径在测试中均使用临时目录。
- 没有 Git submodule、symlink 或大二进制对象；最大历史对象 34,161 bytes。

## 3. 测试与 tarball 证据

本次在审计 commit 的同一棵树上执行：

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npm test` | 50 tests，50 pass，0 fail，0 skipped；约 306 ms |
| `npm run test:coverage` | 全部文件 lines 96.19% / branches 85.85% / functions 94.84% |
| `npm run test:examples` | weekly-retro 与 prompt-optimizer 均通过 |
| 干净 clone：`npm ci`、typecheck、`npm test`、examples | 全部 exit 0；50/50；clone 工作区 clean |
| `npm run test:tarball` | exit 0；137,707 bytes；140 entries/files；requiredFiles 9；全部 0644，目录 0755；forbiddenPaths 0；contentFindings 0；zod 4.6.6 |
| 隔离 DSH 挂载 | 通过：create/get/search/feedback/healthCheck/close、重启持久化、干净关闭；memoryId `0bde3bb1-2dea-44b9-9d47-8ac25122e0eb` |
| 完整 `npm audit` | 0 vulnerabilities（prod 2 / dev 3 / peer 4，总计 8） |

tarball 从 `git archive HEAD` 生成，不包含工作区 node_modules、未跟踪文件或构建缓存；包内 `private` 仍为 true、license 为 MIT。OneDrive 工作区直接 `npm pack` 可能产生 0700 文件模式，本次证据使用干净归档，不把该工作区产物当作发布物。

## 4. 历史与 GitHub 暴露

- 当前历史：19 个 commit，84 个 tracked 文件；只有 main 分支，无 tag。
- 早期 commit `2b214e6`、`c885311`、`87f63bf` 在 `DSH_MEMORY_CORE_V0.1_ARCHITECTURE.md:14` 和 `docs/PHASE0_INVESTIGATION.md:6` 保留过两条本机绝对路径。它们会暴露本机用户名、工作区/云同步目录结构，但不含 token、密钥、真实记忆或会话正文。
- 后续 commit `f6a65be`、`e762b9e` 的若干文档保留了 cloud-sync 目录名片段（`docs/PHASE0_INVESTIGATION.md:173`、`docs/RELEASE_CHECKLIST.md:23`、`docs/SECURITY_PRIVACY.md:123`、`docs/SPRINT4_REPORT.md:174/177`）；这是低敏感度的环境线索，不是凭据。
- 历史中的本机绝对路径前缀样式字符串与 GitHub-token 样式字符串来自 `tests/integration/check-tarball.mjs` 的检测正则，属于 scanner false positive，不是泄露。
- 当前树的完整个人路径已清理；历史路径保留是既有决定。若公开发布必须彻底移除，需要重写历史并 force-push；本次没有执行，也不会在未获批准时执行。
- commit 元数据只有一个 configured author/committer identity；邮箱只以 sha256 前缀 `ae053713e2f9` 记录，不在本报告重写原文。
- 审计前 GitHub 实际状态：private、default branch main、tags 0、Releases 0、Actions workflows 0、Issues 0、Pulls 0。报告提交后的远端状态以最终推送验证为准。

## 5. 依赖与供应链

- `package-lock.json` 为 v3；运行时依赖只有 zod 4.6.6；peer 为 DSH 提供的 Cordis/Schemastery；TypeScript 仅构建期 devDependency，不进入 tarball。
- 安装包和 lockfile 未发现 install/postinstall lifecycle 脚本；gate 的 profile 安装使用 `--ignore-scripts`。
- 完整 `npm audit` 在审计时返回 0；这是时间点结果，不是持续保证。
- 本次修复的 GHSA 是已知高危项；升级后没有发现新的 high/critical。未执行第三方 SBOM/签名验证或持续漏洞订阅。

## 6. 未验证项与残余风险

- Windows/Linux 未实测；POSIX 权限测试在 win32 跳过，Windows 上 chmod 只是 best-effort。
- 完全离线冷缓存首次安装未验证；tarball gate 仍需要 registry 至少一次来预热 zod packument/tarball。
- 未做动态渗透、fuzz、并发压力、真实恶意插件、供应链签名或长期漏洞监控。
- namespace 是隔离标识，不是认证/授权；同进程插件默认互信，这是产品边界。
- 无加密、无安全擦除；备份/云同步历史不会被 purge 清除。
- 早期两条本机路径仍可从历史读取；接受该风险或另做历史重写，二者只能由用户决定。

## 7. 发布建议

- 当前 commit 适合作为**私有**发布候选；当前树和 tarball 没有发现阻止公开源码的秘密/凭据泄露。
- 对公开 GitHub 源码：建议有条件通过。若用户接受早期两条本机路径的环境线索，可直接在明确批准后切换可见性；若要求零个人路径，则先重写历史并协调 force-push。
- 不建议在本审计中自动切换仓库可见性、创建公开 Release/tag 或 npm publish；这些动作需要用户显式授权。
- 公开前仍建议：重新跑本报告的命令、确认 GitHub 仓库/历史/Issues/Releases 状态、决定 LICENSE 与 npm 名称策略，并保留本报告的未验证项说明。不要宣称“零隐私风险”。

## 8. 复现命令

```bash
npm run typecheck
npm test
npm run test:coverage
npm run test:examples
npm audit
npm run test:tarball
git rev-list --count HEAD
git log --all --oneline
```

审计人：DSH coding agent（lead）；审计对象为上述 commit，不代表对未来的持续保证。
