import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const [evidenceDir, dshHome] = process.argv.slice(2)
if (!evidenceDir || !dshHome) {
  console.error('usage: node tests/integration/check-dsh-evidence.mjs <evidence-dir> <dsh-home>')
  process.exit(2)
}

function read(name) {
  const path = join(evidenceDir, name + '.json')
  if (!existsSync(path)) throw new Error('missing evidence: ' + path)
  return JSON.parse(readFileSync(path, 'utf8'))
}

const write = read('write')
const readback = read('read')
const failures = []
for (const [label, evidence] of [['write', write], ['read', readback]]) {
  if (evidence.ok !== true) failures.push(label + ': evidence.ok is not true')
  if (evidence.service !== 'memoryCore') failures.push(label + ': service is not memoryCore')
  if (evidence.status !== 'active') failures.push(label + ': memory status is ' + evidence.status)
  if (!(evidence.hits >= 1)) failures.push(label + ': search returned no hit')
  if (!(evidence.feedbackTotal >= 1)) failures.push(label + ': feedback history is empty')
  if (!evidence.healthBefore?.ok) failures.push(label + ': healthBefore failed')
  if (!evidence.healthAfter?.ok) failures.push(label + ': healthAfter failed')
  if (evidence.closedBefore !== true) failures.push(label + ': close did not resolve')
  if (evidence.closedRejected !== true) failures.push(label + ': API did not reject after close')
}
if (write.memoryId !== readback.memoryId) failures.push('write/read memory IDs differ')
const dbPath = join(dshHome, 'memory-core', 'memory.sqlite3')
if (!existsSync(dbPath)) failures.push('database missing at ' + dbPath)
for (const suffix of ['-wal', '-shm']) {
  if (existsSync(dbPath + suffix)) failures.push('clean close left ' + dbPath + suffix)
}
if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}
console.log(JSON.stringify({ ok: true, memoryId: write.memoryId, database: dbPath, writeHits: write.hits, feedbackTotal: write.feedbackTotal }, null, 2))
