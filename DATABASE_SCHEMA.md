# DSH Memory Core v0.1 — 数据库 Schema 与迁移设计

- 状态：Sprint 1 已实现并验证（migrations/001_initial.sql 与本文 DDL 完全一致）；Sprint 2/3/4 未新增迁移：CRUD、搜索、反馈与 Cordis Service 均复用 001 的 memory_fts、memory_feedback、memory_versions 表
- 数据库：SQLite 3.53.4（node:sqlite）
- 默认路径：$DSH_HOME/memory-core/memory.sqlite3
- 字符集：UTF-8；时间：INTEGER epoch milliseconds（UTC）
- 身份：namespace-scoped，业务键 (namespace_id, id)
- 表数：6 张业务表 + 1 张迁移审计表
- 应用 ID：0x44534D43（DSMC）
- 关联决策：ADR 0008（身份）、ADR 0009（状态/删除）

## 1. 设计约定

1. namespace 隔离：所有业务表都有 namespace_id；所有查询必须带 namespace_id。
2. 身份：一条记忆/来源的身份是 (namespace_id, id)；不同 namespace 可有相同 id；同一 namespace 内唯一。
3. FTS 行号：memory_items 使用显式 fts_rowid INTEGER PRIMARY KEY AUTOINCREMENT；FTS external content 使用它，避免 VACUUM 改变隐式 rowid 后索引错位。
4. 软删除优先：status='deleted' + deleted_at；默认查询排除；永久删除是独立 purgeMemory，不是 deleteMemory 的 mode。
5. 乐观并发：memory_items.version 递增；update/delete/feedback/purge 接受 expectedVersion。
6. 版本历史：每次创建/更新/软删除/反馈导致的内容或状态变化都写 memory_versions 快照；无变化反馈只追加事件。
7. 来源可追溯：sources 保存来源元数据；memory_sources 多对多关联；复合外键阻止跨 namespace。
8. 反馈不可变：memory_feedback 只追加；request_id 幂等；request_hash 区分同 key 不同 payload；UPDATE 由触发器拒绝；purge 通过级联清理。
9. FTS 同步：memory_fts 为 external content 表，由触发器维护；正文与索引同事务。
10. 严格表：STRICT + CHECK；所有值参数化绑定。
11. 文件权限：目录 0700、文件 0600、备份 0600。
12. 不做降级：DB user_version 高于代码支持版本时拒绝打开，不自动重建。

## 2. 实体关系

~~~text
memory_items 1 ─── n memory_versions        (namespace_id, memory_id)
memory_items n ─── n sources                (through memory_sources)
memory_items 1 ─── n memory_feedback        (namespace_id, memory_id)
memory_items 1 ─── 1 memory_fts             (fts_rowid)
namespace_id 出现在所有业务表；复合外键保证关联双方同 namespace。
~~~

## 3. DDL（001_initial.sql）

~~~sql
-- 001_initial.sql
-- DSH Memory Core v0.1 initial schema.
-- The migration runner owns schema_migrations and PRAGMA user_version.

PRAGMA application_id = 0x44534D43;

CREATE TABLE memory_items (
  fts_rowid        INTEGER PRIMARY KEY AUTOINCREMENT,
  id               TEXT NOT NULL,
  namespace_id     TEXT NOT NULL CHECK (length(namespace_id) BETWEEN 1 AND 64),
  memory_type      TEXT NOT NULL CHECK (memory_type IN ('working','semantic','episodic','procedural')),
  status           TEXT NOT NULL CHECK (status IN ('candidate','active','flagged','rejected','deleted')),
  extraction_origin TEXT NOT NULL CHECK (extraction_origin IN ('direct','inferred','imported')),
  title            TEXT NOT NULL DEFAULT '' CHECK (length(title) <= 1000),
  content          TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 1000000),
  tags_text        TEXT NOT NULL DEFAULT '' CHECK (length(tags_text) <= 65536),
  confidence       REAL CHECK (confidence IS NULL OR (confidence >= 0.0 AND confidence <= 1.0)),
  metadata_json    TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json) AND length(metadata_json) <= 65536),
  version          INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  expires_at       INTEGER,
  confirmed_at     INTEGER,
  deleted_at       INTEGER,
  UNIQUE (namespace_id, id),
  CHECK (updated_at >= created_at),
  CHECK (expires_at IS NULL OR expires_at > created_at),
  CHECK (memory_type <> 'working' OR expires_at IS NOT NULL),
  CHECK (confirmed_at IS NULL OR confirmed_at >= created_at),
  CHECK ((status = 'deleted') = (deleted_at IS NOT NULL))
) STRICT;

CREATE INDEX memory_items_ns_status_updated_idx
  ON memory_items (namespace_id, status, updated_at DESC, id);

CREATE INDEX memory_items_ns_type_status_idx
  ON memory_items (namespace_id, memory_type, status);

CREATE INDEX memory_items_ns_created_idx
  ON memory_items (namespace_id, created_at DESC);

CREATE INDEX memory_items_expiry_idx
  ON memory_items (namespace_id, expires_at)
  WHERE expires_at IS NOT NULL;

CREATE TABLE memory_versions (
  namespace_id  TEXT NOT NULL CHECK (length(namespace_id) BETWEEN 1 AND 64),
  memory_id     TEXT NOT NULL,
  version       INTEGER NOT NULL CHECK (version >= 1),
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json) AND length(snapshot_json) <= 1048576),
  content_hash  TEXT NOT NULL CHECK (length(content_hash) = 64),
  change_type   TEXT NOT NULL CHECK (change_type IN ('create','update','delete','confirm','correct','reject','flag')),
  change_reason TEXT CHECK (change_reason IS NULL OR length(change_reason) <= 2000),
  changed_by    TEXT CHECK (changed_by IS NULL OR length(changed_by) <= 128),
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (namespace_id, memory_id, version),
  FOREIGN KEY (namespace_id, memory_id)
    REFERENCES memory_items (namespace_id, id) ON DELETE CASCADE
) STRICT;

CREATE INDEX memory_versions_ns_created_idx
  ON memory_versions (namespace_id, created_at DESC);

CREATE TABLE sources (
  id            TEXT NOT NULL,
  namespace_id  TEXT NOT NULL CHECK (length(namespace_id) BETWEEN 1 AND 64),
  source_type   TEXT NOT NULL CHECK (source_type IN ('session','file','url','manual','plugin','import','other')),
  external_ref  TEXT CHECK (external_ref IS NULL OR length(external_ref) BETWEEN 1 AND 2048),
  title         TEXT NOT NULL DEFAULT '' CHECK (length(title) <= 1000),
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json) AND length(metadata_json) <= 65536),
  auto_created  INTEGER NOT NULL DEFAULT 0 CHECK (auto_created IN (0, 1)),
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (namespace_id, id)
) STRICT;

CREATE UNIQUE INDEX sources_external_ref_uq
  ON sources (namespace_id, source_type, external_ref)
  WHERE external_ref IS NOT NULL;

CREATE INDEX sources_ns_created_idx
  ON sources (namespace_id, created_at DESC);

CREATE TABLE memory_sources (
  namespace_id TEXT NOT NULL CHECK (length(namespace_id) BETWEEN 1 AND 64),
  memory_id    TEXT NOT NULL,
  source_id    TEXT NOT NULL,
  relation     TEXT NOT NULL DEFAULT 'origin' CHECK (relation IN ('origin','corroborates','contradicts')),
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (namespace_id, memory_id, source_id),
  FOREIGN KEY (namespace_id, memory_id)
    REFERENCES memory_items (namespace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (namespace_id, source_id)
    REFERENCES sources (namespace_id, id) ON DELETE CASCADE
) STRICT;

CREATE INDEX memory_sources_source_idx
  ON memory_sources (namespace_id, source_id);

CREATE TABLE memory_feedback (
  id               TEXT NOT NULL,
  namespace_id     TEXT NOT NULL CHECK (length(namespace_id) BETWEEN 1 AND 64),
  memory_id        TEXT NOT NULL,
  action           TEXT NOT NULL CHECK (action IN ('confirm','correct','reject','flag')),
  request_id       TEXT NOT NULL CHECK (length(request_id) BETWEEN 1 AND 128),
  request_hash     TEXT NOT NULL CHECK (length(request_hash) = 64),
  expected_version INTEGER CHECK (expected_version IS NULL OR expected_version >= 1),
  applied_version  INTEGER NOT NULL CHECK (applied_version >= 1),
  comment          TEXT CHECK (comment IS NULL OR length(comment) <= 10000),
  patch_json       TEXT CHECK (patch_json IS NULL OR (json_valid(patch_json) AND length(patch_json) <= 65536)),
  metadata_json    TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json) AND length(metadata_json) <= 65536),
  actor            TEXT CHECK (actor IS NULL OR length(actor) <= 128),
  created_at       INTEGER NOT NULL,
  PRIMARY KEY (namespace_id, id),
  UNIQUE (namespace_id, request_id),
  CHECK ((action = 'correct') = (patch_json IS NOT NULL)),
  FOREIGN KEY (namespace_id, memory_id)
    REFERENCES memory_items (namespace_id, id) ON DELETE CASCADE
) STRICT;

CREATE INDEX memory_feedback_memory_idx
  ON memory_feedback (namespace_id, memory_id, created_at DESC, id);

-- FTS5 external content. fts_rowid is the stable external-content rowid.
CREATE VIRTUAL TABLE memory_fts USING fts5(
  title,
  content,
  tags_text,
  content='memory_items',
  content_rowid='fts_rowid',
  tokenize='trigram'
);

CREATE TRIGGER memory_items_fts_ai
AFTER INSERT ON memory_items
BEGIN
  INSERT INTO memory_fts (rowid, title, content, tags_text)
  VALUES (new.fts_rowid, new.title, new.content, new.tags_text);
END;

CREATE TRIGGER memory_items_fts_ad
AFTER DELETE ON memory_items
BEGIN
  INSERT INTO memory_fts (memory_fts, rowid, title, content, tags_text)
  VALUES ('delete', old.fts_rowid, old.title, old.content, old.tags_text);
END;

CREATE TRIGGER memory_items_fts_au
AFTER UPDATE OF title, content, tags_text ON memory_items
BEGIN
  INSERT INTO memory_fts (memory_fts, rowid, title, content, tags_text)
  VALUES ('delete', old.fts_rowid, old.title, old.content, old.tags_text);
  INSERT INTO memory_fts (rowid, title, content, tags_text)
  VALUES (new.fts_rowid, new.title, new.content, new.tags_text);
END;

-- Append-only history. UPDATE is refused; DELETE is allowed only through
-- the parent's ON DELETE CASCADE for an authorized purge.
CREATE TRIGGER memory_versions_no_update
BEFORE UPDATE ON memory_versions
BEGIN
  SELECT RAISE(ABORT, 'memory_versions is append-only');
END;

CREATE TRIGGER memory_feedback_no_update
BEFORE UPDATE ON memory_feedback
BEGIN
  SELECT RAISE(ABORT, 'memory_feedback is append-only');
END;
~~~

## 4. 迁移审计表

迁移 runner 在应用任何 SQL 前创建：

~~~sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  checksum   TEXT NOT NULL,
  applied_at INTEGER NOT NULL
) STRICT;
~~~

规则：

1. 迁移文件命名 NNN_description.sql，按 NNN 数字升序。
2. 每个迁移计算 SHA-256 checksum；已应用迁移 checksum 不一致 -> 拒绝启动。
3. 每个迁移一个事务：BEGIN IMMEDIATE -> SQL -> 写 schema_migrations -> PRAGMA user_version -> COMMIT。
4. 失败 ROLLBACK；DB 保持上一个版本；不自动删除/重建。
5. DB user_version > 代码支持最大版本 -> 拒绝（不支持降级）。
6. 应用 ID 不是 0 或 DSMC -> 拒绝；应用 ID 0 但已有用户表 -> 拒绝（防止误开别人的库）。
7. 迁移前对已有非空 DB 做在线备份；备份失败则不迁移。
8. FTS 迁移后执行 rebuild（如需），并在健康检查中校验。
9. 迁移并发：宿主必须指定唯一迁移 owner；其他进程只校验版本，不并发迁移。SQLite BEGIN IMMEDIATE 不能单独作为跨进程迁移协调器。

## 5. 身份、状态与版本

### 5.1 身份

- 记忆身份 = (namespace_id, id)；来源身份 = (namespace_id, id)。
- memory_items 的 fts_rowid 只是内部 FTS 行号，不是业务 ID，不对外暴露。
- 不同 namespace 可以复用同一个 id；跨 namespace 的读取/更新/删除/来源关联返回 NOT_FOUND 或由复合外键拒绝。
- 外部系统 ID 放 sources.external_ref；不要用它替代 memory id。
- 未来若需要全局句柄/跨 namespace 关系，迁移增加 global_uid（nullable、unique），不改变现有复合键。

### 5.2 memory_items.status

- candidate：候选记忆；默认不进入检索/列表。
- active：已确认/可直接使用；默认检索/列表范围。
- flagged：被标记待复核；默认不进入检索/列表。
- rejected：用户拒绝；默认检索/列表排除。
- deleted：软删除；默认全部排除；仅管理接口可看。
- 状态只由 createMemory 初始选择、submitFeedback、deleteMemory/purgeMemory 改变；updateMemory 不修改 status。

### 5.3 版本规则

- create：version=1，写 memory_versions(change_type=create)。
- update：expectedVersion 必须等于当前 version；UPDATE ... WHERE version=expectedVersion；成功后 version+1；写快照。
- feedback：
  - confirm/correct/reject/flag 总是追加 memory_feedback。
  - 只有当内容或状态/confirmedAt 实际变化时才 version+1 并写 memory_versions；无变化 confirm 只追加反馈，applied_version=当前版本。
- delete（soft）：version+1，写快照，change_type=delete。
- purge：物理删除，级联历史；不写版本。
- 冲突：VERSION_CONFLICT，details 含 expectedVersion/actualVersion，不含正文。
- snapshot_json 内容：id/namespace/type/status/origin/title/content/tags/confidence/metadata/version/时间/expires/confirmed/deleted；content_hash 为规范化 snapshot 的 SHA-256。

### 5.4 反馈幂等

- 唯一键 (namespace_id, request_id)。
- request_hash = SHA-256(canonical JSON of {action, expectedVersion, comment, patch, metadata})。
- 重复 request_id：
  - hash 相同 -> 返回已有 feedback + 当前 memory，duplicate=true；不再检查版本/状态。
  - hash 不同 -> IDEMPOTENCY_CONFLICT。
- feedback UPDATE 被触发器拒绝；purge 是唯一物理删除路径（级联）。

### 5.5 过期

- expires_at 为 NULL 表示不过期；working 类型必须有 expires_at。
- 过期是计算状态，不写入 status；Memory DTO 返回 isExpired。
- 默认 list/search 排除 expires_at <= now；includeExpired 可管理查看（list）。
- 过期不自动删除；未来可加 maintenance job。

## 6. 索引与检索

- 普通查询用 namespace_id + status + updated_at/created_at 索引。
- 来源查询用 memory_sources(namespace_id, source_id) 与 sources(namespace_id, source_type, external_ref)。
- 反馈查询用 (namespace_id, memory_id, created_at DESC)。
- FTS 用 trigram；BM25 权重在查询时指定：title 5.0、content 1.0、tags_text 2.0。
- 查询长度 < 3 个 Unicode 字符时走 LIKE 回退；LIKE 必须转义 %、_、\。
- FTS 查询必须把用户输入作为带引号的 phrase 绑定，绝不能拼接进 SQL 文本。
- FTS 索引只含 title/content/tags_text；status/namespace/type 过滤在 JOIN memory_items 后做。
- memory_items 的 fts_rowid 稳定；不要用隐式 rowid 作为 external-content rowid。
- 迁移/恢复后执行 FTS rebuild 与 integrity-check。

## 7. 备份与恢复

### 7.1 在线备份

- 使用 node:sqlite 的 backup(db, dest)；失败回退 VACUUM INTO。
- 先写临时文件，成功后 rename；备份文件 0600。
- 备份后打开副本执行 PRAGMA integrity_check，失败则标记备份失败。
- 迁移前备份命名：memory.sqlite3.bak-YYYYMMDDTHHMMSSmmmZ。
- 默认保留最近 3 份；清理旧备份只删匹配前缀的文件。
- 备份包含 FTS 与版本快照；大小约等于主库。

### 7.2 恢复

1. 停止 DSH 宿主进程（避免 WAL 写入）。
2. 将备份复制为 memory.sqlite3。
3. 删除同目录 memory.sqlite3-wal / memory.sqlite3-shm。
4. 打开并执行 integrity_check / foreign_key_check。
5. 启动宿主；Service 会检查 user_version 与迁移。
6. 如果版本低于代码，按迁移流程升级；高于则拒绝。

### 7.3 限制

- purgeMemory 不会清理历史备份；备份可能仍含已删除内容。
- 备份不加密；依赖文件系统权限与磁盘加密。
- 备份恢复是运维操作，不通过公共 API 自动覆盖现有库。

## 8. 并发与事务

- 每个 Service 一个连接；PRAGMA foreign_keys=ON、busy_timeout=5000、journal_mode=WAL、synchronous=NORMAL。
- 写事务 BEGIN IMMEDIATE；读不加长事务。
- BUSY/LOCKED 重试 3 次，退避 25/50/100ms；仍失败返回 STORAGE_BUSY。
- 嵌套 transaction 直接抛错，避免隐式 savepoint 复杂度。
- close 在活跃事务中抛错（同步驱动无法等待）；调用方先完成事务再关闭；关闭后所有调用返回 CLOSED。
- 多进程同时写同一 DB：WAL + busy_timeout + version 乐观锁；不保证跨进程事件通知。
- 迁移只允许一个 owner；其他进程校验版本后使用。

## 9. 数据保留与删除

- 软删除保留正文、版本、来源、反馈；用于审计与误删恢复（恢复 API 为 v0.2）。
- purgeMemory 级联删除 versions、memory_sources、memory_feedback；清理 auto_created 且无其他引用的 sources；保留共享 sources。
- 来源被多个记忆共享时，purge 一个记忆不删除 source。
- 反馈在 purge 时随父行级联删除；正常生命周期内 append-only。
- 备份保留策略与 purge 的冲突必须在 UI/文档中明示。
- 不因记忆久未使用而自动永久删除；归档/降权/永久删除是不同操作（见 CAPACITY_AND_EVOLUTION.md）。

## 10. 迁移与 Schema 测试清单

1. 空库初始化：表、索引、触发器、application_id、user_version 正确。
2. 重复打开：幂等，不重复建表。
3. 迁移从 0 到 1；模拟 1 到 2；失败回滚；checksum 不一致拒绝。
4. 外部应用 DB 拒绝；已有表但 app_id=0 拒绝；未来版本拒绝。
5. 身份：同一 id 在两个 namespace 可共存；同一 namespace 重复 id 拒绝；跨 namespace 关联被复合外键拒绝。
6. FTS：插入/更新/删除同步；VACUUM 后 fts_rowid 稳定；integrity-check；rebuild。
7. 备份：在线备份可读；integrity_check ok；恢复副本可查询。
8. 并发：两个连接写同一行，version 冲突；busy 重试。
9. purge：级联清理、孤儿 source 清理、共享 source 保留；token 校验。
10. 过期与 status 过滤：默认检索/列表排除 deleted/rejected/expired；candidate/flagged 需显式。