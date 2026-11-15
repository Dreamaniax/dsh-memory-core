#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openMemoryCore } from '../../lib/index.js'

const NAMESPACE = 'prompt-optimizer-example'

async function selftest() {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-memory-prompt-optimizer-'))
  const api = await openMemoryCore({ path: join(directory, 'memory.sqlite3') })
  try {
    const candidate = await api.createMemory({
      namespaceId: NAMESPACE,
      type: 'procedural',
      title: 'Move the acceptance criteria before the implementation steps',
      content:
        'The original prompt listed tools first and acceptance criteria last. The optimized prompt states the acceptance command, the evidence format, and the stop condition before any implementation instruction.',
      tags: ['prompt', 'acceptance', 'structure'],
      status: 'candidate',
      metadata: { example: 'prompt-optimizer', revision: 1 },
      sources: [{ type: 'file', externalRef: 'file:prompt-draft.md', title: 'prompt-draft.md', relation: 'origin' }],
    })

    const corrected = await api.submitFeedback({
      namespaceId: NAMESPACE,
      memoryId: candidate.id,
      action: 'correct',
      requestId: 'prompt-optimizer:revision-2',
      expectedVersion: candidate.version,
      comment: 'Add the evidence format and a stop condition.',
      actor: 'example',
      patch: {
        content:
          'The optimized prompt states the acceptance command, the evidence format, and the stop condition before any implementation instruction. It also tells the agent to report failed checks instead of claiming completion.',
        metadata: { example: 'prompt-optimizer', revision: 2 },
      },
    })
    assert.equal(corrected.memory.status, 'active')
    assert.equal(corrected.memory.version, 2)
    assert.equal(corrected.memory.metadata.revision, 2)

    const hits = await api.searchMemories({ namespaceId: NAMESPACE, query: 'acceptance evidence', statuses: ['active'] })
    assert.ok(hits.items.some((hit) => hit.memory.id === candidate.id), 'search should find the corrected prompt')

    const sources = await api.getSources({ namespaceId: NAMESPACE, memoryId: candidate.id })
    assert.equal(sources.length, 1)
    const versions = await api.getMemoryVersions({ namespaceId: NAMESPACE, memoryId: candidate.id })
    assert.ok(versions.total >= 2)
    const history = await api.getFeedbackHistory({ namespaceId: NAMESPACE, memoryId: candidate.id })
    assert.equal(history.total, 1)

    console.log(JSON.stringify({
      ok: true,
      example: 'prompt-optimizer',
      database: join(directory, 'memory.sqlite3'),
      version: corrected.memory.version,
      searchHits: hits.total,
      sources: sources.length,
      versions: versions.total,
      feedback: history.total,
    }, null, 2))
  } finally {
    await api.close()
    await rm(directory, { recursive: true, force: true })
  }
}

if (!process.argv.includes('--selftest')) {
  console.error('usage: node examples/prompt-optimizer/ingest.mjs --selftest')
  process.exit(2)
}
await selftest()
