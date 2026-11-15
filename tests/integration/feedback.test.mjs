import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { openMemoryCore, openSqliteStore } from '../../lib/index.js'
import { FeedbackService } from '../../lib/core/feedback-service.js'
import { MemoryManager } from '../../lib/core/memory-manager.js'
import { SourceService } from '../../lib/core/source-service.js'
import { FeedbackRepository } from '../../lib/repositories/feedback-repository.js'
import { MemoryRepository } from '../../lib/repositories/memory-repository.js'
import { SourceRepository } from '../../lib/repositories/source-repository.js'
import { makeTempDir } from '../helpers/temp-dir.mjs'

async function withCore(t, options = {}) {
  const temp = await makeTempDir('dsh-memory-feedback-')
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

test('confirm is idempotent, sets confirmedAt, and versions only on state change', async t => {
  const { api } = await withCore(t)
  const created = await api.createMemory({
    namespaceId: 'feedback',
    type: 'semantic',
    content: 'original feedback content',
    status: 'candidate',
  })
  assert.equal(created.version, 1)
  assert.equal(created.confirmedAt, null)

  const first = await api.submitFeedback({
    namespaceId: 'feedback',
    memoryId: created.id,
    action: 'confirm',
    requestId: 'confirm-1',
    expectedVersion: 1,
    comment: 'looks good',
    metadata: { channel: 'test' },
    actor: 'tester',
  })
  assert.equal(first.duplicate, false)
  assert.equal(first.memory.status, 'active')
  assert.equal(first.memory.version, 2)
  assert.equal(first.memory.confirmedAt === null, false)
  assert.equal(first.feedback.action, 'confirm')
  assert.match(first.feedback.id, /^[0-9a-f-]{36}$/)
  assert.equal(first.feedback.requestId, 'confirm-1')
  assert.equal(first.feedback.requestHash.length, 64)
  assert.equal(first.feedback.expectedVersion, 1)
  assert.equal(first.feedback.appliedVersion, 2)
  assert.equal(first.feedback.comment, 'looks good')
  assert.equal(first.feedback.actor, 'tester')
  assert.deepEqual(first.feedback.metadata, { channel: 'test' })

  const versions = await api.getMemoryVersions({ namespaceId: 'feedback', memoryId: created.id })
  assert.equal(versions.total, 2)
  assert.equal(versions.items[0].changeType, 'confirm')
  assert.equal(versions.items[0].snapshot.status, 'active')
  assert.equal(versions.items[0].snapshot.version, 2)
  assert.equal(versions.items[0].changeReason, 'looks good')
  assert.equal(versions.items[0].changedBy, 'tester')

  const replay = await api.submitFeedback({
    namespaceId: 'feedback',
    memoryId: created.id,
    action: 'confirm',
    requestId: 'confirm-1',
    expectedVersion: 1,
    comment: 'looks good',
    metadata: { channel: 'test' },
    actor: 'tester',
  })
  assert.equal(replay.duplicate, true)
  assert.equal(replay.feedback.id, first.feedback.id)
  assert.equal(replay.memory.version, 2)
  assert.equal((await api.getFeedbackHistory({ namespaceId: 'feedback', memoryId: created.id })).total, 1)
  assert.equal((await api.getMemoryVersions({ namespaceId: 'feedback', memoryId: created.id })).total, 2)

  await expectCode(api.submitFeedback({
    namespaceId: 'feedback',
    memoryId: created.id,
    action: 'confirm',
    requestId: 'confirm-1',
    expectedVersion: 1,
    comment: 'different payload',
  }), 'IDEMPOTENCY_CONFLICT')

  const alreadyConfirmed = await api.submitFeedback({
    namespaceId: 'feedback',
    memoryId: created.id,
    action: 'confirm',
    requestId: 'confirm-2',
    expectedVersion: 2,
  })
  assert.equal(alreadyConfirmed.duplicate, false)
  assert.equal(alreadyConfirmed.memory.version, 2)
  assert.equal(alreadyConfirmed.feedback.appliedVersion, 2)
  assert.equal((await api.getMemoryVersions({ namespaceId: 'feedback', memoryId: created.id })).total, 2)

  const history = await api.getFeedbackHistory({ namespaceId: 'feedback', memoryId: created.id })
  assert.equal(history.total, 2)
  assert.equal(history.items[0].requestId, 'confirm-2')
  assert.equal(history.items[1].requestId, 'confirm-1')

  await expectCode(api.submitFeedback({
    namespaceId: 'feedback',
    memoryId: created.id,
    action: 'confirm',
    requestId: 'stale-confirm',
    expectedVersion: 1,
  }), 'VERSION_CONFLICT')
})

test('correct applies the patch, updates FTS, and writes a version snapshot', async t => {
  const { api } = await withCore(t)
  const created = await api.createMemory({
    namespaceId: 'correct',
    type: 'semantic',
    status: 'candidate',
    title: 'old title',
    content: 'old content alpha',
    tags: ['old', 'tag'],
  })

  const corrected = await api.submitFeedback({
    namespaceId: 'correct',
    memoryId: created.id,
    action: 'correct',
    requestId: 'correct-1',
    expectedVersion: 1,
    patch: {
      title: 'new title',
      content: 'corrected content beta',
      tags: ['new', 'tag'],
      confidence: 0.88,
      metadata: { reviewed: true },
    },
    comment: 'fix the record',
    actor: 'reviewer',
  })
  assert.equal(corrected.duplicate, false)
  assert.equal(corrected.memory.status, 'active')
  assert.equal(corrected.memory.origin, 'direct')
  assert.equal(corrected.memory.version, 2)
  assert.equal(corrected.memory.title, 'new title')
  assert.equal(corrected.memory.content, 'corrected content beta')
  assert.deepEqual(corrected.memory.tags, ['new', 'tag'])
  assert.equal(corrected.memory.confidence, 0.88)
  assert.deepEqual(corrected.memory.metadata, { reviewed: true })
  assert.equal(corrected.memory.confirmedAt === null, false)
  assert.deepEqual(corrected.feedback.patch, {
    title: 'new title',
    content: 'corrected content beta',
    tags: ['new', 'tag'],
    confidence: 0.88,
    metadata: { reviewed: true },
  })
  assert.equal(corrected.feedback.appliedVersion, 2)

  const versions = await api.getMemoryVersions({ namespaceId: 'correct', memoryId: created.id })
  assert.equal(versions.total, 2)
  assert.equal(versions.items[0].changeType, 'correct')
  assert.equal(versions.items[0].snapshot.title, 'new title')
  assert.equal(versions.items[0].changeReason, 'fix the record')
  assert.equal(versions.items[0].changedBy, 'reviewer')

  assert.equal((await api.searchMemories({ namespaceId: 'correct', query: 'alpha' })).total, 0)
  assert.equal((await api.searchMemories({ namespaceId: 'correct', query: 'beta' })).total, 1)

  const duplicate = await api.submitFeedback({
    namespaceId: 'correct',
    memoryId: created.id,
    action: 'correct',
    requestId: 'correct-1',
    expectedVersion: 1,
    patch: {
      title: 'new title',
      content: 'corrected content beta',
      tags: ['new', 'tag'],
      confidence: 0.88,
      metadata: { reviewed: true },
    },
    comment: 'fix the record',
    actor: 'reviewer',
  })
  assert.equal(duplicate.duplicate, true)
  assert.equal(duplicate.feedback.id, corrected.feedback.id)
  assert.equal(duplicate.memory.version, 2)

  await expectCode(api.submitFeedback({
    namespaceId: 'correct',
    memoryId: created.id,
    action: 'correct',
    requestId: 'correct-1',
    expectedVersion: 1,
    patch: { content: 'different content' },
    comment: 'fix the record',
    actor: 'reviewer',
  }), 'IDEMPOTENCY_CONFLICT')

  await expectCode(api.submitFeedback({
    namespaceId: 'correct',
    memoryId: created.id,
    action: 'correct',
    requestId: 'correct-2',
    expectedVersion: 2,
    patch: {},
  }), 'INVALID_ARGUMENT')

  await expectCode(api.submitFeedback({
    namespaceId: 'correct',
    memoryId: created.id,
    action: 'confirm',
    requestId: 'confirm-with-patch',
    expectedVersion: 2,
    patch: { content: 'not allowed' },
  }), 'INVALID_ARGUMENT')
})

test('correct enforces working-memory expiry and deleted-memory rules', async t => {
  let now = Date.now()
  const { api } = await withCore(t, { clock: { now: () => now } })
  const working = await api.createMemory({
    namespaceId: 'rules',
    type: 'working',
    status: 'active',
    content: 'working content',
    expiresAt: new Date(now + 60_000).toISOString(),
  })
  await expectCode(api.submitFeedback({
    namespaceId: 'rules',
    memoryId: working.id,
    action: 'correct',
    requestId: 'clear-expiry',
    expectedVersion: 1,
    patch: { expiresAt: null },
  }), 'INVALID_ARGUMENT')
  assert.equal((await api.getMemory({ namespaceId: 'rules', memoryId: working.id })).version, 1)

  const deleted = await api.createMemory({
    namespaceId: 'rules',
    type: 'semantic',
    status: 'candidate',
    content: 'delete me',
  })
  await api.deleteMemory({ namespaceId: 'rules', memoryId: deleted.id, expectedVersion: 1 })
  await expectCode(api.submitFeedback({
    namespaceId: 'rules',
    memoryId: deleted.id,
    action: 'confirm',
    requestId: 'confirm-deleted',
    expectedVersion: 2,
  }), 'MEMORY_DELETED')
})

test('reject and flag follow the state matrix and history survives soft delete only', async t => {
  const { api, path } = await withCore(t)

  const candidate = await api.createMemory({
    namespaceId: 'matrix',
    type: 'semantic',
    status: 'candidate',
    content: 'candidate matrix',
  })
  const rejected = await api.submitFeedback({
    namespaceId: 'matrix',
    memoryId: candidate.id,
    action: 'reject',
    requestId: 'reject-1',
    expectedVersion: 1,
  })
  assert.equal(rejected.memory.status, 'rejected')
  assert.equal(rejected.memory.version, 2)
  await expectCode(api.submitFeedback({
    namespaceId: 'matrix',
    memoryId: candidate.id,
    action: 'reject',
    requestId: 'reject-2',
    expectedVersion: 2,
  }), 'INVALID_STATE_TRANSITION')
  await expectCode(api.submitFeedback({
    namespaceId: 'matrix',
    memoryId: candidate.id,
    action: 'flag',
    requestId: 'flag-rejected',
    expectedVersion: 2,
  }), 'INVALID_STATE_TRANSITION')
  const revived = await api.submitFeedback({
    namespaceId: 'matrix',
    memoryId: candidate.id,
    action: 'confirm',
    requestId: 'confirm-rejected',
    expectedVersion: 2,
  })
  assert.equal(revived.memory.status, 'active')
  assert.equal(revived.memory.version, 3)

  const flaggedMemory = await api.createMemory({
    namespaceId: 'matrix',
    type: 'semantic',
    status: 'candidate',
    content: 'flagged matrix',
  })
  const flagged = await api.submitFeedback({
    namespaceId: 'matrix',
    memoryId: flaggedMemory.id,
    action: 'flag',
    requestId: 'flag-1',
    expectedVersion: 1,
  })
  assert.equal(flagged.memory.status, 'flagged')
  assert.equal(flagged.memory.version, 2)
  await expectCode(api.submitFeedback({
    namespaceId: 'matrix',
    memoryId: flaggedMemory.id,
    action: 'flag',
    requestId: 'flag-2',
    expectedVersion: 2,
  }), 'INVALID_STATE_TRANSITION')

  const active = await api.createMemory({
    namespaceId: 'matrix',
    type: 'semantic',
    status: 'active',
    content: 'active matrix',
  })
  const activeFlagged = await api.submitFeedback({
    namespaceId: 'matrix',
    memoryId: active.id,
    action: 'flag',
    requestId: 'flag-active',
    expectedVersion: 1,
  })
  assert.equal(activeFlagged.memory.status, 'flagged')
  const activeRejected = await api.submitFeedback({
    namespaceId: 'matrix',
    memoryId: active.id,
    action: 'reject',
    requestId: 'reject-active',
    expectedVersion: 2,
  })
  assert.equal(activeRejected.memory.status, 'rejected')

  await api.deleteMemory({
    namespaceId: 'matrix',
    memoryId: candidate.id,
    expectedVersion: revived.memory.version,
  })
  const softDeletedHistory = await api.getFeedbackHistory({ namespaceId: 'matrix', memoryId: candidate.id })
  assert.equal(softDeletedHistory.total, 2)

  await api.purgeMemory({
    namespaceId: 'matrix',
    memoryId: candidate.id,
    expectedVersion: revived.memory.version + 1,
    confirmationToken: 'PURGE:matrix:' + candidate.id,
  })
  await expectCode(api.getFeedbackHistory({ namespaceId: 'matrix', memoryId: candidate.id }), 'NOT_FOUND')

  const db = new DatabaseSync(path)
  try {
    assert.equal(count(db, 'SELECT COUNT(*) AS total FROM memory_feedback WHERE namespace_id = ?', 'matrix'), 3)
    assert.throws(() => db.prepare('UPDATE memory_feedback SET comment = ? WHERE namespace_id = ?').run('mutated', 'matrix'), /append-only/)
  } finally {
    db.close()
  }
})

test('addMemoryFeedback is an alias and namespace request ids are isolated', async t => {
  const { api } = await withCore(t)
  const created = await api.createMemory({
    namespaceId: 'alias',
    type: 'semantic',
    status: 'candidate',
    content: 'alias content',
  })
  const aliased = await api.addMemoryFeedback({
    namespaceId: 'alias',
    memoryId: created.id,
    action: 'confirm',
    requestId: 'shared-request',
    expectedVersion: 1,
  })
  assert.equal(aliased.memory.status, 'active')
  assert.equal(aliased.feedback.action, 'confirm')

  const otherMemory = await api.createMemory({
    namespaceId: 'other-alias',
    type: 'semantic',
    status: 'candidate',
    content: 'other content',
  })
  const other = await api.submitFeedback({
    namespaceId: 'other-alias',
    memoryId: otherMemory.id,
    action: 'confirm',
    requestId: 'shared-request',
    expectedVersion: 1,
  })
  assert.equal(other.duplicate, false)
  assert.notEqual(other.feedback.id, aliased.feedback.id)

  await expectCode(api.submitFeedback({
    namespaceId: 'alias',
    memoryId: otherMemory.id,
    action: 'confirm',
    requestId: 'shared-request',
    expectedVersion: 1,
  }), 'IDEMPOTENCY_CONFLICT')
})

test('feedback state, version, and event roll back together', async t => {
  const temp = await makeTempDir('dsh-memory-feedback-rollback-')
  const store = await openSqliteStore({ path: join(temp.dir, 'memory.sqlite3') })
  try {
    const memories = new MemoryRepository(store)
    const feedback = new FeedbackRepository(store)
    const manager = new MemoryManager(
      store,
      memories,
      new SourceService(new SourceRepository(store)),
    )
    const service = new FeedbackService(store, memories, feedback)
    const created = manager.createMemory({
      namespaceId: 'rollback',
      type: 'semantic',
      title: '',
      content: 'rollback content',
      tags: [],
      confidence: null,
      origin: 'direct',
      status: 'candidate',
      metadata: {},
      expiresAt: null,
      sources: [],
    })

    feedback.insert = () => {
      throw new Error('forced feedback insert failure')
    }
    assert.throws(() => service.submit({
      namespaceId: 'rollback',
      memoryId: created.id,
      action: 'confirm',
      requestId: 'rollback-confirm',
      expectedVersion: 1,
      metadata: {},
    }), /forced feedback insert failure/)

    const current = memories.findById('rollback', created.id, true)
    assert.equal(current.status, 'candidate')
    assert.equal(current.version, 1)
    assert.equal(count(store.db, 'SELECT COUNT(*) AS total FROM memory_versions'), 1)
    assert.equal(count(store.db, 'SELECT COUNT(*) AS total FROM memory_feedback'), 0)
  } finally {
    await store.close()
    await temp.cleanup()
  }
})

test('search and feedback survive close and reopen', async t => {
  const temp = await makeTempDir('dsh-memory-feedback-persist-')
  const path = join(temp.dir, 'memory.sqlite3')
  try {
    const first = await openMemoryCore({ path })
    const created = await first.createMemory({
      namespaceId: 'persist',
      type: 'semantic',
      status: 'candidate',
      content: 'persist token original',
    })
    await first.submitFeedback({
      namespaceId: 'persist',
      memoryId: created.id,
      action: 'correct',
      requestId: 'persist-correct',
      expectedVersion: 1,
      patch: { content: 'persist token corrected' },
      comment: 'persisted correction',
    })
    await first.close()

    const second = await openMemoryCore({ path })
    try {
      const page = await second.searchMemories({ namespaceId: 'persist', query: 'corrected' })
      assert.equal(page.total, 1)
      const history = await second.getFeedbackHistory({ namespaceId: 'persist', memoryId: created.id })
      assert.equal(history.total, 1)
      assert.equal(history.items[0].comment, 'persisted correction')
      const memory = await second.getMemory({ namespaceId: 'persist', memoryId: created.id })
      assert.equal(memory.version, 2)
      assert.equal(memory.content, 'persist token corrected')
    } finally {
      await second.close()
    }
  } finally {
    await temp.cleanup()
  }
})
