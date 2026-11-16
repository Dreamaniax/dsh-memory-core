# Sprint 4 实施报告 — DSH 集成与发布准备

- 日期：2026-11-15
- 状态：实现与隔离挂载验证完成；v0.1.0 已公开发布
- 范围：Cordis `memoryCore` Service、`./plugin` 入口、隔离 DSH_HOME 真实挂载、两个消费者示例、安装/配置/备份/安全文档、npm pack 内容审计
- 不在范围（Sprint 4 当时）：npm publish、许可证选择、Windows 实机验证、真实 DSH profile 安装、tarball 安装门禁、Git 历史重写；其中 tarball 安装门禁与文件模式已在发布收口补齐，许可证与公开发布已在 v0.1.0 release 完成，见 docs/RELEASE_READINESS.md
- 基线：Sprint 3 的 43 项测试；Sprint 4 后 47 项测试

## 1. 本轮交付

### 1.1 Cordis Service 与包入口

- `src/plugin.ts`
  - `MemoryCoreService extends Service`，服务名 `memoryCore`。
  - `static inject = []`；服务通过 `[Service.init]()` 打开 `openMemoryCore`。
  - 打开失败时激活失败，不回退到内存数据库；避免静默丢数据。
  - `ctx.effect(() => async () => this.close(), 'memoryCore.close')` 注册清理。
  - `close()` 幂等且可重试：关闭成功后清空句柄；关闭抛错时保留句柄，允许 Cordis effect 再次关闭，避免连接泄漏。
  - 类实现 `MemoryApi`，逐方法委托给底层 API。
  - `static Config` 使用 schemastery 定义配置。
- `src/plugin-config.ts`
  - `resolveDshHome(env)`：显式 `DSH_HOME` 优先，否则 `~/.dsh`。
  - `resolveMemoryCorePath(configuredPath, env)`：显式 `path` 优先，否则 `$DSH_HOME/memory-core/memory.sqlite3`。
- 插件配置键：`path`、`journalMode`（wal/delete/truncate/persist）、`busyTimeoutMs`（0..60000）、`synchronous`（NORMAL/FULL）、`backupBeforeMigrate`、`backupDir`；默认路径与默认值见 README 与 API_REFERENCE 3.12。
- `cordis.patch.yml`：插入 id `dsh-memory-core`、name `@dreamaniax/dsh-memory-core/plugin`。
- `package.json`
  - 新增 `exports['./plugin']`（types + default）。
  - `files` 包含 `cordis.patch.yml` 与 `examples`。
  - `peerDependencies`：`@deepseek-ai/cordis ~4.1.0`、`@deepseek-ai/schemastery ~3.19.0`。
  - `dsh.engines.dsh >=0.2.2-rc.1`、`dsh.bundle.patch ./cordis.patch.yml`。
  - 发布时移除 `private`，作为 `@dreamaniax/dsh-memory-core@0.1.0` 公开到 npm。
- `types/cordis.d.ts`、`types/schemastery.d.ts`：本地最小 peer 类型，仅用于编译；不打进发布包。

### 1.2 隔离 DSH_HOME 真实挂载

测试夹具与脚本：

- `tests/integration/dsh-boot-verify.sh`：创建临时 DSH_HOME，调用 DSH CLI 生成 web profile，准备包与 probe，启动 `dsh web`，检查证据，清理进程与临时目录。
- `tests/integration/dsh-boot-prepare.mjs`：默认把 `package.json`、`cordis.patch.yml`、`lib`、`migrations` 复制到 profile 的 `node_modules/@dreamaniax/dsh-memory-core`；也支持把真实 tarball 安装到 profile；复制 probe；把 bundle 加入 profile；写入 probe 的 `cordis.patch.yml`。
- `tests/fixtures/dsh-mount/probe/index.js`：真实 Cordis 插件，`inject: ['memoryCore']`，分 write/read 两阶段执行 create/get/search/feedback/health/close。
- `tests/integration/check-dsh-evidence.mjs`：校验两阶段 JSON、同一 memoryId、health、关闭拒绝、默认 DB 路径、无 WAL/SHM 残留。
- `tests/unit/plugin-config.test.mjs`（4 项）：DSH_HOME 优先、默认 `~/.dsh`、默认 DB 路径、显式 path 优先。

实测环境：DSH Desktop 0.2.2-rc.3，Electron 44.7.0，Node 24.21.0；macOS arm64。

实际结果：

~~~text
{
  "ok": true,
  "memoryId": "495dcb52-5c76-46d8-9a25-306bcb5204a1",
  "database": "<temp DSH_HOME>/memory-core/memory.sqlite3",
  "writeHits": 1,
  "feedbackTotal": 1
}
DSH mount verification passed
~~~

验证内容：

1. loader 接受 `@dreamaniax/dsh-memory-core/plugin` 子路径，未回退到其他入口。
2. probe 通过 `ctx.memoryCore` 获得服务，完成 create、get、search、feedback、healthCheck。
3. 写阶段关闭服务后再次读取返回失败，证明 close 生效。
4. 重启 DSH 后 read 阶段读到同一 memoryId，证明默认路径持久化。
5. 干净关闭后 DB 目录无 `-wal`/`-shm` 残留。
6. 测试未写入真实 `~/.dsh/profiles/web`；实机 mtime 保持 2026-11-12 15:28。

### 1.3 两个独立消费者示例

两者都只使用包根公共 `openMemoryCore`，使用 OS 临时目录，`--selftest` 必需，`finally` 关闭并删除临时库。

- `examples/weekly-retro/ingest.mjs`
  - 写入 2 条 procedural 经验，各带 session 来源。
  - confirm 后断言 active。
  - 搜索 `compaction` 命中，列表 2 条，版本 >=2，来源 1，反馈 1。
- `examples/prompt-optimizer/ingest.mjs`
  - 写入 candidate procedural 记忆。
  - `submitFeedback` correct（requestId `prompt-optimizer:revision-2`），断言 active、version 2、metadata revision 2。
  - 搜索 `acceptance evidence` 命中，来源 1，版本 2，反馈 1。

实测输出：

~~~json
{"ok":true,"example":"weekly-retro","database":"<temp>/memory.sqlite3","memories":2,"searchHits":1,"versions":2,"feedback":1}
{"ok":true,"example":"prompt-optimizer","database":"<temp>/memory.sqlite3","version":2,"searchHits":1,"sources":1,"versions":2,"feedback":1}
~~~

### 1.4 文档

- README：状态、安装/bundle patch、配置、Library/Service 用法、备份恢复、安全边界、已知限制、示例、验收命令、许可证待定。
- ARCHITECTURE：Sprint 4 状态、插件架构、配置、挂载证据与限制。
- API_REFERENCE：3.12 Cordis Service 契约。
- IMPLEMENTATION_PLAN：Sprint 4 结果与后续发布门禁。
- DATABASE_SCHEMA：Sprint 4 无新增迁移，继续使用 001。
- docs/SECURITY_PRIVACY.md：运行配置、备份恢复、明确安全边界与清除限制。
- docs/CAPACITY_AND_EVOLUTION.md：10k 实测与十年情景估算分离。
- docs/RELEASE_CHECKLIST.md：已验项、公开发布前门禁、已知限制。
- ADR 0001–0005、0007、0008、0009 标记 Accepted；0006 保留部分失效说明；0003/0007 补充真实挂载证据。
- docs/SPRINT4_REPORT.md：本文件。

## 2. 验证证据

### 2.1 类型检查与全量测试

~~~bash
npm run typecheck
npm run test:coverage
~~~

结果：

~~~text
typecheck: exit 0
tests: 47
pass: 47
fail: 0
duration_ms: 248.860875
~~~

测试构成：database 7、migrations 6、memory-api 10、search 5、feedback 7、query-builder 8、plugin-config 4。

### 2.2 覆盖率

~~~text
all files                |  95.80 |    85.07 |   94.72
feedback-service.js      |  94.35 |    89.66 |  100.00
memory-manager.js        |  90.76 |    85.29 |  100.00
search-service.js        | 100.00 |   100.00 |  100.00
source-service.js        | 100.00 |    86.36 |  100.00
version-writer.js        | 100.00 |   100.00 |  100.00
keyword-search.js        | 100.00 |    95.83 |  100.00
query-builder.js         |  93.88 |    86.05 |  100.00
memory-repository.js     | 100.00 |    93.75 |  100.00
feedback-repository.js   | 100.00 |    85.71 |  100.00
rows.js                  |  88.19 |    72.73 |   81.25
sqlite-store.js          |  82.89 |    53.23 |   86.36
~~~

整体行/函数/分支均 >=85%；`plugin.ts` 不在 Node 覆盖率统计内，由真实挂载测试行为覆盖。`sqlite-store.js` 的防御分支覆盖率较低，仍是后续补测项。

### 2.3 挂载与示例

~~~bash
npm run test:dsh
npm run test:examples
~~~

均 exit 0；证据见 1.2、1.3。

### 2.4 npm pack 内容审计

Sprint 4 当时执行：

~~~bash
npm_config_cache="$PWD/.tmp/npm-cache" npm pack --dry-run --json
~~~

发布收口后补充了真实 tarball 门禁：从 git archive HEAD 的干净副本 npm pack，安装到临时 DSH_HOME profile 并重跑挂载 probe；同时校验全部文件为 0644、无测试/数据库/缓存/密钥/个人路径。命令为 `npm run test:tarball`，详见 docs/RELEASE_READINESS.md。

门禁在安装 profile 前先用 `npm cache add zod@4.4.3` 预热测试 cache，再以 `--offline` 执行 `npm install <tarball>`。此前复现到：测试 cache 只有 `zod-4.4.3.tgz`、没有 packument 时，offline 安装报 `ENOTCACHED`；网络慢时非 offline 安装会卡在 `fetch manifest zod@4.4.3`。这是测试缓存预热缺口，不是 package.json 缺少依赖；修复没有手工复制 `node_modules`。冷缓存首次仍需要 registry 一次，预热后的 profile 安装不发起 HTTP 请求。

发布收口 tarball 结果：

| 项 | 值 |
| --- | ---: |
| 文件数 | 139 |
| packed size | 130,527 bytes（commit 542182d 的 gate） |
| unpacked size | 481,319 bytes |

包含：`lib`（js/d.ts/map）、`migrations/001_initial.sql`、`cordis.patch.yml`、根文档、`docs/`（ADR、阶段报告、发布清单）、`examples/`（两个 ingest 与 README）。

不包含：数据库、WAL/SHM、`.env`、密钥、日志、缓存、`node_modules`、测试目录、临时文件、`* 2.*` 重复构建产物。审计后未发现可疑路径。包内不包含 `types/`（仅编译期使用）。

## 3. 安全与边界

- 所有验证使用 OS 临时目录与临时 `DSH_HOME`；测试没有写入真实 `~/.dsh` profile，没有修改现有插件。为确认未误写，只读取了 `~/.dsh/profiles/web` 的 mtime。会话期间 `~/.dsh/profiles/desktop` 的 pnpm 元数据被 DSH 宿主更新（不是本仓库测试命令），未纳入验收范围。
- 包保持 private；没有执行 npm publish。
- `namespaceId` 是数据隔离，不是授权边界；服务不提供认证。
- 没有加密；SQLite 文件权限由 Store 设为 0600，目录 0700。
- purge 只删除当前数据库中的行；不会清除历史备份、WAL 快照、云同步版本历史或文件系统残留。
- 默认备份保留 3 份；备份位置与加密策略仍需产品决定。
- `node:sqlite` 仍标记 Experimental；本机仅在 macOS arm64 + Node 22.22.0/24.21.0 环境验证。
- 当前云同步工作副本的本地 mode 不可靠；commit f6a65be 把索引规范为 77 个 100644 + 1 个 100755，随后 tarball gate 新增文件，当前 HEAD 为 79 个 100644 + 2 个 100755（两个直接执行的验证脚本）。普通 checkout 仍需复核。
- 当前 Git 历史仍包含早期文档中的本机绝对路径；当前文件已脱敏，但历史需要用户决定接受/重写/新历史。
- package-lock 已在发布收口重新生成（lockfileVersion 3，含 peer 条目），并从全新 clone / git archive 干净副本执行 `npm ci` 通过。冷缓存首次需要 npm registry 提供依赖；tarball profile 安装由门禁预热 zod cache 后以 `--offline` 执行；完全断网的一次性安装仍未证明。

## 4. 未完成 / 发布门禁

1. 许可证：已选择 MIT；LICENSE、package.json、README 与 tarball 门禁均已更新。
2. ~~tarball 安装门禁~~：已在发布收口完成；真实 tarball 安装到隔离 DSH_HOME 并通过挂载 probe。
3. Windows 实机验证，或明确标注 unsupported/untested。
4. Git 历史中的本地路径处理（接受/重写/新历史）；文件 mode 已在 f6a65be 规范化。
5. 备份加密、保留策略与恢复演练。
6. 并发写、多进程、真实长文本、云同步目录下的 WAL 行为。
7. npm 发布已完成：scoped 名称 `@dreamaniax/dsh-memory-core`（unscoped 名称已被占用），`private` 已移除，`publishConfig.access=public`；lockfile/`npm ci` 已在全新 clone + 新 cache 条件下验证，冷缓存首次仍需 registry。
8. v0.2 候选：归档/降权阈值、跨 namespace 关系、createMemory 幂等、cursor 分页、向量检索、自动 consolidation。

## 5. 验收结论

- Cordis `memoryCore` Service 与 `./plugin` 入口已实现，并在隔离 DSH_HOME 中真实加载；不是纸面契约。
- create/read/search/feedback、关闭清理、重启持久化均通过真实 DSH 进程验证。
- 两个消费者示例独立通过自测，证明公共 API 可被外部插件复用。
- 47/47 测试通过；整体行/分支/函数覆盖率 95.80%/85.07%/94.72%。
- npm pack dry-run 内容干净；v0.1.0 已作为 `@dreamaniax/dsh-memory-core` 公开发布。
- 公开发布门禁已完成：MIT、历史路径决策、tarball 门禁与依赖缓存预热已收口；Windows/Linux 仍未验证，备份仍为 v0.1 默认策略。
