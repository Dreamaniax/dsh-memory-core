import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDshHome, resolveMemoryCorePath } from '../../lib/plugin-config.js'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

test('resolveDshHome uses DSH_HOME when set', () => {
  assert.equal(resolveDshHome({ DSH_HOME: '/tmp/dsh-home' }), '/tmp/dsh-home')
  assert.equal(resolveDshHome({ DSH_HOME: '  /tmp/trimmed  ' }), '/tmp/trimmed')
})

test('resolveDshHome falls back to ~/.dsh', () => {
  assert.equal(resolveDshHome({}), join(homedir(), '.dsh'))
  assert.equal(resolveDshHome({ DSH_HOME: '   ' }), join(homedir(), '.dsh'))
})

test('resolveMemoryCorePath defaults under DSH_HOME', () => {
  assert.equal(
    resolveMemoryCorePath(undefined, { DSH_HOME: '/tmp/dsh-home' }),
    join('/tmp/dsh-home', 'memory-core', 'memory.sqlite3'),
  )
  assert.equal(
    resolveMemoryCorePath('  ', { DSH_HOME: '/tmp/dsh-home' }),
    join('/tmp/dsh-home', 'memory-core', 'memory.sqlite3'),
  )
})

test('resolveMemoryCorePath prefers an explicit path', () => {
  assert.equal(resolveMemoryCorePath('  /tmp/custom.sqlite3  ', { DSH_HOME: '/tmp/dsh-home' }), '/tmp/custom.sqlite3')
})

test('package manifest declares a bundled DSH plugin icon', () => {
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
  assert.equal(manifest.icon, 'assets/icon.png')
  assert.ok(manifest.files.includes('assets'))
  assert.equal(manifest.exports?.['./package.json'], './package.json')
  const icon = resolve(packageRoot, manifest.icon)
  assert.ok(icon.startsWith(packageRoot + '/'))
  assert.ok(statSync(icon).isFile())
  const bytes = readFileSync(icon)
  assert.ok(bytes.length <= 256 * 1024)
  assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  assert.equal(bytes.readUInt32BE(16), 512)
  assert.equal(bytes.readUInt32BE(20), 512)
})
