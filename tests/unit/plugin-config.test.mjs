import test from 'node:test'
import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { resolveDshHome, resolveMemoryCorePath } from '../../lib/plugin-config.js'

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
