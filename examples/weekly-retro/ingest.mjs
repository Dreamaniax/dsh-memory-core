#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openMemoryCore } from '../../lib/index.js'

const NAMESPACE = 'weekly-retro-example'
const LESSONS = [
  {
    key: 'compaction',
    type: 'procedural',
    title: 'Split a session before context compaction',
    content:
      'When a session crosses five context compactions, split the remaining work into a separate task. Batch production work is the usual cause: one session accumulated four compactions and a long tool loop before the work was handed off.',
    tags: ['workflow', 'compaction', 'handoff'],
    session: 'session:example-week-42',
  },
  {
    key: 'verification',
    type: 'procedural',
    title: 'Record the acceptance command, not only the claim',
    content:
      'A delivery is not complete until the acceptance command has run and its output is attached. The weekly review should carry the command, exit status, and a short result excerpt so the next session can reproduce it.',
    tags: ['verification', 'evidence', 'delivery'],
    session: 'session:example-week-42',
  },
]

async function selftest() {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-memory-weekly-retro-'))
  const api = await openMemoryCore({ path: join(directory, 'memory.sqlite3') })
  try {
    const created = []
    for (const lesson of LESSONS) {
      const candidate = await api.createMemory({
        namespaceId: NAMESPACE,
        type: lesson.type,
        title: lesson.title,
        content: lesson.content,
        tags: lesson.tags,
        metadata: { example: 'weekly-retro', lesson: lesson.key },
        sources: [{ type: 'session', externalRef: lesson.session, title: lesson.session, relation: 'origin' }],
      })
      const confirmed = await api.submitFeedback({
        namespaceId: NAMESPACE,
        memoryId: candidate.id,
        action: 'confirm',
        requestId: 'weekly-retro:' + lesson.key,
        expectedVersion: candidate.version,
        actor: 'example',
      })
      assert.equal(confirmed.memory.status, 'active')
      created.push(confirmed.memory)
    }

    const hits = await api.searchMemories({
      namespaceId: NAMESPACE,
      query: 'compaction',
      statuses: ['active'],
    })
    assert.ok(hits.items.some((hit) => hit.memory.id === created[0].id), 'search should find the compaction lesson')

    const listed = await api.listMemories({ namespaceId: NAMESPACE, statuses: ['active'] })
    assert.equal(listed.total, LESSONS.length)

    const versions = await api.getMemoryVersions({ namespaceId: NAMESPACE, memoryId: created[0].id })
    assert.ok(versions.total >= 2, 'confirm should append a version')
    const sources = await api.getSources({ namespaceId: NAMESPACE, memoryId: created[0].id })
    assert.equal(sources.length, 1)
    const history = await api.getFeedbackHistory({ namespaceId: NAMESPACE, memoryId: created[0].id })
    assert.equal(history.total, 1)

    console.log(JSON.stringify({
      ok: true,
      example: 'weekly-retro',
      database: join(directory, 'memory.sqlite3'),
      memories: listed.total,
      searchHits: hits.total,
      versions: versions.total,
      feedback: history.total,
    }, null, 2))
  } finally {
    await api.close()
    await rm(directory, { recursive: true, force: true })
  }
}

if (!process.argv.includes('--selftest')) {
  console.error('usage: node examples/weekly-retro/ingest.mjs --selftest')
  process.exit(2)
}
await selftest()
