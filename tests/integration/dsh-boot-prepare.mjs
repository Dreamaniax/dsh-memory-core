import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const [root, dshHome, tarball] = process.argv.slice(2)
if (!root || !dshHome) {
  console.error('usage: node tests/integration/dsh-boot-prepare.mjs <repo-root> <dsh-home> [tarball]')
  process.exit(2)
}

const profileDir = join(dshHome, 'profiles', 'web')
const modulesDir = join(profileDir, 'node_modules')
const packageDir = join(modulesDir, 'dsh-memory-core')
const probeDir = join(modulesDir, 'dsh-memory-core-probe')

mkdirSync(modulesDir, { recursive: true })
mkdirSync(probeDir, { recursive: true })

if (tarball) {
  const cache = process.env.MEMORY_CORE_NPM_CACHE ?? join(root, '.tmp', 'npm-cache')
  const result = spawnSync(
    'npm',
    [
      'install',
      tarball,
      '--prefix',
      profileDir,
      '--no-save',
      '--legacy-peer-deps',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--fetch-retries=5',
      '--fetch-timeout=120000',
      '--cache',
      cache,
    ],
    { encoding: 'utf8' },
  )
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? '')
    process.stderr.write(result.stderr ?? '')
    throw new Error('npm install of tarball failed with status ' + result.status)
  }
} else {
  const zodDir = join(modulesDir, 'zod')
  mkdirSync(packageDir, { recursive: true })
  mkdirSync(zodDir, { recursive: true })
  for (const entry of ['package.json', 'cordis.patch.yml']) {
    cpSync(join(root, entry), join(packageDir, entry))
  }
  for (const entry of ['lib', 'migrations']) {
    cpSync(join(root, entry), join(packageDir, entry), { recursive: true })
  }
  cpSync(join(root, 'node_modules', 'zod'), zodDir, { recursive: true })
}

if (!existsSync(join(packageDir, 'package.json'))) {
  throw new Error('dsh-memory-core was not installed at ' + packageDir)
}
if (!existsSync(join(packageDir, 'cordis.patch.yml'))) {
  throw new Error('installed package has no cordis.patch.yml')
}
cpSync(join(root, 'tests', 'fixtures', 'dsh-mount', 'probe'), probeDir, { recursive: true })

const manifestPath = join(profileDir, 'package.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
manifest.dependencies ??= {}
manifest.dependencies['dsh-memory-core'] = tarball ? 'file:' + tarball : 'file:./node_modules/dsh-memory-core'
const bundles = manifest.dsh?.profile?.bundles
if (!Array.isArray(bundles)) throw new Error('profile manifest has no dsh.profile.bundles array')
if (!bundles.includes('dsh-memory-core')) bundles.push('dsh-memory-core')
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')

writeFileSync(
  join(profileDir, 'cordis.patch.yml'),
  ['- insert:', '    - id: dsh-memory-core-probe', '      name: dsh-memory-core-probe', ''].join('\n'),
)

const installed = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
console.log(
  JSON.stringify({
    mode: tarball ? 'tarball' : 'worktree-copy',
    tarball: tarball ?? null,
    packageVersion: installed.version,
    profileDir,
  }),
)
