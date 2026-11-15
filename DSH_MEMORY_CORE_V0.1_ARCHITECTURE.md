# DSH Memory Core v0.1 — Architecture and Execution Specification

**Status:** Historical draft — superseded as source of truth (2026-11-14)  
**Date:** 2026-11-14  
**Scope:** Independent, shared, local-first memory module for DSH plugins  
**Explicit exclusions:** vector search, embeddings, automatic LLM extraction, distributed sync, and a mandatory network service

> **历史草案，不作为实施依据。** 本文写于实际 DSH 调查之前，包含与已验证事实冲突的假设（仓库为空、语言待定、进程模型未知）。当前唯一事实源是：ARCHITECTURE.md、DATABASE_SCHEMA.md、API_REFERENCE.md、IMPLEMENTATION_PLAN.md、docs/PHASE0_INVESTIGATION.md、docs/adr/0008-identity-scope.md。
>
> 已保留并采纳的有价值部分：namespace-scoped identity、显式 fts_rowid、request_hash、working TTL、软删除与 purge 分离。其余内容仅作历史参考，冲突时以当前文档为准。

## 1. Repository discovery and decision gate

At inspection time, the initial workspace contained no implementation repository or project files. It was not a Git repository and had no source files, manifests, lockfiles, test configuration, plugin interfaces, or runtime metadata. This specification is the only file subsequently added. Therefore:

- No existing implementation language, package manager, database driver, or test framework can be truthfully selected yet.
- This document defines language-neutral boundaries and an executable discovery gate.
- **ADR-001 remains `Proposed / Deferred`.** The implementation language must match the actual DSH repository once it is provided.
- No production implementation may begin until the real repository is inspected and the Phase 0 findings are approved.

Language selection rule after the real repository is available:

1. Use the dominant language already used by DSH plugin/runtime code.
2. Reuse the existing package manager, test runner, linting, error conventions, and SQLite binding when fit for purpose.
3. Prefer a native in-process library when plugins share a runtime and dependency graph.
4. If plugins are isolated by process or language, retain the same domain/API contracts behind a narrow local IPC adapter; do not introduce HTTP by default.
5. A new language is allowed only if the host cannot satisfy FTS5, transaction, packaging, or lifecycle requirements, and requires explicit approval.

## 2. Goals, non-goals, and invariants

### Goals

- Persist typed memories locally across process restarts.
- Provide CRUD, source provenance, keyword search, and user feedback through one stable public API.
- Be reusable by Weekly Retro, Prompt Optimizer, and future plugins without consumer-specific imports.
- Preserve history for content/status changes and make corrections auditable.
- Work without network access, an LLM, embeddings, or a vector database.

### Non-goals for v0.1

- Deciding what an LLM should remember or automatically consolidating memories.
- Semantic similarity search.
- Cross-device or multi-host synchronization.
- Multi-tenant authorization. `namespaceId` is an isolation key, not proof of identity.
- High write concurrency or a remote database deployment.

### Required invariants

1. Every read and write is scoped by `namespaceId`.
2. Consumers never execute SQL or access the database file directly.
3. Content mutation, version history, feedback, source links, and FTS synchronization are transactionally consistent.
4. Updates use optimistic concurrency through `expectedVersion`.
5. Default list/search returns only active, unexpired records. Direct ID lookup may inspect any non-deleted state; deleted records require an explicit privileged option.
6. Feedback events are append-only and idempotent by `(namespaceId, requestId)`.
7. Memory text is not logged by default and never leaves the local machine in Core.

## 3. Architecture

```text
DSH plugins
  Weekly Retro | Prompt Optimizer | future consumers
                         |
                  Public Memory API
        validation | namespace | errors | DTOs
                         |
    +--------------------+--------------------+
    | Memory | Search | Provenance | Feedback |
    +--------------------+--------------------+
                         |
              Unit of Work / Repositories
                         |
       SQLite connection | migrations | FTS5
                         |
               local database file
```

The domain and service layers may depend on repository interfaces. SQLite adapters implement those interfaces. Consumer plugins depend only on the public package entry point. The Core must never import consumer plugin code.

### Deployment

- **Default:** one in-process shared package and one database per DSH user/profile.
- **Connection policy:** one writer transaction at a time; short transactions; WAL where supported; a configurable busy timeout; foreign keys enabled on every connection.
- **Process isolation fallback:** one local owner process with a versioned IPC adapter. This is activated only if Phase 0 proves that plugins cannot safely share the SQLite file through the same runtime.
- **Data location:** supplied by the host through configuration. Core must not silently write into the source tree or current working directory.

## 4. Suggested directory structure

The final manifest and file extensions are intentionally deferred until language selection.

```text
dsh-memory-core/
├── src/
│   ├── index                 # only public exports
│   ├── api/                  # contracts, DTOs, validation, errors
│   ├── domain/               # Memory, Source, Feedback, policies
│   ├── services/             # CRUD, search, provenance, feedback
│   ├── repositories/         # repository interfaces
│   └── infrastructure/
│       └── sqlite/
│           ├── connection
│           ├── transaction
│           ├── migrations/
│           ├── repositories/
│           └── fts
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── contract/
│   └── benchmark/
├── examples/
│   ├── weekly-retro/
│   └── prompt-optimizer/
├── docs/
│   ├── architecture.md
│   ├── api-contract.md
│   ├── schema.md
│   ├── operations.md
│   └── adr/
└── README.md
```

Dependency direction: `examples -> public API -> services/domain -> repository interfaces <- SQLite adapters`.

## 5. SQLite and FTS5 schema

All timestamps are UTC ISO-8601 strings with millisecond precision (`YYYY-MM-DDTHH:mm:ss.sssZ`) generated by the application. UUIDs are lowercase canonical strings. Booleans are stored as `0/1`.

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;

CREATE TABLE schema_migrations (
  version       INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  checksum      TEXT NOT NULL,
  applied_at    TEXT NOT NULL
) STRICT;

CREATE TABLE memory_items (
  fts_rowid       INTEGER PRIMARY KEY AUTOINCREMENT,
  id              TEXT NOT NULL,
  namespace_id    TEXT NOT NULL,
  content         TEXT NOT NULL CHECK (length(trim(content)) BETWEEN 1 AND 100000),
  search_content  TEXT NOT NULL,
  memory_type     TEXT NOT NULL CHECK (memory_type IN
                    ('working','semantic','episodic','procedural')),
  status          TEXT NOT NULL CHECK (status IN
                    ('candidate','active','flagged','rejected','deleted')),
  origin          TEXT NOT NULL CHECK (origin IN ('direct','inferred','imported')),
  confidence      REAL CHECK (confidence IS NULL OR confidence BETWEEN 0.0 AND 1.0),
  user_confirmed  INTEGER NOT NULL DEFAULT 0 CHECK (user_confirmed IN (0,1)),
  version         INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  expires_at      TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  deleted_at      TEXT,
  metadata_json   TEXT,
  CHECK (memory_type <> 'working' OR expires_at IS NOT NULL),
  CHECK ((status = 'deleted') = (deleted_at IS NOT NULL)),
  UNIQUE (namespace_id, id)
) STRICT;

CREATE INDEX idx_memory_scope_status_updated
  ON memory_items(namespace_id, status, updated_at DESC, id);
CREATE INDEX idx_memory_scope_type_updated
  ON memory_items(namespace_id, memory_type, updated_at DESC, id);
CREATE INDEX idx_memory_expiry
  ON memory_items(namespace_id, expires_at) WHERE expires_at IS NOT NULL;

CREATE TABLE memory_versions (
  memory_id       TEXT NOT NULL,
  namespace_id    TEXT NOT NULL,
  version         INTEGER NOT NULL,
  content         TEXT NOT NULL,
  memory_type     TEXT NOT NULL,
  status          TEXT NOT NULL,
  origin          TEXT NOT NULL,
  confidence      REAL,
  user_confirmed  INTEGER NOT NULL,
  expires_at      TEXT,
  updated_at      TEXT NOT NULL,
  deleted_at      TEXT,
  metadata_json   TEXT,
  changed_at      TEXT NOT NULL,
  change_kind     TEXT NOT NULL CHECK (change_kind IN
                    ('create','update','delete','feedback_correct','feedback_status')),
  feedback_id     TEXT,
  PRIMARY KEY (namespace_id, memory_id, version),
  FOREIGN KEY (namespace_id, memory_id)
    REFERENCES memory_items(namespace_id, id) ON DELETE CASCADE
) STRICT;

CREATE TABLE sources (
  id              TEXT NOT NULL,
  namespace_id    TEXT NOT NULL,
  source_type     TEXT NOT NULL CHECK (source_type IN
                    ('conversation','message','task','file','url','plugin','manual','other')),
  external_ref    TEXT,
  dedupe_key      TEXT NOT NULL,
  title           TEXT,
  occurred_at     TEXT,
  metadata_json   TEXT,
  created_at      TEXT NOT NULL,
  PRIMARY KEY (namespace_id, id),
  UNIQUE (namespace_id, dedupe_key)
) STRICT;

CREATE TABLE memory_sources (
  namespace_id    TEXT NOT NULL,
  memory_id       TEXT NOT NULL,
  source_id       TEXT NOT NULL,
  relation        TEXT NOT NULL CHECK (relation IN
                    ('supports','derived_from','contradicts','mentioned_in')),
  excerpt         TEXT,
  locator_json    TEXT,
  created_at      TEXT NOT NULL,
  PRIMARY KEY (namespace_id, memory_id, source_id, relation),
  FOREIGN KEY (namespace_id, memory_id)
    REFERENCES memory_items(namespace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (namespace_id, source_id)
    REFERENCES sources(namespace_id, id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE memory_feedback (
  id                  TEXT NOT NULL,
  namespace_id        TEXT NOT NULL,
  memory_id           TEXT NOT NULL,
  request_id          TEXT NOT NULL,
  action              TEXT NOT NULL CHECK (action IN ('confirm','correct','reject','flag')),
  expected_version    INTEGER,
  resulting_version   INTEGER NOT NULL,
  request_hash        TEXT NOT NULL,
  correction_content  TEXT,
  note                TEXT,
  created_at          TEXT NOT NULL,
  PRIMARY KEY (namespace_id, id),
  UNIQUE (namespace_id, request_id),
  CHECK ((action = 'correct') = (correction_content IS NOT NULL)),
  FOREIGN KEY (namespace_id, memory_id)
    REFERENCES memory_items(namespace_id, id) ON DELETE CASCADE
) STRICT;

CREATE INDEX idx_feedback_memory_time
  ON memory_feedback(namespace_id, memory_id, created_at, id);

CREATE VIRTUAL TABLE memory_fts USING fts5(
  search_content,
  content='memory_items',
  content_rowid='fts_rowid',
  tokenize='trigram'
);

CREATE TRIGGER memory_fts_ai AFTER INSERT ON memory_items BEGIN
  INSERT INTO memory_fts(rowid, search_content) VALUES (new.fts_rowid, new.search_content);
END;

CREATE TRIGGER memory_fts_ad AFTER DELETE ON memory_items BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, search_content)
  VALUES ('delete', old.fts_rowid, old.search_content);
END;

CREATE TRIGGER memory_fts_au AFTER UPDATE OF search_content ON memory_items BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, search_content)
  VALUES ('delete', old.fts_rowid, old.search_content);
  INSERT INTO memory_fts(rowid, search_content) VALUES (new.fts_rowid, new.search_content);
END;
```

### Search behavior

- Phase 0 must verify `ENABLE_FTS5`, `STRICT` table support, and the `trigram` tokenizer in the exact SQLite runtime.
- The application stores `search_content = NFKC(Unicode casefold(content))` using a pinned Unicode implementation. Queries receive the same normalization. Validation rejects content that is empty after Unicode-whitespace normalization; SQLite `trim()` is only defense in depth.
- Normalized query terms are quoted as literals and joined with `AND`; v0.1 does not expose raw FTS, phrase, prefix, or boolean syntax.
- Search joins `memory_fts.rowid = memory_items.fts_rowid`, scopes by namespace, filters state/type/origin/time, and orders by `bm25(memory_fts) ASC, id ASC`.
- If any normalized whitespace-delimited term is shorter than three Unicode code points, the whole query uses parameterized `instr(search_content, term) > 0` predicates joined with `AND`. Results order by `updated_at DESC, id ASC` and use that tuple as the cursor. Query length is capped at 256 code points and result limit at 50. Above a configurable scan threshold (default 20,000 active namespace rows), such a query requires a type or time filter or returns `VALIDATION_ERROR`; the 10,000-record benchmark measures this O(N) path.
- If the runtime lacks `trigram`, approval is required for either a compatible SQLite build or a documented `unicode61` + substring fallback. FTS5 itself is mandatory.
- `memory_fts` is rebuilt and integrity-checked after migrations that affect indexed content. Trigger consistency is covered by integration tests.

### Migration, backup, and deletion

- Migrations are forward-only, numbered, checksum-verified, and run once by the host-designated database owner before normal API access. Other processes verify schema compatibility and fail fast rather than migrating concurrently. If the host cannot guarantee one startup owner, use the local IPC owner; SQLite `BEGIN EXCLUSIVE` alone is not considered a cross-process migration coordinator under WAL.
- Startup verifies the returned journal mode instead of assuming the `WAL` request succeeded, and reports the verified fallback mode when WAL is unavailable.
- Each release supports backup through SQLite's online backup API or `VACUUM INTO`, never by copying a live WAL database file alone.
- `deleteMemory` is a soft delete. A separate privileged `purgeMemory` removes the item and cascades its versions, links, and feedback; orphan sources are removed only by an explicit cleanup policy.
- Downgrade is restore-from-backup in v0.1; destructive down-migrations are not promised.

## 6. Public API contract

The notation below is language-neutral. The chosen implementation must publish equivalent typed contracts.

### Shared types

```text
MemoryType   = working | semantic | episodic | procedural
MemoryStatus = candidate | active | flagged | rejected | deleted
Origin       = direct | inferred | imported
FeedbackAction = confirm | correct | reject | flag

Memory {
  id, namespaceId, content, type, status, origin,
  confidence?, userConfirmed, version, expiresAt?,
  createdAt, updatedAt, deletedAt?, metadata?
}

Page<T> { items: T[], nextCursor?: string }
SearchHit { memory: Memory, score?: number }
```

Opaque cursors encode the last deterministic sort tuple plus a query/filter fingerprint and must be validated; offset pagination is not public. Cursors are not snapshot tokens: concurrent writes may move an item between pages. A consistent export requires a separate read-snapshot facility outside normal v0.1 paging.

### Operations

| Operation | Required input | Result and semantics |
|---|---|---|
| `createMemory` | context, caller-supplied memoryId, content, type, origin, optional status/confidence/expiry/metadata/sources | Defaults status to candidate; creates item + version 1 + source links atomically. Same ID plus canonical payload returns the original; a different payload conflicts. |
| `getMemory` | context, memoryId, optional privileged `includeDeleted=false` | Returns any non-deleted state by exact ID (including expired state for inspection), or `Memory | null`; never crosses namespace. |
| `listMemories` | context, typed filters, limit `1..100`, cursor | Defaults to active and unexpired; stable page ordered by `updatedAt DESC, id ASC`. |
| `updateMemory` | context, memoryId, `expectedVersion`, field patch | Patches content/type/origin/confidence/expiry/metadata only; atomically writes the next snapshot and increments version. Empty patches fail validation. |
| `deleteMemory` | context, memoryId, `expectedVersion` | Soft deletes and increments version. It is not generally idempotent: retrying the old version returns `VERSION_CONFLICT`. |
| `searchMemories` | context, literal query, filters, limit `1..50`, cursor | FTS5/BM25 or documented short-query fallback; defaults to active and unexpired. |
| `addSource` | context, memoryId, source, relation, optional excerpt/locator | Inserts by dedupe key and links atomically. Source identity is `(sourceType, externalRef, dedupeKey)`; matching identity returns the existing source, while different identity fields conflict. First creation owns source title/metadata. Link identity is `(memoryId, sourceId, relation)`; an exact replay returns it, while different excerpt/locator for the same link conflicts. Concurrent uniqueness races are re-read and resolved by these same rules. |
| `getSources` | context, memoryId | Returns source + relation records in stable order. |
| `submitFeedback` | context, memoryId, action, requestId, expectedVersion, optional correction/note | Append-only event; any state/content change and its new version occur in the same transaction. A no-op confirm keeps the current version. Repeated requestId returns the original result. |
| `getFeedbackHistory` | context, memoryId, limit, cursor | Stable chronological event page. |
| `purgeMemory` | privileged context, memoryId, explicit confirmation token | Irreversible cascade; excluded from normal plugin capability. |

`context` minimally contains `{ namespaceId, actorId?, requestId?, capabilities? }`. Authentication, capability assignment, and authorization occur at the host boundary; they are not trusted from arbitrary consumer input or inferred from `namespaceId`. Secure data-directory permissions and, if used, IPC peer authentication are Phase 0 host prerequisites.

### Feedback state rules

- `confirm`: sets `userConfirmed=true`; candidate or flagged becomes active, and active remains active.
- `correct`: accepts candidate, active, flagged, or rejected; requires non-empty replacement content, preserves the old snapshot, and sets `status=active`, `origin=direct`, and `userConfirmed=true`.
- `reject`: sets status to rejected and removes it from default retrieval.
- `flag`: accepts candidate or active and sets status to flagged; default list/search excludes it.
- `deleteMemory` is the only normal transition to deleted. General `updateMemory` cannot patch status or `userConfirmed`.
- A deleted memory rejects new feedback. A feedback transaction first looks up `(namespaceId, requestId)`: the same canonical payload hash returns the stored result even if memory state later changed; a different hash returns `IDEMPOTENCY_CONFLICT`. Only a new request checks `expectedVersion` and state. The API requires `expectedVersion`; the nullable storage field permits future imported audit events.
- Every new feedback request appends an event. It creates a memory version only when fields change; an already-satisfied confirm records feedback with the unchanged `resultingVersion`.

| From | Allowed controlled transition |
|---|---|
| candidate | confirm/correct → active; flag → flagged; reject → rejected; delete → deleted |
| active | correct → active; flag → flagged; reject → rejected; delete → deleted |
| flagged | confirm/correct → active; reject → rejected; delete → deleted |
| rejected | correct → active; delete → deleted |
| deleted | terminal; only privileged purge remains |

### Error model

| Code | Meaning |
|---|---|
| `VALIDATION_ERROR` | Malformed input or invalid state transition. |
| `NOT_FOUND` | Item absent in the requested namespace. |
| `VERSION_CONFLICT` | `expectedVersion` does not match. |
| `IDEMPOTENCY_CONFLICT` | Same request ID used with a different payload. |
| `CAPABILITY_UNAVAILABLE` | Required SQLite/FTS capability missing. |
| `STORAGE_BUSY` | Busy timeout exhausted; safe to retry where indicated. |
| `STORAGE_ERROR` | Non-retryable persistence/integrity failure. |
| `FORBIDDEN` | Host capability does not permit purge or cross-boundary action. |

Errors expose a stable code, safe message, optional field violations, retryability, and cause for internal diagnostics. They never include memory text or SQL.

## 7. Architecture Decision Records

### ADR-001 — Implementation language follows the real repository

- **Status:** Proposed / deferred.
- **Decision:** Select the dominant host/plugin language after repository inspection; do not create a new stack from the empty workspace.
- **Consequence:** Domain and API definitions remain language-neutral in Phase 0. Implementation is blocked pending real repository access and approval.

### ADR-002 — Independent shared module

- **Status:** Accepted by product decision.
- **Decision:** Core is a consumer-agnostic package with a single public entry point. Consumer adapters live outside the Core.
- **Consequence:** Reuse and testing improve; package/version compatibility becomes an explicit responsibility.

### ADR-003 — SQLite local persistence

- **Status:** Accepted by product decision.
- **Decision:** Use a host-configured local SQLite file, foreign keys, transactions, WAL when supported, and versioned migrations.
- **Consequence:** Simple local deployment and strong transactions; limited concurrent writers and no built-in remote sync.

### ADR-004 — FTS5 keyword retrieval; no vectors

- **Status:** Accepted by product decision.
- **Decision:** Use FTS5/BM25 with trigram tokenization when available and a bounded short-query substring fallback. No embeddings or vector dependencies in v0.1.
- **Consequence:** Deterministic, offline search with modest footprint; semantic paraphrase recall is explicitly limited.

### ADR-005 — Library first, IPC only when isolation requires it

- **Status:** Proposed.
- **Decision:** Prefer an in-process library. Add a versioned local IPC adapter only if Phase 0 finds incompatible or isolated plugin processes.
- **Consequence:** Avoids premature service operations while preserving a migration path.

### ADR-006 — Immutable feedback events and version snapshots

- **Status:** Proposed.
- **Decision:** Store append-only feedback and a complete snapshot for every version-changing action.
- **Consequence:** Auditable corrections and simple reads at the cost of additional local storage.

## 8. Phased implementation tasks and acceptance gates

### Phase 0 — Repository discovery and architecture approval (P0)

Tasks: inspect manifests and lockfiles; identify language/runtime/plugin lifecycle; verify shared-process assumptions; locate host-approved persistent data directories; inspect storage abstractions and packaging; probe SQLite version/compile options/FTS5/trigram/STRICT; produce dependency and threat analysis; resolve ADR-001 and ADR-005.

Acceptance: facts cite actual repository files; a minimal dependency proposal is documented; database ownership and data path are known; architecture, language, and IPC choice receive approval. **No production code before this gate.**

### Phase 1 — SQLite foundation (P0)

Tasks: connection factory, safe PRAGMAs, migration runner/checksums, transaction helper, schema migration, FTS capability check, temporary-database test harness, backup/restore procedure.

Acceptance: persistence survives restart; migrations are repeatable; foreign keys are enforced; failed multi-table transactions roll back; two simultaneous writers fail/retry predictably; backup restores a valid searchable database.

### Phase 2 — CRUD, classification, and provenance (P0)

Tasks: contracts/errors/validation, repository adapters, CRUD, all four types, status transitions, version history, namespace scoping, source upsert/link/list, soft delete and expiry behavior.

Acceptance: contract and integration tests pass; stale updates conflict; every query is namespace-scoped; sources cannot dangle; inactive/expired items are excluded by default; no content appears in logs.

### Phase 3 — Search and feedback (P1)

Tasks: safe literal query builder, FTS join/BM25/cursors/filters, Chinese and English fixtures, short-query fallback, feedback actions, idempotency replay/conflict behavior, atomic corrections.

Acceptance: index matches rows after create/update/delete/rollback; Chinese and English cases pass; one/two-character queries follow the documented fallback; duplicate feedback is idempotent; corrections retain the old version and update search atomically.

### Phase 4 — Integration and release (P1)

Tasks: consumer examples, 10,000-record benchmark, operations/privacy docs, migration compatibility test, purge capability, release checklist and known limitations.

Acceptance: a consumer uses only public imports; 10,000-record benchmark records hardware, dataset, p50/p95 latency and database size (no invented universal threshold); core service coverage target is at least 85%; fresh install and upgrade paths pass; all P0 security tests pass.

## 9. Cross-cutting test matrix

- Validation: empty/oversized content, invalid enums, invalid timestamps, cursor tampering, FTS metacharacters, SQL injection strings.
- Isolation: identical IDs/request IDs/dedupe keys in different namespaces; attempted cross-namespace reads and links.
- Transactions: injected failure after each write step for create, update, source link, correction, and delete.
- Concurrency: optimistic conflicts, busy timeout, idempotent replay during retry.
- Lifecycle: create, activate, flag, correct, reject, expire, soft-delete, purge.
- FTS: create/update/delete synchronization, rollback, rebuild, integrity check, ranking stability, Chinese/English, 1–2-character fallback.
- Operations: restart, migration checksum mismatch, backup during WAL use, restore, disk-full/readonly simulation where feasible.

## 10. Risks and open decisions

| Risk / unknown | Mitigation or decision gate |
|---|---|
| Real DSH repository and language are unavailable | Keep ADR-001 deferred; request repository/worktree before implementation. |
| Plugin process model is unknown | Resolve in Phase 0; choose library or local IPC accordingly. |
| SQLite build may lack trigram/STRICT | Probe exact runtime before dependency choice; do not silently degrade. |
| SQLite permits only one writer at a time | Short transactions, WAL, timeout, bounded retry, benchmark realistic writes. |
| `namespaceId` may be mistaken for authorization | Host must authorize before calling Core; document and test boundary. |
| Sensitive source excerpts can duplicate raw content | Make excerpts optional, bounded, and covered by purge/privacy policy. |
| FTS does not provide semantic recall | Treat as known v0.1 limitation; do not add vectors implicitly. |

## 11. Approval requested

Approval of this document authorizes only Phase 0 against the actual DSH repository. Phase 1 remains blocked until the Phase 0 report confirms language, runtime, package boundaries, data location, SQLite capabilities, and the library-vs-IPC decision.

## Appendix A — Copyable DSH execution prompt

```text
You are the implementation agent for DSH Memory Core v0.1. Act as a senior software architect, database engineer, and maintainer of local-first agent infrastructure.

MISSION
Design and, only after approval, implement an independent shared Memory Core that multiple DSH plugins can reuse.

CONFIRMED PRODUCT DECISIONS
- Language: inspect the actual repository first and use its dominant compatible language/runtime; do not invent a new stack.
- Deployment: independent shared module, plugin-agnostic.
- Persistence: local SQLite.
- Retrieval: SQLite FTS5 keyword search only.
- Local-first: core behavior requires no network, cloud service, LLM, or external API.
- Do not introduce vector search, embeddings, or a vector database in v0.1.
- Prefer an in-process library; use local IPC only if repository evidence proves plugin process isolation requires it.

MANDATORY PHASE 0 — READ-ONLY DISCOVERY
Before production code changes:
1. Inspect repository structure, manifests, lockfiles, language/runtime versions, tests, linting, packaging, and error conventions.
2. Identify DSH plugin interfaces, lifecycle, process boundaries, and whether plugins can share one package/database owner.
3. Identify host-approved persistent user/profile data directories and sandbox/permission rules.
4. Find existing storage abstractions and SQLite dependencies that can be reused.
5. Probe the exact SQLite runtime for version, ENABLE_FTS5, trigram tokenizer, STRICT tables, foreign keys, WAL, and backup API support.
6. Review security/privacy boundaries, logging behavior, migration compatibility, and release constraints.
7. Cite concrete repository files for every factual conclusion.

PHASE 0 DELIVERABLES
- Repository architecture summary.
- Recommended language, runtime, package manager, SQLite binding, and test framework with evidence and trade-offs.
- Library-vs-IPC decision.
- Proposed package location and dependency direction.
- Persistent database location and ownership.
- Capability probe results for SQLite/FTS5.
- Finalized directory structure, schema delta, API contract delta, dependency proposal, ADRs, risks, and phased task plan.
- Exact list of files that Phase 1 would create or modify.

STOP RULE
After Phase 0, stop and request approval. Do not begin Phase 1, add major dependencies, migrate data, or make broad code changes without approval. Preserve unrelated user changes.

TARGET INVARIANTS
- Every operation requires namespaceId; namespace is isolation, not authentication.
- Consumers use only the public API and never SQL/database files.
- All SQL is parameterized; raw FTS syntax is not exposed to normal users.
- Writes use transactions and optimistic concurrency with expectedVersion.
- Content changes preserve immutable version snapshots.
- Feedback events are append-only and idempotent by (namespaceId, requestId).
- Default list/search returns only active, unexpired memories; exact-ID lookup may inspect non-deleted states.
- Core does not log memory text by default or transmit it externally.

MEMORY MODEL
- Types: working, semantic, episodic, procedural. Persisted working memory must expire.
- Statuses: candidate, active, flagged, rejected, deleted.
- Origins: direct, inferred, imported.
- Keep confidence separate from explicit userConfirmed state.
- Track UTC timestamps, expiry, soft deletion, metadata, and version.

REQUIRED LOGICAL STORAGE
- schema_migrations
- memory_items
- memory_versions
- sources
- memory_sources
- memory_feedback
- memory_fts (FTS5 external-content index synchronized transactionally)

SEARCH CONTRACT
- FTS5 keyword search and BM25 ranking.
- Namespace/type/status/origin/time filters and stable cursor pagination.
- Literal-safe query construction.
- Trigram tokenizer when supported.
- Parameterized, bounded substring fallback for queries shorter than three Unicode characters.
- Explicit Chinese and English tests.
- Index create/update/delete/rollback/rebuild integrity tests.
- No vector or embedding fallback.

PUBLIC OPERATIONS
- createMemory
- getMemory
- listMemories
- updateMemory
- deleteMemory (soft delete)
- searchMemories
- addSource
- getSources
- submitFeedback (confirm/correct/reject/flag)
- getFeedbackHistory
- privileged purgeMemory with explicit authorization/confirmation

ERRORS
Expose stable equivalents of VALIDATION_ERROR, NOT_FOUND, VERSION_CONFLICT, IDEMPOTENCY_CONFLICT, CAPABILITY_UNAVAILABLE, STORAGE_BUSY, STORAGE_ERROR, and FORBIDDEN. Never expose SQL or stored content in errors.

IMPLEMENTATION PHASES AFTER APPROVAL
1. SQLite foundation: connection, safe PRAGMAs, migrations/checksums, transactions, schema, FTS capability checks, backup/restore, test harness.
2. CRUD/classification/provenance: validation, typed contracts, versions, namespaces, sources, expiry, soft delete.
3. Search/feedback: safe FTS, BM25, cursors, Chinese/English and short-query behavior, append-only feedback, atomic corrections, idempotency.
4. Integration/release: consumer examples, 10,000-record benchmark, coverage, privacy/operations docs, purge, upgrade tests, release checklist.

ACCEPTANCE
- Data persists after restart; migrations are repeatable and checksum-verified.
- Foreign keys and rollback are proven by tests.
- Stale writes return VERSION_CONFLICT.
- All four memory types and valid state transitions work.
- Cross-namespace access/link tests fail safely.
- Sources and feedback are traceable; corrections preserve prior versions.
- Replayed identical feedback returns the original result; changed payload with the same requestId conflicts.
- FTS stays consistent through create/update/delete/rollback/rebuild.
- Chinese, English, metacharacter, SQL-injection, and 1–2-character search cases are tested.
- Consumer examples import only the public API.
- Benchmark reports dataset, hardware, database size, and p50/p95 results for 10,000 synthetic records; do not invent thresholds.
- Core service coverage target is at least 85%, with critical transaction/isolation behavior fully covered.

REPORTING
At each phase report: evidence, decisions, changed files, commands/tests actually run, actual results, remaining risks, and the next approval gate. Clearly separate completed work from proposals. Do not claim tests or capabilities that were not executed.

FIRST RESPONSE
Return only the Phase 0 discovery report and proposed Phase 1 file/change plan. If the repository is missing or empty, say so explicitly, leave language selection unresolved, and request the correct repository/worktree. Do not scaffold production code in an empty workspace.
```
