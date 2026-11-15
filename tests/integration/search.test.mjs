import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { openMemoryCore } from '../../lib/index.js'
import { makeTempDir } from '../helpers/temp-dir.mjs'

async function withCore(t, options = {}) {
  const temp = await makeTempDir('dsh-memory-search-')
  const path = join(temp.dir, 'memory.sqlite3')
  const api = await openMemoryCore({ path, ...options })
  t.after(async () => {
    await api.close().catch(() => undefined)
    await temp.cleanup()
  })
  return { api, path }
}

async function expectCode(promise, code) {
  await assert.rejects(promise, error => {
    assert.equal(error?.code, code)
    return true
  })
}

function count(db, sql, ...params) {
  return Number(db.prepare(sql).get(...params).total)
}

test('search uses FTS for long words and LIKE for short CJK and English words', async t => {
  const { api } = await withCore(t)
  const chinese = await api.createMemory({
    namespaceId: 'search',
    type: 'semantic',
    status: 'active',
    title: '中文检索',
    content: '中文检索与人工智能系统，机器学习模型。',
    tags: ['检索', '人工智能'],
  })
  const english = await api.createMemory({
    namespaceId: 'search',
    type: 'episodic',
    status: 'active',
    title: 'Alpha weekly',
    content: 'alpha beta release notes for weekly retro',
  })
  const mixed = await api.createMemory({
    namespaceId: 'search',
    type: 'semantic',
    status: 'active',
    content: 'weekly 模型复盘与检索',
  })

  const two = await api.searchMemories({ namespaceId: 'search', query: '中文' })
  assert.equal(two.total, 1)
  assert.equal(two.items[0].memory.id, chinese.id)
  assert.equal(two.items[0].matchedBy, 'like')
  assert.equal(two.items[0].score, null)
  assert.ok(two.items[0].snippet.includes('中文'))

  const three = await api.searchMemories({ namespaceId: 'search', query: '人工智' })
  assert.equal(three.total, 1)
  assert.equal(three.items[0].matchedBy, 'fts')
  assert.equal(typeof three.items[0].score, 'number')

  const four = await api.searchMemories({ namespaceId: 'search', query: '机器学习' })
  assert.equal(four.total, 1)
  assert.equal(four.items[0].matchedBy, 'fts')

  const englishFts = await api.searchMemories({ namespaceId: 'search', query: 'weekly' })
  assert.equal(englishFts.total, 2)
  assert.equal(englishFts.items[0].matchedBy, 'fts')

  const shortEnglish = await api.searchMemories({ namespaceId: 'search', query: 'al' })
  assert.equal(shortEnglish.total, 1)
  assert.equal(shortEnglish.items[0].memory.id, english.id)
  assert.equal(shortEnglish.items[0].matchedBy, 'like')

  const mixedLike = await api.searchMemories({ namespaceId: 'search', query: 'weekly 模型' })
  assert.equal(mixedLike.total, 1)
  assert.equal(mixedLike.items[0].memory.id, mixed.id)
  assert.equal(mixedLike.items[0].matchedBy, 'like')

  const mixedFts = await api.searchMemories({ namespaceId: 'search', query: 'weekly release' })
  assert.equal(mixedFts.total, 1)
  assert.equal(mixedFts.items[0].memory.id, english.id)
  assert.equal(mixedFts.items[0].matchedBy, 'fts')
})

test('search filters by namespace, type, status, expiry, pagination, and snippet size', async t => {
  let now = Date.now()
  const { api } = await withCore(t, { clock: { now: () => now } })

  const episodic = await api.createMemory({
    namespaceId: 'filters',
    type: 'episodic',
    status: 'active',
    content: 'filter token alpha',
  })
  const semantic = await api.createMemory({
    namespaceId: 'filters',
    type: 'semantic',
    status: 'active',
    content: 'filter token beta',
  })
  const candidate = await api.createMemory({
    namespaceId: 'filters',
    type: 'semantic',
    status: 'candidate',
    content: 'filter token candidate',
  })
  const flaggedCandidate = await api.createMemory({
    namespaceId: 'filters',
    type: 'semantic',
    status: 'candidate',
    content: 'filter token flagged',
  })
  const flagged = (await api.submitFeedback({
    namespaceId: 'filters',
    memoryId: flaggedCandidate.id,
    action: 'flag',
    requestId: 'flag-filter',
    expectedVersion: flaggedCandidate.version,
  })).memory
  const rejectedCandidate = await api.createMemory({
    namespaceId: 'filters',
    type: 'semantic',
    status: 'candidate',
    content: 'filter token rejected',
  })
  await api.submitFeedback({
    namespaceId: 'filters',
    memoryId: rejectedCandidate.id,
    action: 'reject',
    requestId: 'reject-filter',
    expectedVersion: rejectedCandidate.version,
  })
  const working = await api.createMemory({
    namespaceId: 'filters',
    type: 'working',
    status: 'active',
    content: 'filter token working',
    expiresAt: new Date(now + 60_000).toISOString(),
  })
  await api.createMemory({
    namespaceId: 'other',
    type: 'semantic',
    status: 'active',
    content: 'filter token other',
  })

  const defaults = await api.searchMemories({ namespaceId: 'filters', query: 'filter token' })
  assert.equal(defaults.total, 3)
  assert.deepEqual(
    defaults.items.map(item => item.memory.id).sort(),
    [episodic.id, semantic.id, working.id].sort(),
  )

  const semanticOnly = await api.searchMemories({
    namespaceId: 'filters',
    query: 'filter token',
    types: ['semantic'],
  })
  assert.equal(semanticOnly.total, 1)
  assert.equal(semanticOnly.items[0].memory.id, semantic.id)

  const candidates = await api.searchMemories({
    namespaceId: 'filters',
    query: 'filter token',
    statuses: ['candidate'],
  })
  assert.equal(candidates.total, 1)
  assert.equal(candidates.items[0].memory.id, candidate.id)

  const flaggedOnly = await api.searchMemories({
    namespaceId: 'filters',
    query: 'filter token',
    statuses: ['flagged'],
  })
  assert.equal(flaggedOnly.total, 1)
  assert.equal(flaggedOnly.items[0].memory.id, flagged.id)

  const activeAndFlagged = await api.searchMemories({
    namespaceId: 'filters',
    query: 'filter token',
    statuses: ['active', 'flagged'],
  })
  assert.equal(activeAndFlagged.total, 4)

  const otherNamespace = await api.searchMemories({ namespaceId: 'other', query: 'filter token' })
  assert.equal(otherNamespace.total, 1)

  const page = await api.searchMemories({
    namespaceId: 'filters',
    query: 'filter token',
    limit: 2,
  })
  assert.equal(page.total, 3)
  assert.equal(page.items.length, 2)
  assert.equal(page.hasMore, true)

  const lastPage = await api.searchMemories({
    namespaceId: 'filters',
    query: 'filter token',
    limit: 2,
    offset: 2,
  })
  assert.equal(lastPage.total, 3)
  assert.equal(lastPage.items.length, 1)
  assert.equal(lastPage.hasMore, false)

  const smallSnippets = await api.searchMemories({
    namespaceId: 'filters',
    query: 'filter token',
    limit: 100,
    snippetChars: 32,
  })
  for (const item of smallSnippets.items) {
    assert.ok([...item.snippet].length <= 32)
  }

  now += 120_000
  const afterExpiry = await api.searchMemories({ namespaceId: 'filters', query: 'filter token' })
  assert.equal(afterExpiry.total, 2)
  const expired = await api.getMemory({ namespaceId: 'filters', memoryId: working.id })
  assert.equal(expired.isExpired, true)

  await expectCode(api.searchMemories({
    namespaceId: 'filters',
    query: 'filter token',
    statuses: ['rejected'],
  }), 'INVALID_ARGUMENT')
})

test('search results stay synchronized with update, correction, rejection, delete, purge, and rebuild', async t => {
  const { api, path } = await withCore(t)
  const created = await api.createMemory({
    namespaceId: 'lifecycle',
    type: 'semantic',
    status: 'active',
    content: 'alpha lifecycle token',
  })
  assert.equal((await api.searchMemories({ namespaceId: 'lifecycle', query: 'alpha' })).total, 1)

  const updated = await api.updateMemory({
    namespaceId: 'lifecycle',
    memoryId: created.id,
    expectedVersion: 1,
    patch: { content: 'beta lifecycle token' },
  })
  assert.equal((await api.searchMemories({ namespaceId: 'lifecycle', query: 'alpha' })).total, 0)
  assert.equal((await api.searchMemories({ namespaceId: 'lifecycle', query: 'beta' })).total, 1)

  const corrected = await api.submitFeedback({
    namespaceId: 'lifecycle',
    memoryId: created.id,
    action: 'correct',
    requestId: 'correct-lifecycle-1',
    expectedVersion: updated.version,
    patch: { content: 'gamma lifecycle token' },
  })
  assert.equal(corrected.memory.version, updated.version + 1)
  assert.equal((await api.searchMemories({ namespaceId: 'lifecycle', query: 'beta' })).total, 0)
  assert.equal((await api.searchMemories({ namespaceId: 'lifecycle', query: 'gamma' })).total, 1)

  const rejected = await api.submitFeedback({
    namespaceId: 'lifecycle',
    memoryId: created.id,
    action: 'reject',
    requestId: 'reject-lifecycle-1',
    expectedVersion: corrected.memory.version,
  })
  assert.equal(rejected.memory.status, 'rejected')
  assert.equal((await api.searchMemories({ namespaceId: 'lifecycle', query: 'gamma' })).total, 0)
  assert.equal((await api.getFeedbackHistory({
    namespaceId: 'lifecycle',
    memoryId: created.id,
  })).total, 2)

  await api.deleteMemory({
    namespaceId: 'lifecycle',
    memoryId: created.id,
    expectedVersion: rejected.memory.version,
    reason: 'cleanup',
  })
  assert.equal((await api.searchMemories({ namespaceId: 'lifecycle', query: 'gamma' })).total, 0)
  assert.equal((await api.getFeedbackHistory({ namespaceId: 'lifecycle', memoryId: created.id })).total, 2)

  const health = await api.healthCheck()
  assert.equal(health.ok, true)
  assert.equal(health.ftsIntegrityCheck, 'ok')

  await api.rebuildSearchIndex()
  assert.equal((await api.searchMemories({ namespaceId: 'lifecycle', query: 'gamma' })).total, 0)
  assert.equal((await api.healthCheck()).ok, true)

  await api.purgeMemory({
    namespaceId: 'lifecycle',
    memoryId: created.id,
    expectedVersion: rejected.memory.version + 1,
    confirmationToken: 'PURGE:lifecycle:' + created.id,
  })
  assert.equal(await api.getMemory({ namespaceId: 'lifecycle', memoryId: created.id, includeDeleted: true }), null)
  assert.equal((await api.searchMemories({ namespaceId: 'lifecycle', query: 'gamma' })).total, 0)
  await expectCode(api.getFeedbackHistory({ namespaceId: 'lifecycle', memoryId: created.id }), 'NOT_FOUND')

  const db = new DatabaseSync(path)
  try {
    assert.equal(count(db, 'SELECT COUNT(*) AS total FROM memory_fts'), 0)
  } finally {
    db.close()
  }
})

test('search treats FTS operators and SQL injection text as data', async t => {
  const { api, path } = await withCore(t)
  const created = await api.createMemory({
    namespaceId: 'injection',
    type: 'semantic',
    status: 'active',
    content: '100%_safe "quoted" alpha OR 1=1; DROP TABLE memory_items; --',
  })

  const queries = [
    '100%',
    '100%_s',
    '"quoted"',
    'NEAR(alpha)',
    '^alpha',
    'alpha" OR "beta',
    "' OR 1=1; DROP TABLE memory_items; --",
    'DROP TABLE memory_items',
  ]
  for (const query of queries) {
    const page = await api.searchMemories({ namespaceId: 'injection', query })
    assert.equal(Array.isArray(page.items), true)
  }

  const percent = await api.searchMemories({ namespaceId: 'injection', query: '%' })
  assert.equal(percent.total, 1)
  assert.equal(percent.items[0].memory.id, created.id)
  assert.equal(percent.items[0].matchedBy, 'like')

  const underscore = await api.searchMemories({ namespaceId: 'injection', query: '_' })
  assert.equal(underscore.total, 1)
  assert.equal(underscore.items[0].matchedBy, 'like')

  const normal = await api.searchMemories({ namespaceId: 'injection', query: 'alpha' })
  assert.equal(normal.total, 1)
  assert.equal(normal.items[0].matchedBy, 'fts')

  const db = new DatabaseSync(path)
  try {
    assert.equal(count(db, 'SELECT COUNT(*) AS total FROM memory_items'), 1)
  } finally {
    db.close()
  }
  assert.equal((await api.healthCheck()).ok, true)
})

test('search rejects invalid input without hiding the underlying table', async t => {
  const { api } = await withCore(t)
  const invalid = [
    { query: '' },
    { query: '   ' },
    { query: '\u0000' },
    { query: 'x'.repeat(501) },
    { query: 'alpha', statuses: [] },
    { query: 'alpha', statuses: ['deleted'] },
    { query: 'alpha', types: [] },
    { query: 'alpha', limit: 0 },
    { query: 'alpha', limit: 101 },
    { query: 'alpha', offset: -1 },
    { query: 'alpha', snippetChars: 31 },
    { query: 'alpha', extra: true },
  ]
  for (const input of invalid) {
    await expectCode(api.searchMemories({ namespaceId: 'invalid', ...input }), 'INVALID_ARGUMENT')
  }
  await expectCode(api.searchMemories({ namespaceId: 'INVALID', query: 'alpha' }), 'INVALID_ARGUMENT')
  assert.equal((await api.healthCheck()).ok, true)
})
