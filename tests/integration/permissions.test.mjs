import assert from 'node:assert/strict'
import test from 'node:test'
import { chmodSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openMemoryCore } from '../../lib/index.js'
import { makeTempDir } from '../helpers/temp-dir.mjs'

function mode(path) {
  return statSync(path).mode & 0o777
}

test('tightens pre-existing directory and database permissions', { skip: process.platform === 'win32' }, async t => {
  const temp = await makeTempDir('dsh-memory-permissions-')
  t.after(temp.cleanup)

  const dataDir = join(temp.dir, 'data')
  mkdirSync(dataDir, { mode: 0o755 })
  chmodSync(dataDir, 0o755)
  const dbPath = join(dataDir, 'memory.sqlite3')
  writeFileSync(dbPath, '')
  chmodSync(dbPath, 0o644)

  const api = await openMemoryCore({ path: dbPath })
  t.after(() => api.close().catch(() => undefined))
  await api.createMemory({
    namespaceId: 'permissions',
    type: 'semantic',
    status: 'active',
    content: 'private',
  })

  assert.equal(mode(dataDir), 0o700)
  assert.equal(mode(dbPath), 0o600)
  assert.equal(existsSync(dbPath + '-wal'), true)
  assert.equal(mode(dbPath + '-wal'), 0o600)
  assert.equal(mode(dbPath + '-shm'), 0o600)

  const backupDir = join(temp.dir, 'backups')
  mkdirSync(backupDir, { mode: 0o755 })
  chmodSync(backupDir, 0o755)
  const backup = await api.backupTo(join(backupDir, 'copy.sqlite3'))
  assert.equal(mode(backupDir), 0o700)
  assert.equal(mode(backup.path), 0o600)
})
