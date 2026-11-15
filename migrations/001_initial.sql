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
