import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import {
  MemoryError,
  isMemoryError,
  openMemoryCore,
  toMemoryError,
  openSqliteStore,
} from '../../lib/index.js'
import { MemoryManager } from '../../lib/core/memory-manager.js'
import { SourceService } from '../../lib/core/source-service.js'
import { MemoryRepository } from '../../lib/repositories/memory-repository.js'
import { SourceRepository } from '../../lib/repositories/source-repository.js'
import { makeTempDir } from '../helpers/temp-dir.mjs'

async function withCore(t, options = {}) {
  const temp = await makeTempDir('dsh-memory-api-')
  const path = join(temp.dir, 'memory.sqlite3')
  const api = await openMemoryCore({ path, ...options })
  t.after(async () => {
    await api.close().catch(() => undefined)
    await temp.cleanup()
  })
  return { api, path, temp }
}

async function expectCode(promise, code) {
  await assert.rejects(promise, error => {
    assert.equal(isMemoryError(error), true, 'expected MemoryError, got ' + error)
    assert.equal(error.code, code)
    assert.equal(error.name, 'MemoryError')
    return true
  })
}

function count(db, sql, ...params) {
  return Number(db.prepare(sql).get(...params).total)
}

test('creates, reads, lists, updates and versions memories', async t => {
  const { api } = await withCore(t)
  const created = await api.createMemory({
    namespaceId: 'team',
    type: 'semantic',
    title: 'Release notes',
    content: 'Memory Core v0.1 is local-first.',
    tags: ['release', 'two words'],
    confidence: 0.9,
    origin: 'direct',
    status: 'active',
    metadata: { owner: 'core' },
  })

  assert.match(created.id, /^[0-9a-f-]{36}$/)
  assert.equal(created.status, 'active')
  assert.equal(created.version, 1)
  assert.deepEqual(created.tags, ['release', 'two words'])
  assert.equal(created.confirmedAt === null, false)
  assert.equal(created.isExpired, false)

  const fetched = await api.getMemory({ namespaceId: 'team', memoryId: created.id })
  assert.equal(fetched.content, created.content)
  assert.equal(fetched.metadata.owner, 'core')

  const listed = await api.listMemories({ namespaceId: 'team' })
  assert.equal(listed.total, 1)
  assert.equal(listed.items.length, 1)
  assert.equal(listed.hasMore, false)

  const updated = await api.updateMemory({
    namespaceId: 'team',
    memoryId: created.id,
    expectedVersion: 1,
    patch: { content: 'Memory Core v0.1 is local-first and reusable.' },
    changeReason: 'clarify scope',
    changedBy: 'tester',
  })
  assert.equal(updated.version, 2)
  assert.equal(updated.content, 'Memory Core v0.1 is local-first and reusable.')

  const noop = await api.updateMemory({
    namespaceId: 'team',
    memoryId: created.id,
    expectedVersion: 2,
    patch: { content: updated.content },
  })
  assert.equal(noop.version, 2)

  const versions = await api.getMemoryVersions({ namespaceId: 'team', memoryId: created.id })
  assert.equal(versions.total, 2)
  assert.deepEqual(versions.items.map(item => item.changeType), ['update', 'create'])
  assert.equal(versions.items[0].changedBy, 'tester')
  assert.equal(versions.items[0].changeReason, 'clarify scope')
  assert.equal(versions.items[0].snapshot.version, 2)
})

test('rejects a version snapshot that does not match its namespace and memory row', async t => {
  const { api, path } = await withCore(t)
  const created = await api.createMemory({
    namespaceId: 'alpha',
    type: 'semantic',
    status: 'active',
    content: 'integrity probe',
  })
  const db = new DatabaseSync(path)
  try {
    const snapshot = { ...created, namespaceId: 'beta', version: 99 }
    db.prepare(
      'INSERT INTO memory_versions (namespace_id, memory_id, version, snapshot_json, content_hash, change_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('alpha', created.id, 99, JSON.stringify(snapshot), '0'.repeat(64), 'create', Date.now())
  } finally {
    db.close()
  }
  await expectCode(api.getMemoryVersions({ namespaceId: 'alpha', memoryId: created.id }), 'CORRUPT_DATABASE')
})

test('maps store open failures to a redacted public error', async t => {
  const temp = await makeTempDir('dsh-memory-open-error-')
  t.after(temp.cleanup)
  const directory = join(temp.dir, 'not-a-database')
  mkdirSync(directory)
  await assert.rejects(openMemoryCore({ path: directory }), error => {
    assert.equal(isMemoryError(error), true)
    assert.equal(error.code, 'STORAGE_ERROR')
    assert.equal(error.name, 'MemoryError')
    assert.doesNotMatch(error.message, /not-a-database|SQL|unable to open/i)
    return true
  })
})

test('working memory requires a future expiry and starts unconfirmed', async t => {
  const now = Date.now()
  const { api } = await withCore(t, { clock: { now: () => now } })

  await expectCode(api.createMemory({
    namespaceId: 'team',
    type: 'working',
    content: 'short-lived context',
  }), 'INVALID_ARGUMENT')

  await expectCode(api.createMemory({
    namespaceId: 'team',
    type: 'working',
    content: 'short-lived context',
    expiresAt: new Date(now - 1000).toISOString(),
  }), 'INVALID_ARGUMENT')

  const working = await api.createMemory({
    namespaceId: 'team',
    type: 'working',
    content: 'short-lived context',
    expiresAt: new Date(now + 60_000).toISOString(),
  })
  assert.equal(working.status, 'candidate')
  assert.equal(working.confirmedAt, null)
  assert.equal(working.isExpired, false)
})

test('identity is scoped by namespace and duplicate ids are rejected per namespace', async t => {
  const { api } = await withCore(t)
  const id = '11111111-1111-4111-8111-111111111111'
  const first = await api.createMemory({ id, namespaceId: 'alpha', type: 'semantic', status: 'active', content: 'alpha' })
  const second = await api.createMemory({ id, namespaceId: 'beta', type: 'semantic', status: 'active', content: 'beta' })
  assert.equal(first.id, id)
  assert.equal(second.id, id)
  assert.equal((await api.getMemory({ namespaceId: 'alpha', memoryId: id })).content, 'alpha')
  assert.equal((await api.getMemory({ namespaceId: 'beta', memoryId: id })).content, 'beta')
  await expectCode(api.createMemory({ id, namespaceId: 'alpha', type: 'semantic', content: 'duplicate' }), 'DUPLICATE_ID')
  assert.equal(await api.getMemory({ namespaceId: 'gamma', memoryId: id }), null)
  await expectCode(api.updateMemory({
    namespaceId: 'gamma',
    memoryId: id,
    expectedVersion: first.version,
    patch: { content: 'cross-namespace update' },
  }), 'NOT_FOUND')
  await expectCode(api.deleteMemory({ namespaceId: 'gamma', memoryId: id, expectedVersion: first.version }), 'NOT_FOUND')
  await expectCode(api.purgeMemory({
    namespaceId: 'gamma',
    memoryId: id,
    expectedVersion: first.version,
    confirmationToken: 'PURGE:gamma:' + id,
  }), 'NOT_FOUND')
  const alpha = await api.listMemories({ namespaceId: 'alpha' })
  const beta = await api.listMemories({ namespaceId: 'beta' })
  assert.equal(alpha.total, 1)
  assert.equal(beta.total, 1)
})

test('enforces versions, soft deletion, audit reads and confirmation-gated purge', async t => {
  const { api, path } = await withCore(t)
  const created = await api.createMemory({
    namespaceId: 'team',
    type: 'semantic',
    content: 'delete me',
    sources: [{ type: 'file', externalRef: 'file:///delete-me', title: 'origin' }],
  })
  const updated = await api.updateMemory({
    namespaceId: 'team',
    memoryId: created.id,
    expectedVersion: 1,
    patch: { content: 'delete me later' },
  })
  await expectCode(api.updateMemory({
    namespaceId: 'team',
    memoryId: created.id,
    expectedVersion: 1,
    patch: { content: 'stale' },
  }), 'VERSION_CONFLICT')

  await api.deleteMemory({ namespaceId: 'team', memoryId: created.id, expectedVersion: updated.version, reason: 'cleanup' })
  assert.equal(await api.getMemory({ namespaceId: 'team', memoryId: created.id }), null)
  const deleted = await api.getMemory({ namespaceId: 'team', memoryId: created.id, includeDeleted: true })
  assert.equal(deleted.status, 'deleted')
  assert.equal(deleted.version, 3)
  assert.equal(deleted.deletedAt === null, false)

  await expectCode(api.updateMemory({
    namespaceId: 'team',
    memoryId: created.id,
    expectedVersion: 3,
    patch: { content: 'no' },
  }), 'MEMORY_DELETED')
  await expectCode(api.deleteMemory({ namespaceId: 'team', memoryId: created.id, expectedVersion: 3 }), 'MEMORY_DELETED')
  await expectCode(api.addSource({
    namespaceId: 'team',
    memoryId: created.id,
    source: { type: 'manual', title: 'after delete' },
  }), 'MEMORY_DELETED')

  const sources = await api.getSources({ namespaceId: 'team', memoryId: created.id })
  assert.equal(sources.length, 1)
  const versions = await api.getMemoryVersions({ namespaceId: 'team', memoryId: created.id })
  assert.equal(versions.total, 3)
  assert.deepEqual(versions.items.map(item => item.changeType), ['delete', 'update', 'create'])

  await expectCode(api.purgeMemory({
    namespaceId: 'team',
    memoryId: created.id,
    expectedVersion: 3,
    confirmationToken: 'PURGE:team:wrong',
  }), 'CONFIRMATION_REQUIRED')
  await api.purgeMemory({
    namespaceId: 'team',
    memoryId: created.id,
    expectedVersion: 3,
    confirmationToken: 'PURGE:team:' + created.id,
  })
  assert.equal(await api.getMemory({ namespaceId: 'team', memoryId: created.id, includeDeleted: true }), null)
  await expectCode(api.getMemoryVersions({ namespaceId: 'team', memoryId: created.id }), 'NOT_FOUND')

  const db = new DatabaseSync(path)
  try {
    assert.equal(count(db, 'SELECT COUNT(*) AS total FROM memory_items'), 0)
    assert.equal(count(db, 'SELECT COUNT(*) AS total FROM memory_versions'), 0)
    assert.equal(count(db, 'SELECT COUNT(*) AS total FROM memory_sources'), 0)
    assert.equal(count(db, 'SELECT COUNT(*) AS total FROM sources'), 0)
  } finally {
    db.close()
  }
})

test('source provenance deduplicates by namespace and cleans only auto-created orphans', async t => {
  const { api, path } = await withCore(t)
  const a = await api.createMemory({
    namespaceId: 'team',
    type: 'episodic',
    content: 'first',
    sources: [{ type: 'file', externalRef: 'file:///shared', title: 'shared evidence' }],
  })
  const b = await api.createMemory({
    namespaceId: 'team',
    type: 'episodic',
    content: 'second',
    sources: [{ type: 'file', externalRef: 'file:///shared', title: 'shared evidence' }],
  })
  const aSources = await api.getSources({ namespaceId: 'team', memoryId: a.id })
  const bSources = await api.getSources({ namespaceId: 'team', memoryId: b.id })
  assert.equal(aSources.length, 1)
  assert.equal(aSources[0].id, bSources[0].id)
  assert.equal(aSources[0].autoCreated, true)
  assert.equal(aSources[0].relation, 'origin')

  const duplicate = await api.addSource({
    namespaceId: 'team',
    memoryId: a.id,
    source: { type: 'file', externalRef: 'file:///shared', relation: 'corroborates' },
  })
  assert.equal(duplicate.id, aSources[0].id)
  assert.equal(duplicate.relation, 'origin')

  const manual = await api.addSource({
    namespaceId: 'team',
    memoryId: b.id,
    source: { type: 'url', externalRef: 'https://example.com/evidence', title: 'manual' },
  })
  assert.equal(manual.autoCreated, false)
  assert.equal(manual.relation, 'origin')

  const other = await api.createMemory({ namespaceId: 'other', type: 'semantic', content: 'separate' })
  const otherSource = await api.addSource({
    namespaceId: 'other',
    memoryId: other.id,
    source: { type: 'file', externalRef: 'file:///shared' },
  })
  assert.notEqual(otherSource.id, aSources[0].id)

  await api.purgeMemory({
    namespaceId: 'team',
    memoryId: a.id,
    expectedVersion: a.version,
    confirmationToken: 'PURGE:team:' + a.id,
  })
  let db = new DatabaseSync(path)
  try {
    assert.equal(count(db, "SELECT COUNT(*) AS total FROM sources WHERE namespace_id = 'team' AND external_ref = 'file:///shared'"), 1)
    assert.equal(count(db, "SELECT COUNT(*) AS total FROM sources WHERE namespace_id = 'team' AND external_ref = 'https://example.com/evidence'"), 1)
  } finally {
    db.close()
  }

  await api.purgeMemory({
    namespaceId: 'team',
    memoryId: b.id,
    expectedVersion: b.version,
    confirmationToken: 'PURGE:team:' + b.id,
  })
  db = new DatabaseSync(path)
  try {
    assert.equal(count(db, "SELECT COUNT(*) AS total FROM sources WHERE namespace_id = 'team' AND external_ref = 'file:///shared'"), 0)
    assert.equal(count(db, "SELECT COUNT(*) AS total FROM sources WHERE namespace_id = 'team' AND external_ref = 'https://example.com/evidence'"), 1)
    assert.equal(count(db, "SELECT COUNT(*) AS total FROM memory_sources WHERE namespace_id = 'team'"), 0)
    assert.equal(count(db, "SELECT COUNT(*) AS total FROM memory_sources WHERE namespace_id = 'other'"), 1)
    assert.equal(count(db, "SELECT COUNT(*) AS total FROM sources WHERE namespace_id = 'team'"), 1)
  } finally {
    db.close()
  }
})

test('persists memories, versions, and sources across close and reopen', async () => {
  const temp = await makeTempDir('dsh-memory-persist-')
  const path = join(temp.dir, 'memory.sqlite3')
  try {
    const first = await openMemoryCore({ path })
    const created = await first.createMemory({
      namespaceId: 'persist',
      type: 'procedural',
      content: 'run tests before commit',
      sources: [{ type: 'manual', title: 'team convention' }],
    })
    await first.updateMemory({
      namespaceId: 'persist',
      memoryId: created.id,
      expectedVersion: 1,
      patch: { content: 'run typecheck, tests, and build before commit' },
    })
    await first.close()

    const second = await openMemoryCore({ path })
    try {
      const restored = await second.getMemory({ namespaceId: 'persist', memoryId: created.id })
      assert.equal(restored.version, 2)
      assert.equal(restored.content, 'run typecheck, tests, and build before commit')
      const versions = await second.getMemoryVersions({ namespaceId: 'persist', memoryId: created.id })
      assert.equal(versions.total, 2)
      const sources = await second.getSources({ namespaceId: 'persist', memoryId: created.id })
      assert.equal(sources.length, 1)
      assert.equal(sources[0].title, 'team convention')
    } finally {
      await second.close()
    }
  } finally {
    await temp.cleanup()
  }
})

test('rejects invalid inputs, unsafe metadata, and SQL injection strings', async t => {
  const { api, path } = await withCore(t)
  await expectCode(api.createMemory({ namespaceId: 'Bad Namespace', type: 'semantic', content: 'x' }), 'INVALID_ARGUMENT')
  await expectCode(api.createMemory({ namespaceId: 'team', type: 'semantic', content: '   ' }), 'INVALID_ARGUMENT')
  await expectCode(api.createMemory({ namespaceId: 'team', type: 'semantic', content: 'x', extra: true }), 'INVALID_ARGUMENT')
  await expectCode(api.getMemory({ namespaceId: 'team', memoryId: 'not-a-uuid' }), 'INVALID_ARGUMENT')
  await expectCode(api.createMemory({
    namespaceId: 'team',
    type: 'semantic',
    content: 'x',
    tags: Array.from({ length: 33 }, (_, index) => 'tag-' + index),
  }), 'INVALID_ARGUMENT')
  await expectCode(api.createMemory({
    namespaceId: 'team',
    type: 'semantic',
    content: 'x',
    metadata: { blob: 'x'.repeat(17_000) },
  }), 'INVALID_ARGUMENT')

  const polluted = JSON.parse('{"__proto__":{"polluted":true}}')
  await expectCode(api.createMemory({
    namespaceId: 'team',
    type: 'semantic',
    content: 'x',
    metadata: polluted,
  }), 'INVALID_ARGUMENT')

  const injection = "x'); DROP TABLE memory_items; --"
  const created = await api.createMemory({
    namespaceId: 'team',
    type: 'semantic',
    title: injection,
    content: injection,
    tags: [injection],
  })
  const fetched = await api.getMemory({ namespaceId: 'team', memoryId: created.id })
  assert.equal(fetched.content, injection)
  assert.deepEqual(fetched.tags, [injection])
  assert.equal(fetched.title, injection)

  await expectCode(api.updateMemory({
    namespaceId: 'team',
    memoryId: created.id,
    expectedVersion: created.version,
    patch: { status: 'active' },
  }), 'INVALID_ARGUMENT')
  await expectCode(api.backupTo('relative/backup.sqlite3'), 'INVALID_ARGUMENT')
  await expectCode(api.getSources({ namespaceId: 'team', memoryId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }), 'NOT_FOUND')

  const health = await api.healthCheck()
  assert.equal(health.ok, true)
  const db = new DatabaseSync(path)
  try {
    assert.equal(count(db, "SELECT COUNT(*) AS total FROM sqlite_master WHERE type = 'table' AND name = 'memory_items'"), 1)
    assert.equal(count(db, 'SELECT COUNT(*) AS total FROM memory_items'), 1)
  } finally {
    db.close()
  }
})

test('maps unexpected failures to stable errors without leaking driver text', () => {
  const driverError = new Error("SELECT content FROM memory_items WHERE content = 'secret'")
  const mapped = toMemoryError(driverError)
  assert.equal(isMemoryError(mapped), true)
  assert.equal(mapped.code, 'STORAGE_ERROR')
  assert.equal(mapped.message, 'Storage operation failed')
  assert.equal(mapped.message.includes('SELECT'), false)
  assert.equal(mapped.cause, driverError)

  const original = new MemoryError('NOT_FOUND', 'memory not found')
  assert.equal(toMemoryError(original), original)
  assert.equal(isMemoryError(driverError), false)
})

test('list filters by status, type, origin, source, expiry, and pagination', async t => {
  let now = 1_700_000_000_000
  const { api } = await withCore(t, { clock: { now: () => now } })
  const active = await api.createMemory({
    namespaceId: 'list',
    type: 'semantic',
    origin: 'inferred',
    status: 'active',
    content: 'active semantic',
    sources: [{ type: 'file', externalRef: 'file:///list' }],
  })
  await api.createMemory({ namespaceId: 'list', type: 'episodic', status: 'active', content: 'active episodic' })
  const candidate = await api.createMemory({ namespaceId: 'list', type: 'semantic', status: 'candidate', content: 'candidate' })
  const expiring = await api.createMemory({
    namespaceId: 'list',
    type: 'working',
    status: 'active',
    content: 'expires',
    expiresAt: new Date(now + 1000).toISOString(),
  })
  const source = (await api.getSources({ namespaceId: 'list', memoryId: active.id }))[0]

  assert.equal((await api.listMemories({ namespaceId: 'list' })).total, 3)
  assert.equal((await api.listMemories({ namespaceId: 'list', types: ['semantic'] })).total, 1)
  assert.equal((await api.listMemories({ namespaceId: 'list', statuses: ['candidate'] })).items[0].id, candidate.id)
  assert.equal((await api.listMemories({ namespaceId: 'list', origins: ['inferred'] })).items[0].id, active.id)
  assert.equal((await api.listMemories({ namespaceId: 'list', sourceId: source.id })).total, 1)

  const page = await api.listMemories({ namespaceId: 'list', limit: 2, offset: 0, orderBy: 'createdAt', order: 'asc' })
  assert.equal(page.items.length, 2)
  assert.equal(page.total, 3)
  assert.equal(page.hasMore, true)

  now += 2000
  assert.equal((await api.listMemories({ namespaceId: 'list' })).total, 2)
  const expired = await api.listMemories({ namespaceId: 'list', includeExpired: true })
  assert.equal(expired.total, 3)
  assert.equal(expired.items.find(item => item.id === expiring.id).isExpired, true)
})

test('rolls back a partial create when a storage constraint fails inside the transaction', async () => {
  const temp = await makeTempDir('dsh-memory-rollback-')
  const path = join(temp.dir, 'memory.sqlite3')
  try {
    const store = await openSqliteStore({ path })
    try {
      const manager = new MemoryManager(
        store,
        new MemoryRepository(store),
        new SourceService(new SourceRepository(store)),
      )
      assert.throws(() => manager.createMemory({
        namespaceId: 'rollback',
        type: 'semantic',
        title: '',
        content: 'will fail',
        tags: [],
        confidence: null,
        origin: 'direct',
        status: 'active',
        metadata: {},
        expiresAt: null,
        sources: [{ type: 'not-a-source-type', externalRef: null, title: '', metadata: {}, relation: 'origin' }],
      }), /CHECK constraint failed/)
      assert.equal(count(store.db, 'SELECT COUNT(*) AS total FROM memory_items'), 0)
      assert.equal(count(store.db, 'SELECT COUNT(*) AS total FROM memory_versions'), 0)
      assert.equal(count(store.db, 'SELECT COUNT(*) AS total FROM sources'), 0)
      assert.equal(count(store.db, 'SELECT COUNT(*) AS total FROM memory_sources'), 0)
    } finally {
      await store.close()
    }
  } finally {
    await temp.cleanup()
  }
})
