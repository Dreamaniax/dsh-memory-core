import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import {
  APPLICATION_ID,
  MemoryStorageError,
  openSqliteStore,
} from '../../lib/index.js'
import { makeTempDir } from '../helpers/temp-dir.mjs'

const INSERT_MEMORY = 'INSERT INTO memory_items ' +
  '(id, namespace_id, memory_type, status, extraction_origin, title, content, tags_text, confidence, metadata_json, version, created_at, updated_at, expires_at) ' +
  'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'

function insertMemory(db, overrides = {}) {
  const now = Date.now()
  const row = {
    id: overrides.id ?? '11111111-1111-4111-8111-111111111111',
    namespace: overrides.namespace ?? 'ns1',
    type: overrides.type ?? 'semantic',
    status: overrides.status ?? 'active',
    origin: overrides.origin ?? 'direct',
    title: overrides.title ?? 'title',
    content: overrides.content ?? 'content',
    tags: overrides.tags ?? '',
    confidence: overrides.confidence ?? null,
    metadata: overrides.metadata ?? '{}',
    version: overrides.version ?? 1,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    expiresAt: overrides.expiresAt ?? null,
  }
  db.prepare(INSERT_MEMORY).run(
    row.id,
    row.namespace,
    row.type,
    row.status,
    row.origin,
    row.title,
    row.content,
    row.tags,
    row.confidence,
    row.metadata,
    row.version,
    row.createdAt,
    row.updatedAt,
    row.expiresAt,
  )
  return row
}

test('initializes schema, pragmas, and migration metadata', async () => {
  const temp = await makeTempDir()
  try {
    const store = await openSqliteStore({ path: join(temp.dir, 'memory.db') })
    try {
      assert.equal(store.migrations.toVersion, 1)
      assert.equal(store.migrations.applied.length, 1)
      assert.equal(store.migrations.applied[0].version, 1)
      assert.equal(store.foreignKeys, true)
      assert.equal(store.journalMode, 'wal')

      const tables = store.db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      ).all().map(row => row.name)
      for (const expected of [
        'memory_items',
        'memory_versions',
        'sources',
        'memory_sources',
        'memory_feedback',
        'memory_fts',
        'schema_migrations',
      ]) {
        assert.ok(tables.includes(expected), 'missing table ' + expected)
      }

      const triggers = store.db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name",
      ).all().map(row => row.name)
      for (const expected of [
        'memory_items_fts_ai',
        'memory_items_fts_ad',
        'memory_items_fts_au',
        'memory_versions_no_update',
        'memory_feedback_no_update',
      ]) {
        assert.ok(triggers.includes(expected), 'missing trigger ' + expected)
      }

      const appId = store.db.prepare('PRAGMA application_id').get().application_id
      const userVersion = store.db.prepare('PRAGMA user_version').get().user_version
      const foreignKeys = store.db.prepare('PRAGMA foreign_keys').get().foreign_keys
      assert.equal(appId, APPLICATION_ID)
      assert.equal(userVersion, 1)
      assert.equal(foreignKeys, 1)

      const health = await store.healthCheck()
      assert.equal(health.ok, true)
      assert.equal(health.schemaVersion, 1)
      assert.equal(health.applicationId, APPLICATION_ID)
      assert.equal(health.ftsIntegrityCheck, 'ok')
    } finally {
      await store.close()
    }
  } finally {
    await temp.cleanup()
  }
})

test('persists data across close and reopen', async () => {
  const temp = await makeTempDir()
  const path = join(temp.dir, 'memory.db')
  try {
    const first = await openSqliteStore({ path })
    insertMemory(first.db, { id: 'persist-1', namespace: 'ns1', content: 'persist me' })
    await first.close()

    const second = await openSqliteStore({ path })
    try {
      const row = second.db.prepare(
        'SELECT content FROM memory_items WHERE namespace_id = ? AND id = ?',
      ).get('ns1', 'persist-1')
      assert.equal(row.content, 'persist me')
    } finally {
      await second.close()
    }
  } finally {
    await temp.cleanup()
  }
})

test('enforces namespace-scoped identity and foreign keys', async () => {
  const temp = await makeTempDir()
  try {
    const store = await openSqliteStore({ path: join(temp.dir, 'memory.db') })
    try {
      insertMemory(store.db, { id: 'same-id', namespace: 'ns1' })
      insertMemory(store.db, { id: 'same-id', namespace: 'ns2' })

      assert.throws(
        () => insertMemory(store.db, { id: 'same-id', namespace: 'ns1' }),
        /UNIQUE|constraint/i,
      )
      assert.throws(
        () => insertMemory(store.db, { id: 'working-1', namespace: 'ns1', type: 'working', expiresAt: null }),
        /CHECK|constraint/i,
      )

      const now = Date.now()
      store.db.prepare(
        'INSERT INTO sources (id, namespace_id, source_type, external_ref, title, metadata_json, auto_created, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run('source-1', 'ns1', 'session', 'session-1', 'source', '{}', 1, now)

      assert.throws(
        () => store.db.prepare(
          'INSERT INTO memory_sources (namespace_id, memory_id, source_id, relation, created_at) VALUES (?, ?, ?, ?, ?)',
        ).run('ns2', 'same-id', 'source-1', 'origin', now),
        /FOREIGN KEY|constraint/i,
      )
    } finally {
      await store.close()
    }
  } finally {
    await temp.cleanup()
  }
})

test('rolls back failed transactions and refuses nesting', async () => {
  const temp = await makeTempDir()
  try {
    const store = await openSqliteStore({ path: join(temp.dir, 'memory.db') })
    try {
      assert.throws(() => {
        store.transaction(() => {
          insertMemory(store.db, { id: 'rollback-1' })
          throw new Error('boom')
        })
      }, /boom/)
      const count = store.db.prepare('SELECT count(*) AS c FROM memory_items').get().c
      assert.equal(count, 0)

      assert.throws(
        () => store.transaction(() => store.transaction(() => undefined)),
        /nested transactions/i,
      )
    } finally {
      await store.close()
    }
  } finally {
    await temp.cleanup()
  }
})

test('keeps FTS5 synchronized and stable across VACUUM', async () => {
  const temp = await makeTempDir()
  try {
    const store = await openSqliteStore({ path: join(temp.dir, 'memory.db') })
    try {
      insertMemory(store.db, {
        id: 'fts-1',
        namespace: 'ns1',
        title: '每周复盘',
        content: '用户希望把重复劳动沉淀成技能，周五自动生成周报。',
      })

      const search = () => store.db.prepare(
        'SELECT m.id FROM memory_fts f JOIN memory_items m ON m.fts_rowid = f.rowid WHERE memory_fts MATCH ? AND m.namespace_id = ?',
      ).all('"每周复盘"', 'ns1').map(row => row.id)

      assert.deepEqual(search(), ['fts-1'])
      store.db.exec('VACUUM')
      assert.deepEqual(search(), ['fts-1'])

      store.db.prepare('UPDATE memory_items SET content = ? WHERE namespace_id = ? AND id = ?')
        .run('全新的内容，已经不再包含旧词。', 'ns1', 'fts-1')
      const oldMatches = store.db.prepare(
        'SELECT m.id FROM memory_fts f JOIN memory_items m ON m.fts_rowid = f.rowid WHERE memory_fts MATCH ?',
      ).all('"重复劳动"').map(row => row.id)
      const newMatches = store.db.prepare(
        'SELECT m.id FROM memory_fts f JOIN memory_items m ON m.fts_rowid = f.rowid WHERE memory_fts MATCH ?',
      ).all('"全新的内容"').map(row => row.id)
      assert.deepEqual(oldMatches, [])
      assert.deepEqual(newMatches, ['fts-1'])
    } finally {
      await store.close()
    }
  } finally {
    await temp.cleanup()
  }
})

test('creates a verifiable online backup', async () => {
  const temp = await makeTempDir()
  try {
    const store = await openSqliteStore({ path: join(temp.dir, 'memory.db') })
    try {
      insertMemory(store.db, { id: 'backup-1', content: 'backup me' })
      const backupPath = join(temp.dir, 'backup.db')
      const result = await store.backupTo(backupPath)
      assert.ok(result.bytes > 0)
      assert.equal(result.integrity, 'ok')

      const copy = new DatabaseSync(backupPath)
      try {
        const row = copy.prepare('SELECT content FROM memory_items WHERE namespace_id = ? AND id = ?')
          .get('ns1', 'backup-1')
        assert.equal(row.content, 'backup me')
      } finally {
        copy.close()
      }
    } finally {
      await store.close()
    }
  } finally {
    await temp.cleanup()
  }
})

test('close is idempotent and later calls fail with CLOSED', async () => {
  const temp = await makeTempDir()
  try {
    const store = await openSqliteStore({ path: join(temp.dir, 'memory.db') })
    await store.close()
    await store.close()
    assert.throws(
      () => store.transaction(() => undefined),
      (error) => error instanceof MemoryStorageError && error.code === 'CLOSED',
    )
  } finally {
    await temp.cleanup()
  }
})
