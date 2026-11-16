import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const [tarball, unpackDir] = process.argv.slice(2)
if (!tarball || !unpackDir) {
  console.error('usage: node tests/integration/check-tarball.mjs <tarball> <unpack-dir>')
  process.exit(2)
}
if (!existsSync(tarball)) throw new Error('tarball not found: ' + tarball)

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? '')
    process.stderr.write(result.stderr ?? '')
    throw new Error(command + ' failed with status ' + result.status)
  }
  return result.stdout
}

// Use the plain listing for names and the verbose listing only for modes.
// Parsing the verbose line with a single regex is tar-dialect dependent: BSD tar
// and GNU tar lay out owner/group/date fields differently, and a greedy or
// too-short field match silently turns the numeric fields into the path.
const names = run('tar', ['-tzf', tarball]).trim().split('\n').filter(Boolean)
const verbose = run('tar', ['-tvzf', tarball]).trim().split('\n').filter(Boolean)
if (names.length === 0) throw new Error('tarball is empty')
if (names.length !== verbose.length) {
  throw new Error('tar name and verbose listings disagree: ' + names.length + ' vs ' + verbose.length)
}
const entries = verbose.map((line, index) => {
  const mode = line.slice(0, 10)
  const name = names[index]
  if (!/^[d-]/.test(mode)) throw new Error('cannot parse tar mode: ' + line)
  if (!line.includes(name)) throw new Error('tar entry mismatch: ' + name + ' / ' + line)
  return { mode, name }
})

const failures = []
const forbidden = /(^|\/)(\.git|\.tmp|node_modules|tests|coverage)(\/|$)|\.(db|sqlite|sqlite3|db-wal|db-shm|log|tgz|pem|key|env)$|\.DS_Store$/
for (const entry of entries) {
  if (forbidden.test(entry.name)) failures.push('forbidden path: ' + entry.name + ' (' + entry.mode + ')')
  if (entry.mode.startsWith('-')) {
    if (entry.mode !== '-rw-r--r--') failures.push('non-644 file mode: ' + entry.mode + ' ' + entry.name)
  } else if (entry.mode.startsWith('d')) {
    if (entry.mode !== 'drwxr-xr-x') failures.push('non-755 directory mode: ' + entry.mode + ' ' + entry.name)
  } else {
    failures.push('unexpected tar entry type: ' + entry.mode + ' ' + entry.name)
  }
}

const entryNames = new Set(entries.map((entry) => entry.name))
for (const required of [
  'package/package.json',
  'package/LICENSE',
  'package/lib/index.js',
  'package/lib/plugin.js',
  'package/migrations/001_initial.sql',
  'package/cordis.patch.yml',
  'package/examples/weekly-retro/ingest.mjs',
  'package/examples/prompt-optimizer/ingest.mjs',
  'package/README.md',
  'package/assets/icon.png',
]) {
  if (!entryNames.has(required)) failures.push('missing required file: ' + required)
}

mkdirSync(unpackDir, { recursive: true })
run('tar', ['-xzf', tarball, '-C', unpackDir])
const packageRoot = join(unpackDir, 'package')
const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
if (manifest.name !== '@dreamaniax/dsh-memory-core') failures.push('unexpected package name: ' + manifest.name)
if (manifest.private === true) failures.push('package.json is still private')
if (manifest.license !== 'MIT') failures.push('package.json license is not MIT')
if (manifest.exports?.['./plugin']?.default !== './lib/plugin.js') failures.push('missing ./plugin export')
if (manifest.dsh?.bundle?.patch !== './cordis.patch.yml') failures.push('missing dsh.bundle.patch')
if (manifest.dependencies?.zod !== '4.6.6') failures.push('unexpected or missing zod dependency')
if (manifest.icon !== 'assets/icon.png') failures.push('unexpected or missing package icon: ' + String(manifest.icon))
if (!manifest.files?.includes('assets')) failures.push('package files does not include assets')

let iconBytes = 0
const iconPath = join(packageRoot, 'assets/icon.png')
if (!existsSync(iconPath)) {
  failures.push('missing packaged icon: assets/icon.png')
} else {
  iconBytes = statSync(iconPath).size
  if (iconBytes > 256 * 1024) failures.push('icon exceeds 256 KiB: ' + iconBytes)
  if (readFileSync(iconPath).subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') failures.push('icon is not a PNG')
}

const contentChecks = [
  ['local user path', /\/Users\/|\/home\/|OneDrive/],
  ['personal email', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
  ['github token', /gh[pousr]_[A-Za-z0-9]{20,}|github_pat_/],
  ['private key', /BEGIN (RSA |OPENSSH |EC |DSA )?PRIVATE KEY/],
]
for (const entry of entries) {
  if (!entry.mode.startsWith('-')) continue
  if (/\.(png|jpe?g|webp|gif|ico|woff2?|ttf|otf|pdf|zip|gz|tgz|sqlite3?|db)$/i.test(entry.name)) continue
  const path = join(unpackDir, entry.name)
  if (!existsSync(path)) continue
  const text = readFileSync(path, 'utf8')
  for (const [label, pattern] of contentChecks) {
    if (pattern.test(text)) failures.push(label + ' in ' + entry.name)
  }
}

const files = entries.filter((entry) => entry.mode.startsWith('-')).length
const bytes = statSync(tarball).size
if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}
console.log(JSON.stringify({
  ok: true,
  tarball,
  bytes,
  entries: entries.length,
  files,
  packageName: manifest.name,
  packageVersion: manifest.version,
  private: manifest.private,
  requiredFiles: 10,
  iconBytes,
  modes: 'all files 0644, directories 0755',
  forbiddenPaths: 0,
  contentFindings: 0,
}, null, 2))
