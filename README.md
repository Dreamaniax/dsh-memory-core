# DSH Memory Core

Reusable, local-first long-term memory infrastructure for the DSH plugin ecosystem.

> 状态：v0.1.0 公开发布。Sprint 1–4 与发布收口已完成，50 项自动化测试通过，核心服务行/函数覆盖率 >=85%；干净 tarball 安装到隔离 DSH_HOME 后再次通过 create/read/search/feedback/重启持久化验证；验证过程未写入真实 DSH profile；**MIT License**；npm 包为 `@dreamaniax/dsh-memory-core`，GitHub 仓库公开；Windows 未验证，不宣称支持。
>
> 当前能力：SQLite Store、迁移、备份、健康检查、namespace-scoped CRUD/版本/软删除/purge、来源追踪、FTS5/LIKE 关键词搜索、confirm/correct/reject/flag 反馈、Cordis `memoryCore` Service、Library 入口。

## 为什么

DSH 插件（Weekly Retro、Prompt Optimizer、未来的 research/workflow agents）都需要长期记忆：semantic / episodic / procedural、来源追踪、生命周期、用户反馈、关键词检索。每个插件各写一套 JSON/SQLite 会重复实现存储、迁移、备份与安全边界。

Memory Core 提供一个共享的进程内服务与可独立导入的库：

- **Local-first**：无网络、无 LLM API、无向量库。
- **Plugin-agnostic**：不依赖任何消费方业务代码。
- **Traceable**：来源、版本、反馈、审计。
- **Controlled mutation**：校验、事务、乐观并发、软删除与独立 purge。
- **Replaceable storage**：消费者只用公共 API，不碰 SQLite。

## v0.1 范围

- SQLite + FTS5（`node:sqlite`；Node >=22.19）。
- 六张业务表：memory_items、memory_versions、sources、memory_sources、memory_feedback、memory_fts。
- 四类记忆：working / semantic / episodic / procedural。
- 状态：candidate / active / flagged / rejected / deleted；过期由 expires_at 计算。
- 来源：direct / inferred / imported + sources 多对多。
- 反馈：confirm / correct / reject / flag；request_id 幂等；版本历史。
- 公共 API：createMemory、getMemory、listMemories、updateMemory、deleteMemory、purgeMemory、addSource、getSources、getMemoryVersions、searchMemories、submitFeedback、addMemoryFeedback、getFeedbackHistory、rebuildSearchIndex、backupTo、healthCheck、close。
- DSH 集成：`memoryCore` Service + `./plugin` 入口；默认数据库 `$DSH_HOME/memory-core/memory.sqlite3`，可配置覆盖。

明确不做：向量库、embedding、自动 LLM 抽取、自动 consolidation、多机同步、复杂用户画像、HTTP 服务。

## 支持平台与运行时

| 项目 | 状态 |
| --- | --- |
| macOS arm64 | 已实测（DSH Desktop 0.2.2-rc.3 / Cordis 4.1.0） |
| Windows | **未验证**；本版本不宣称支持 |
| Linux | 未验证 |
| Node.js | `>=22.19.0`（`package.json` 的 `engines`） |
| DSH | `>=0.2.2-rc.1`（`package.json` 的 `dsh.engines`） |
| SQLite 驱动 | `node:sqlite`，当前 Node 仍标记为 Experimental |

> `node:sqlite` 在受支持 Node 版本中仍标记为 Experimental；升级 Node 或 DSH 必须重新跑全量测试、隔离挂载和 tarball 门禁。本版本不承诺跨 Node 版本的 API/ABI 稳定性。

## 架构速览

~~~text
Consumer plugins
      │ ctx.memoryCore
┌─────▼──────────────────────────────┐
│ Memory API (validation/errors)     │
│ Memory Manager (use cases/tx)      │
│ Services (memory/source/search/    │
│           feedback)                │
│ Repositories (parameterized SQL)   │
│ SQLite Store + Migrator + FTS5     │
└─────┬──────────────────────────────┘
      │ node:sqlite
$DSH_HOME/memory-core/memory.sqlite3
~~~

## 安装到 DSH

v0.1.0 是公开包 `@dreamaniax/dsh-memory-core`。包必须能被目标 DSH profile 解析到；推荐作为 profile 的 bundle 依赖，不要复制进业务项目目录。验证环境为 DSH Desktop 0.2.2-rc.3 / Cordis 4.1.0。

### 从 npm registry 安装

准备一个**已存在**的目标 profile；开发/验收请使用隔离的 `DSH_HOME`，不要拿真实 `~/.dsh` 做测试。下面用 `$PROFILE` 表示该 profile 目录：

~~~bash
# 例：PROFILE="$DSH_HOME/profiles/web"
npm install @dreamaniax/dsh-memory-core@0.1.0 --prefix "$PROFILE" \
  --legacy-peer-deps --ignore-scripts --no-audit --no-fund
~~~

若 profile 由其它包管理器维护，请按该 profile 的方式安装同一包。在该 profile 的 `package.json` 中确认依赖与 bundle：

~~~json
{
  "dependencies": {
    "@dreamaniax/dsh-memory-core": "0.1.0"
  },
  "dsh": {
    "profile": {
      "bundles": ["@dreamaniax/dsh-memory-core"]
    }
  }
}
~~~

### 从源码或本地 tarball 安装

不经过 registry 时，从当前仓库构建并打包：

~~~bash
npm ci
npm run build
TARBALL="$(npm pack --silent | tail -n 1)"
npm install "$PWD/$TARBALL" --prefix "$PROFILE" \
  --no-save --legacy-peer-deps --ignore-scripts --no-audit --no-fund
~~~

`--no-save` 不会改 profile 清单；在该 profile 的 `package.json` 中补充（`file:` 必须是 tarball 绝对路径）：

~~~json
{
  "dependencies": {
    "@dreamaniax/dsh-memory-core": "file:/absolute/path/to/package.tgz"
  },
  "dsh": {
    "profile": {
      "bundles": ["@dreamaniax/dsh-memory-core"]
    }
  }
}
~~~

DSH 启动时读取包内 `cordis.patch.yml`，插入 `@dreamaniax/dsh-memory-core/plugin`。不同 profile 的包管理方式可能不同；`tests/integration/dsh-boot-verify.sh` 与 `dsh-tarball-verify.sh` 是可执行参考。

### 配置

默认配置即可启动；未设置 `DSH_HOME` 时回退到 `~/.dsh`，数据库路径默认取 `$DSH_HOME/memory-core/memory.sqlite3`。可用 Cordis patch 覆盖：

~~~yaml
- insert:
    - id: dsh-memory-core
      name: "@dreamaniax/dsh-memory-core/plugin"
      config:
        path: /absolute/path/to/memory.sqlite3
        journalMode: wal
        busyTimeoutMs: 5000
        synchronous: NORMAL
        backupBeforeMigrate: true
        backupDir: /absolute/path/to/backups
~~~

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `path` | 空 | 空表示 `$DSH_HOME/memory-core/memory.sqlite3`；非空时原样使用，不展开 `~` 或环境变量 |
| `journalMode` | `wal` | `wal` / `delete` / `truncate` / `persist` |
| `busyTimeoutMs` | `5000` | 0..60000 |
| `synchronous` | `NORMAL` | `NORMAL` / `FULL` |
| `backupBeforeMigrate` | `true` | 已有库发生待应用迁移前先备份 |
| `backupDir` | 空 | 空表示数据库同目录；迁移备份保留最近 3 份 |

打开或迁移失败会让插件激活失败，不会静默回退到内存库。插件卸载时通过 `ctx.effect` 关闭数据库。

### 消费者用法

~~~ts
ctx.inject(['memoryCore'], (ctx) => {
  const memory = ctx.memoryCore
  // await memory.createMemory(...)
  // await memory.searchMemories(...)
})
~~~

独立脚本/测试可以直接使用 Library 入口：

~~~ts
import { openMemoryCore } from '@dreamaniax/dsh-memory-core'

const core = await openMemoryCore({ path: '/tmp/memory.sqlite3' })
const memory = await core.createMemory({
  namespaceId: 'weekly-retro',
  type: 'episodic',
  status: 'active',
  content: '2026-W46：周报采集被 npm 网络阻塞。',
  sources: [{ type: 'plugin', externalRef: 'weekly-retro/run-1' }],
})
const hits = await core.searchMemories({
  namespaceId: 'weekly-retro',
  query: '周报 采集',
  statuses: ['active', 'candidate'],
})
console.log(memory.id, hits.total)
await core.close()
~~~

库入口只使用公共 API；测试、CLI、迁移工具可复用同一套契约。生产插件应使用 Service，以保证单实例与生命周期。

## 备份、恢复与删除边界

`backupTo(path)` 使用 SQLite online backup API：先写临时文件，做 `integrity_check`，成功后原子 rename；目标权限 0600，父目录 0700。**v0.1 不加密备份**，也不替代操作系统级磁盘加密。

~~~ts
const result = await core.backupTo('/tmp/memory-backup.sqlite3')
console.log(result.path, result.bytes)
~~~

### 自动迁移备份与保留

`backupBeforeMigrate` 默认 `true`：已有数据库发生待应用迁移前，先做 online backup。备份写到 `backupDir`；为空时写到数据库同目录，文件名形如 `memory.sqlite3.bak-<ISO 时间戳>`。自动迁移备份按文件名排序只保留最近 **3** 份。

保留 3 份只适用于自动迁移备份；手动 `backupTo` 不自动清理旧文件。备份默认不加密、不异地保存。

### 风险与用户保护

备份包含全部记忆正文、来源、版本和反馈，属于敏感数据。`backupTo` 只保证文件权限和 `integrity_check`，**不提供加密、密钥管理、访问控制或安全擦除**。请自行：

- 开启全盘加密（macOS FileVault、Windows BitLocker、Linux LUKS 等）；
- 限制备份目录权限，不要把备份放进公共目录；
- 对需要离机的备份使用加密卷/加密归档，并保留离线或异地副本；
- 定期清理不需要的旧备份，做一次真实恢复演练。

### 恢复

恢复不是在线 API；必须停止 DSH（或先 `close()`），把备份文件放到配置的数据库路径，确认同目录没有残留 `-wal`/`-shm`，再启动并调用 `healthCheck()`。恢复前保留当前文件，恢复后验证 `integrity_check`、`foreign_key_check` 与 FTS integrity-check。

### 删除边界

- `deleteMemory` 只做软删除，行仍在当前库中；不会从备份中删除。
- `purgeMemory` 是独立特权操作，必须提供 `PURGE:<namespaceId>:<memoryId>` 确认 token；它物理删除当前库中的记忆行并级联 versions/feedback，清理失去引用的自动创建来源。
- purge **不会**清理历史备份、WAL、文件系统快照或云同步版本历史；也不承诺安全擦除。需要彻底清除时，必须在停库后同时处理这些副本。

## 安全与已知限制

- `namespaceId` 是数据隔离标识，**不是认证或授权**。同进程插件默认互信；多租户/远程调用必须在可信边界另行鉴权。
- 无内置加密、无密钥管理、无安全擦除；文件权限是 0700/0600，磁盘加密由宿主/用户负责。
- 不联网、不写遥测、不调用 LLM；错误对外只暴露稳定 code，不返回 SQL 或正文。
- 关键词检索：FTS5 trigram 覆盖长词；短于 3 个 code point 的词走 LIKE，复杂查询是 O(n)，大数据量下比 FTS 慢。
- 中文 2 字词可检索但依赖 LIKE；没有分词器/向量检索/语义召回。
- 单进程、单写连接；WAL 不适合网络盘；仅 macOS arm64 实测，Windows/Linux 未验证，不宣称支持（见支持平台表）。
- `node:sqlite` 仍标记 Experimental；升级 Node/DSH 必须重新跑全量测试、隔离挂载和 tarball 门禁。本版本不承诺跨 Node 版本的 API/ABI 稳定性。
- 无自动抽取、自动 consolidation、归档恢复 UI、HTTP/工具层、跨 namespace 关系。
- 容量数字见 [docs/CAPACITY_AND_EVOLUTION.md](docs/CAPACITY_AND_EVOLUTION.md)；十年场景是模型估算，不是实测预测。

## 示例

两个示例只依赖公共 Library API，使用临时数据库并在 `finally` 清理：

~~~bash
node examples/weekly-retro/ingest.mjs --selftest
node examples/prompt-optimizer/ingest.mjs --selftest
~~~

- Weekly Retro：写入 procedural lesson、确认反馈、检索并校验版本/来源。
- Prompt Optimizer：写入 candidate、用 correct 反馈产生新版本并检索。

## 开发与验收

~~~bash
export npm_config_cache="$PWD/.tmp/npm-cache"
npm run typecheck
npm test
npm run test:coverage
npm run test:examples
npm run test:dsh          # 隔离 DSH_HOME 的真实挂载验证；需要本机 DSH app
npm run test:tarball      # 从 git archive HEAD 干净构建 tarball，再安装到隔离 DSH_HOME 挂载
npm run benchmark
npm pack --dry-run        # 发布内容审计
~~~

挂载测试会创建临时 `DSH_HOME`，安装本包与 probe 插件，启动 DSH，验证 `ctx.memoryCore` 的 create/get/search/feedback/close、重启持久化和干净关闭；默认不保留临时目录，设置 `KEEP_DSH_BOOT_ARTIFACTS=1` 可保留证据。它不会写真实 `~/.dsh`。tarball 门禁使用 `git archive HEAD` 的干净副本（因此不要在未提交的工作区上把它当成最终证据），并校验 0644 文件模式、包内容和敏感路径；它需要本机 DSH app。

tarball 门禁会先用 `npm cache add zod@4.6.6` 预热测试 cache，再以 `--offline` 把 tarball 安装到临时 profile：冷缓存首次需要 npm registry 一次，预热后安装不发起 HTTP 请求；它不会手工复制 `node_modules`。若要在完全断网的 CI 中运行，先预热 `.tmp/npm-cache`。完整 tarball 证据与失败复现见 [发布就绪审计](docs/RELEASE_READINESS.md)。

## 文档

- [Phase 0 环境调查报告](docs/PHASE0_INVESTIGATION.md)
- [Phase 0 证据日志](docs/PHASE0_EVIDENCE.md)
- [架构设计](ARCHITECTURE.md)
- [数据库 Schema](DATABASE_SCHEMA.md)
- [API 契约](API_REFERENCE.md)
- [安全与隐私](docs/SECURITY_PRIVACY.md)
- [容量与演进](docs/CAPACITY_AND_EVOLUTION.md)
- [Phase 1 收口报告](docs/PHASE1_CLOSEOUT.md)
- [Sprint 1 实施报告](docs/SPRINT1_REPORT.md)
- [Sprint 2 实施报告](docs/SPRINT2_REPORT.md)
- [Sprint 3 实施报告](docs/SPRINT3_REPORT.md)
- [Sprint 4 实施与发布报告](docs/SPRINT4_REPORT.md)
- [发布检查清单](docs/RELEASE_CHECKLIST.md)
- [发布就绪审计（tarball/历史/许可证）](docs/RELEASE_READINESS.md)
- [实施计划与验收](IMPLEMENTATION_PLAN.md)
- ADRs：
  - [0001 TypeScript ESM](docs/adr/0001-typescript-esm.md)
  - [0002 node:sqlite](docs/adr/0002-node-sqlite.md)
  - [0003 进程内 Service + Library](docs/adr/0003-in-process-service.md)
  - [0004 FTS5 trigram](docs/adr/0004-fts5-trigram.md)
  - [0005 迁移与备份](docs/adr/0005-migrations-backup.md)
  - [0006 namespace 与删除](docs/adr/0006-namespace-deletion.md)
  - [0007 包入口](docs/adr/0007-package-entries.md)
  - [0008 namespace-scoped identity](docs/adr/0008-identity-scope.md)
  - [0009 状态/删除分离](docs/adr/0009-mutation-and-purge.md)

## 待批准的关键决策

1. TypeScript + ESM + Node >=22.19；tsc 构建；node:test 测试。
2. node:sqlite 驱动；不引入原生模块。
3. 进程内 Cordis Service + Library；v0.1 无 HTTP/IPC。
4. 默认路径 `$DSH_HOME/memory-core/memory.sqlite3`。
5. 六表 schema；身份是 (namespaceId, id)，不同 namespace 可复用 id。
6. FTS5 trigram + <3 字符 LIKE 回退；无向量。
7. createMemory 默认 candidate；update 不改 status，状态只走 feedback/delete/purge。
8. deleteMemory 只软删除；purgeMemory 独立特权 token；purge 级联 versions/feedback，备份可能保留已删内容。
9. namespace 只是隔离，不是认证。
10. 包名 `@dreamaniax/dsh-memory-core` + `./plugin` 入口；不修改现有插件。

完整审批清单见 [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) 第 10 节。

## 非目标与后续

v0.1 的边界与 v0.2 backlog 见 [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) 第 9 节。

重点：中文分词/双索引、向量检索、自动抽取、多 agent 同步、恢复 API、多租户授权、加密备份、归档恢复。

## License

本项目采用 [MIT License](LICENSE)。Copyright (c) 2026 Dreamaniax。

运行时依赖 zod@4.6.6 为 MIT；包内不包含 TypeScript（Apache-2.0，仅构建期开发依赖，不随 tarball 分发）。package-lock 中记录的 @deepseek-ai/cordis 4.1.0、@deepseek-ai/cosmokit 1.9.0、@deepseek-ai/schemastery 3.19.0、@standard-schema/spec 1.1.0 与 undici-types 7.24.6 均为 MIT。未发现与 MIT 分发冲突的依赖许可；未来新增依赖时发布前重新审计。

npm 包 `@dreamaniax/dsh-memory-core@0.1.0` 采用 MIT License；GitHub 仓库与 npm 包均已公开发布。
