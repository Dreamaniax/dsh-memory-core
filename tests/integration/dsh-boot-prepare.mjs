import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const [root, dshHome] = process.argv.slice(2)
if (!root || !dshHome) {
  console.error('usage: node tests/integration/dsh-boot-prepare.mjs <repo-root> <dsh-home>')
  process.exit(2)
}

const profileDir = join(dshHome, 'profiles', 'web')
const modulesDir = join(profileDir, 'node_modules')
const packageDir = join(modulesDir, 'dsh-memory-core')
const zodDir = join(modulesDir, 'zod')
const probeDir = join(modulesDir, 'dsh-memory-core-probe')

mkdirSync(packageDir, { recursive: true })
mkdirSync(zodDir, { recursive: true })
mkdirSync(probeDir, { recursive: true })

for (const entry of ['package.json', 'cordis.patch.yml']) {
  cpSync(join(root, entry), join(packageDir, entry))
}
for (const entry of ['lib', 'migrations']) {
  cpSync(join(root, entry), join(packageDir, entry), { recursive: true })
}
cpSync(join(root, 'node_modules', 'zod'), zodDir, { recursive: true })
cpSync(join(root, 'tests', 'fixtures', 'dsh-mount', 'probe'), probeDir, { recursive: true })

const manifestPath = join(profileDir, 'package.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
manifest.dependencies ??= {}
manifest.dependencies['dsh-memory-core'] = 'file:./node_modules/dsh-memory-core'
const bundles = manifest.dsh?.profile?.bundles
if (!Array.isArray(bundles)) throw new Error('profile manifest has no dsh.profile.bundles array')
if (!bundles.includes('dsh-memory-core')) bundles.push('dsh-memory-core')
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')

writeFileSync(
  join(profileDir, 'cordis.patch.yml'),
  ['- insert:', '    - id: dsh-memory-core-probe', '      name: dsh-memory-core-probe', ''].join('\n'),
)
