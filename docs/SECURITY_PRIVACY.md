# DSH Memory Core v0.1 — 安全与隐私设计

- 状态：v0.1 已实现；威胁模型与限制已按 Sprint 4 验证结果更新
- 适用：宿主侧 Cordis Service + Library
- 数据：长期记忆正文、来源元数据、版本历史、用户反馈

## 1. 威胁模型

### 信任边界

- DSH 宿主插件是受信任代码，运行在宿主进程，拥有 Node 权限。
- Memory Core 的调用方可能是插件、CLI、未来 agent tool；输入可能来自 LLM 生成内容或导入的对话，按不可信数据处理。
- namespace 是数据隔离标识，不是认证；同一个宿主进程内的调用方默认互信。多租户/远程调用必须在更外层做授权。
- 浏览器 client 不直接访问 SQLite；未来如暴露 HTTP，必须单独做认证/授权。

### 主要威胁

1. SQL 注入：content/query/namespace/metadata 中带 SQL 片段。
2. FTS 查询语法注入：MATCH 中的引号、NEAR、*、^、:。
3. 资源耗尽：超长正文、超多 tags、巨大 metadata、深分页。
4. 数据泄露：日志/错误信息包含正文；备份权限过宽；namespace 越权。
5. 数据损坏：迁移失败、并发写、磁盘满、崩溃。
6. 误删/恶意删除：无确认的 purge；反馈/版本被篡改。
7. 跨进程竞争：Desktop 与 CLI 同时写同一 DB。

## 2. 输入校验

- 所有公共 API 输入用 zod strict schema 校验；未知字段拒绝。
- 长度/枚举/UUID/ISO 时间/置信度范围在 API 层校验；DB 层用 CHECK 作为第二道防线。
- namespace：1..64，^[a-z0-9][a-z0-9._-]*$；所有查询强制带 namespace。
- content：默认 1..100000 字符；DB 上限 1,000,000。
- metadata/JSON：必须 json_valid；序列化 <= 16KB。
- query：1..500 字符；拒绝 NUL；空白压缩。
- requestId：1..128，^[A-Za-z0-9._:-]+$。
- limit：1..100；offset >= 0。
- 所有错误返回 field/path，不返回正文。

## 3. SQL 与 FTS 安全

- 所有值通过 StatementSync 参数绑定；不把用户输入拼进 SQL 文本。
- 动态 SQL 只允许固定白名单：列名、排序字段、排序方向、状态枚举。
- FTS MATCH：把用户输入按空白切词，每个词用双引号包裹并转义内部双引号；作为单个参数绑定。
- 短查询 LIKE：转义 \、%、_，显式 ESCAPE。
- 不使用用户输入作为表名/列名/PRAGMA 值。
- 迁移 SQL 来自包内文件，不来自用户输入；checksum 校验。
- 测试覆盖：引号、注释、OR 1=1、NEAR、*、^、:、DROP TABLE、NUL、Unicode 边界。

## 4. 日志与错误

- v0.1 当前实现不输出应用日志，也没有遥测或调试日志开关；不记录 memory content/title/metadata/query 原文。
- 未来若增加日志，字段必须限于 event、code、namespaceId（可哈希）、memoryId（可哈希）、durationMs、rowCount，不得加入正文或原始查询。
- 错误 details 白名单：field、expectedVersion、actualVersion、requestId、limit、offset；不包含 content。
- 底层 SQLite 错误只作为 cause 保留在内部异常链；对外统一映射为 STORAGE_ERROR/STORAGE_BUSY/CORRUPT_DATABASE/MIGRATION_FAILED/CLOSED，不返回 SQL 文本或绝对路径。
- 调试模式（未来若增加）也不得默认打印正文；如需，必须用户显式开启并自担风险。

## 5. 文件与备份

- 数据目录：$DSH_HOME/memory-core，创建时 0700；打开时也会把已有目录收紧到 0700。
- DB 文件：创建时 0600；打开时也会把已有文件收紧到 0600；同目录 -wal/-shm 在首次连接前收紧为 0600。
- 备份文件 0600；临时文件同目录、同权限；成功后 rename。POSIX 模式在 Windows 上可能不可用，此时只有 best-effort。
- 备份含敏感正文；备份目录访问控制与磁盘加密由用户负责。
- purgeMemory 不会清理历史备份；文档明示，提供备份保留 3 份与手动清理说明。
- 不把 DB 放项目目录/同步盘；WAL 在网络盘上不可靠。

## 6. 数据生命周期

- 软删除：status=deleted、deleted_at；默认查询/搜索排除；保留 audit。
- 永久删除 purgeMemory：独立特权操作，要求 expectedVersion + confirmationToken=PURGE:<namespace>:<id>；级联 versions/memory_sources/memory_feedback；清理 autoCreated 孤儿 sources；共享 sources 保留。
- 版本历史 append-only；UPDATE 触发器拒绝。DELETE 由应用层只在父行 purge/级联时执行；直接 SQLite 访问拥有文件权限，可绕过 API，属于数据库信任边界而不是 API 保证。
- 反馈 append-only；UPDATE 触发器拒绝；purge 随父行级联。直接 SQLite 访问同样可绕过 API。
- 过期：expires_at 计算；不自动物理删除。
- 不因久未使用自动永久删除；检索隐藏、可恢复归档、purge 是不同操作（见 CAPACITY_AND_EVOLUTION.md）。
- 未来：保留策略、加密备份、安全擦除、恢复 API 需单独设计。

## 7. 并发与完整性

- WAL + busy_timeout + BEGIN IMMEDIATE + 有限重试。
- version 乐观锁防止覆盖；冲突不自动合并。
- 迁移 fail-closed；备份失败不迁移；integrity_check 失败拒绝写。
- 健康检查：integrity_check、foreign_key_check、FTS integrity-check。
- 启动不自动 DROP/重建；不把损坏库静默替换为空库。

## 8. 隐私默认值

- 不联网；不调用 LLM/embedding；不写遥测。
- 不存原始对话全文，除非调用方显式写入；推荐只存摘要 + source externalRef。
- 导入对话视为不可信数据；先校验/截断再写入。
- 不记录用户身份；actor 字段由调用方决定，可为空。
- 未来多租户：namespace + 外层认证/授权 + 审计；不得仅靠 namespace。

## 9. 安全测试清单

1. SQL 注入字符串进入 content/title/tags/namespace/metadata，库结构完好。
2. FTS MATCH 注入字符串不改变查询语义、不报语法错（或安全回退）。
3. 超长/超大/未知字段被拒绝。
4. 跨 namespace 读取/更新/删除/来源关联被拒绝。
5. 错误 details/日志不含正文。
6. purgeMemory 无 confirmationToken 被拒绝；级联清理正确；共享 source 保留。
7. 备份权限 0600；已有目录/DB/WAL/SHM 打开后被收紧；备份 integrity_check；恢复流程可读。
8. 迁移失败回滚；外来库/未来版本拒绝。
9. 并发 version 冲突；busy 重试。
10. 关闭后调用返回 CLOSED，无连接泄漏。

## 10. DSH 集成与运行配置

- 默认数据库：`$DSH_HOME/memory-core/memory.sqlite3`；目录 0700、文件 0600。
- 插件配置可覆盖 `path`、journalMode、busyTimeoutMs、synchronous、backupBeforeMigrate、backupDir；配置本身由 DSH profile 管理，不写入数据库。
- 打开/迁移失败会让插件激活失败；不会回退到内存库或静默重建。
- 真实 `~/.dsh` profile 不得作为测试目录；Sprint 4 挂载测试使用临时 `DSH_HOME`，验证后删除。
- 同一宿主进程只应挂载一个 `memoryCore`；多实例会竞争同一 SQLite 文件。

### 备份恢复操作

1. 停止 DSH 或先关闭 Service，确保没有活跃写事务。
2. 保留当前数据库文件；把已验证的备份放到配置的数据库路径。
3. 确认同目录没有遗留 `-wal`/`-shm`，再启动。
4. 启动后调用 `healthCheck()`，确认 integrity、foreign keys、FTS integrity 均为 ok。
5. 如恢复失败，回退到保留的当前文件；不要把损坏库静默替换为空库。

## 11. v0.1 明确不做 / 残余风险

- 无认证/授权：`namespaceId` 只是隔离，不是安全边界；同进程插件默认互信。
- 无加密、无密钥管理、无安全擦除；文件权限与磁盘加密由宿主负责。
- `purgeMemory` 不清理历史备份、WAL、文件系统快照或云同步版本历史。
- 备份默认保留 3 份（迁移前备份），不自动上传/异地保存；备份含敏感正文。
- 运行时依赖 zod 已从 4.4.3 升级到 4.6.6，修复 GHSA-mrhx-c7xc-m3w5（过大约束集合导致内存耗尽）；审计时 `npm audit --omit=dev` 为 0 漏洞，但没有持续在线漏洞扫描。
- `node:sqlite` 仍为 Experimental；升级 Node 必须重跑测试与挂载验证。
- 仅验证 macOS arm64；Windows 未验证；WAL 不适合网络盘。
- 无 HTTP/工具层；若未来暴露，必须另做认证/授权/审计，不能直接复用 namespace。
