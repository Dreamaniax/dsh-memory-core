#!/usr/bin/env node
/**
 * Sprint 3 search/write benchmark.
 *
 * Creates 10,000 synthetic memories in an OS temp directory, measures API
 * latency, and reports database/index sizes. It never touches a real DSH
 * profile. Run with:
 *
 *   node benchmarks/10k.mjs
 *   node benchmarks/10k.mjs --memories=20000
 *
 * Output is a single JSON document on stdout. The measurements are a
 * point-in-time local benchmark, not a ten-year capacity forecast.
 */
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { openMemoryCore } from '../lib/index.js'

const TOTAL = Number.parseInt(
  process.argv.find((arg) => arg.startsWith('--memories='))?.split('=')[1] ?? '10000',
  10,
)
if (!Number.isInteger(TOTAL) || TOTAL < 1) {
  throw new Error('--memories must be a positive integer')
}

const QUERY_CASES = [
  { label: 'fts_en', query: 'alpha', expectedMode: 'fts' },
  { label: 'fts_en_pair', query: 'alpha bravo', expectedMode: 'fts' },
  { label: 'fts_cn_4', query: '系统设计', expectedMode: 'fts' },
  { label: 'fts_cn_4b', query: '知识管理', expectedMode: 'fts' },
  { label: 'like_cn_2', query: '记忆', expectedMode: 'like' },
  { label: 'like_cn_2b', query: '模型', expectedMode: 'like' },
  { label: 'fts_mixed', query: 'memory core', expectedMode: 'fts' },
  { label: 'fts_tech', query: 'retrieval', expectedMode: 'fts' },
]

const CONTENT = [
  'lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt.',
  'The local store keeps durable knowledge with provenance, versions, and explicit feedback.',
  '软件架构需要把存储、查询、版本和反馈拆成可验证的边界，而不是把所有逻辑塞进一个接口。',
  '长期知识的关键不是保存更多文本，而是让每条结论都能追溯到来源和确认记录。',
  '长期记录分为工作、语义、情景和程序四种类型，不同类型的生命周期不同。',
  '生成式输出只是候选，只有经过用户确认或明确规则过滤后才能成为可检索的长期知识。',
  'Quality depends on tokenization, index freshness, ranking, and a bounded snippet budget.',
  'A local-first store must degrade predictably when the disk is full or the database is busy.',
  '架构演进要先加可观测性，再加自动化；没有证据的自动巩固只会放大错误。',
  '反馈事件是追加写入的审计记录，纠正内容时必须同时写版本快照，不能只改当前行。',
  'The benchmark inserts realistic mixed-language records and then measures read latency.',
  'SQLite WAL, FTS5 trigram, and foreign keys are the storage primitives under test.',
]

function padTo(text, minCodePoints) {
  const parts = [text]
  let i = 0
  while ([...parts.join(' ')].length < minCodePoints) {
    parts.push(CONTENT[(i + text.length) % CONTENT.length])
    i += 1
  }
  return parts.join(' ')
}

function buildMemory(index) {
  const terms = []
  if (index % 4 === 0) terms.push('alpha')
  if (index % 5 === 0) terms.push('bravo')
  if (index % 7 === 0) terms.push('系统设计')
  if (index % 6 === 0) terms.push('知识管理')
  if (index % 3 === 0) terms.push('记忆')
  if (index % 8 === 0) terms.push('模型')
  if (index % 10 === 0) terms.push('retrieval')
  if (index % 9 === 0) terms.push('memory core')
  const termLine = terms.length > 0
    ? 'Probe terms for this record: ' + terms.join(', ') + '.'
    : 'This record intentionally has no extra probe term.'
  const content = padTo(
    termLine + ' Synthetic entry ' + index + ' is immutable benchmark input. ' + CONTENT[index % CONTENT.length],
    700 + (index % 5) * 180,
  )
  const type = index % 10 < 3 ? 'semantic' : index % 10 < 6 ? 'episodic' : index % 10 < 8 ? 'procedural' : 'working'
  const status = ((index * 2654435761) >>> 0) % 5 === 0 ? 'candidate' : 'active'
  const now = Date.now()
  const input = {
    namespaceId: 'benchmark',
    type,
    status,
    title: 'Benchmark record ' + index + (terms.length > 0 ? ' — ' + terms[0] : ''),
    content,
    tags: ['benchmark', type, 'probe-' + (index % 20)],
    confidence: status === 'active' ? 0.9 : 0.4,
    metadata: { benchmarkIndex: index, cohort: '10k', type },
  }
  if (type === 'working') {
    input.expiresAt = new Date(now + 365 * 24 * 60 * 60 * 1000).toISOString()
  }
  if (index % 3 === 0) {
    input.sources = [{
      type: 'file',
      externalRef: 'file:///benchmark/record-' + index + '.md',
      title: 'Synthetic source ' + index,
      metadata: { generated: true },
    }]
  }
  return input
}

function percentile(values, p) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[rank]
}

function stats(values) {
  if (values.length === 0) return null
  const total = values.reduce((sum, value) => sum + value, 0)
  return {
    count: values.length,
    totalMs: round(total),
    meanMs: round(total / values.length),
    minMs: round(Math.min(...values)),
    p50Ms: round(percentile(values, 50)),
    p95Ms: round(percentile(values, 95)),
    p99Ms: round(percentile(values, 99)),
    maxMs: round(Math.max(...values)),
  }
}

function round(value) {
  return Math.round(value * 1000) / 1000
}

function nowMs() {
  return Number(process.hrtime.bigint()) / 1e6
}

async function fileSize(path) {
  try {
    return (await stat(path)).size
  } catch {
    return 0
  }
}

function readStorage(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    const sqliteVersion = db.prepare('SELECT sqlite_version() AS version').get().version
    const pageCount = db.prepare('PRAGMA page_count').get().page_count
    const pageSize = db.prepare('PRAGMA page_size').get().page_size
    let dbstat = null
    try {
      const rows = db.prepare('SELECT name, SUM(pgsize) AS bytes FROM dbstat GROUP BY name ORDER BY bytes DESC').all()
      dbstat = rows.map((row) => ({ name: row.name, bytes: Number(row.bytes) }))
    } catch (error) {
      dbstat = { unavailable: String(error?.message ?? error) }
    }
    return { sqliteVersion, pageCount, pageSize, dbstat }
  } finally {
    db.close()
  }
}

const directory = await mkdtemp(join(tmpdir(), 'dsh-memory-core-benchmark-'))
const dbPath = join(directory, 'memory.sqlite3')
const started = new Date().toISOString()
const createTimes = []
const updateTimes = []
const feedbackTimes = []
const searchTimes = []
const searchByCase = new Map()
let api

try {
  const openStart = nowMs()
  api = await openMemoryCore({ path: dbPath })
  const openMs = nowMs() - openStart
  const memories = []
  const candidates = []
  const active = []

  for (let i = 0; i < TOTAL; i += 1) {
    const input = buildMemory(i)
    const t0 = nowMs()
    const memory = await api.createMemory(input)
    createTimes.push(nowMs() - t0)
    if (i % 20 === 0) memories.push(memory)
    if (memory.status === 'candidate') candidates.push(memory)
    if (memory.status === 'active') active.push(memory)
  }

  const updateSample = active.filter((_, index) => index % 20 === 0).slice(0, Math.max(0, Math.min(500, Math.floor(TOTAL / 20))))
  for (const memory of updateSample) {
    const t0 = nowMs()
    await api.updateMemory({
      namespaceId: 'benchmark',
      memoryId: memory.id,
      expectedVersion: memory.version,
      patch: { content: memory.content + ' Updated by the benchmark write sample.' },
      changeReason: 'benchmark-update',
      changedBy: 'benchmark',
    })
    updateTimes.push(nowMs() - t0)
  }

  for (const memory of candidates.slice(0, Math.min(200, candidates.length))) {
    const t0 = nowMs()
    await api.submitFeedback({
      namespaceId: 'benchmark',
      memoryId: memory.id,
      action: 'confirm',
      requestId: 'benchmark-confirm-' + memory.id,
      expectedVersion: memory.version,
      comment: 'synthetic benchmark confirmation',
    })
    feedbackTimes.push(nowMs() - t0)
  }

  for (const queryCase of QUERY_CASES) {
    for (let i = 0; i < 5; i += 1) {
      await api.searchMemories({ namespaceId: 'benchmark', query: queryCase.query, limit: 20, snippetChars: 160 })
    }
    const values = []
    let matchedBy = null
    let total = null
    for (let i = 0; i < 25; i += 1) {
      const t0 = nowMs()
      const page = await api.searchMemories({
        namespaceId: 'benchmark',
        query: queryCase.query,
        limit: 20,
        snippetChars: 160,
      })
      const elapsed = nowMs() - t0
      values.push(elapsed)
      searchTimes.push(elapsed)
      matchedBy = page.items[0]?.matchedBy ?? null
      total = page.total
    }
    searchByCase.set(queryCase.label, {
      query: queryCase.query,
      expectedMode: queryCase.expectedMode,
      observedMode: matchedBy,
      total,
      samples: values.length,
      latencyMs: stats(values),
    })
  }

  const health = await api.healthCheck()
  await api.close()
  api = undefined

  const storage = readStorage(dbPath)
  const dbstat = Array.isArray(storage.dbstat) ? storage.dbstat : []
  const sumWhere = (predicate) => dbstat.filter((row) => predicate(row.name)).reduce((sum, row) => sum + row.bytes, 0)
  const ftsBytes = sumWhere((name) => name.startsWith('memory_fts'))
  const mainBytes = sumWhere((name) =>
    ['memory_items', 'memory_versions', 'sources', 'memory_sources', 'memory_feedback', 'schema_migrations'].includes(name),
  )
  const mainBytesWithIndexes = storage.pageCount * storage.pageSize
  const result = {
    schema: 'dsh-memory-core-benchmark/v1',
    generatedAt: started,
    environment: {
      platform: process.platform,
      arch: process.arch,
      release: (await import('node:os')).release(),
      cpu: (await import('node:os')).cpus()[0]?.model ?? 'unknown',
      cpuCount: (await import('node:os')).cpus().length,
      totalMemoryBytes: (await import('node:os')).totalmem(),
      node: process.versions.node,
      sqlite: storage.sqliteVersion,
      v8: process.versions.v8,
    },
    dataset: {
      requestedMemories: TOTAL,
      insertedMemories: createTimes.length,
      active: active.length,
      candidates: candidates.length,
      types: {
        semantic: Math.ceil(TOTAL * 0.3),
        episodic: Math.ceil(TOTAL * 0.3),
        procedural: Math.ceil(TOTAL * 0.2),
        working: Math.ceil(TOTAL * 0.2),
      },
      sources: Math.ceil(TOTAL / 3),
      versionUpdates: updateTimes.length,
      feedbackEvents: feedbackTimes.length,
      contentPolicy: '700–1420 code points per record; 20% candidate / 80% active; mixed English and Chinese probes',
    },
    timing: {
      openMs: round(openMs),
      create: stats(createTimes),
      updateSample: stats(updateTimes),
      feedbackSample: stats(feedbackTimes),
      search: stats(searchTimes),
      byCase: Object.fromEntries(searchByCase),
    },
    storage: {
      databaseBytes: mainBytesWithIndexes,
      databaseFileBytes: await fileSize(dbPath),
      walFileBytes: await fileSize(dbPath + '-wal'),
      shmFileBytes: await fileSize(dbPath + '-shm'),
      pageSize: storage.pageSize,
      pageCount: storage.pageCount,
      mainTableBytes: mainBytes,
      ftsBytes,
      dbstat: dbstat.slice(0, 30),
      health,
    },
    notes: [
      'Measured on this machine at this time; values are not a ten-year capacity forecast.',
      'Create timings include validation, one transaction, initial version snapshot, and FTS trigger work.',
      'Update/feedback samples are measured separately and are excluded from create latency.',
      'dbstat bytes are SQLite page accounting and may differ from filesystem size because of free pages, WAL, and rounding.',
    ],
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
} finally {
  if (api) {
    await api.close().catch(() => undefined)
  }
  await rm(directory, { recursive: true, force: true }).catch(() => undefined)
}
