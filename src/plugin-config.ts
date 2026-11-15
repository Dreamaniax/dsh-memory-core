import { homedir } from 'node:os'
import { join } from 'node:path'

/** Resolve the DSH home directory used by the host process. */
export function resolveDshHome(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.DSH_HOME?.trim()
  return configured && configured.length > 0 ? configured : join(homedir(), '.dsh')
}

/**
 * Resolve the default memory database path.
 *
 * An explicit path from the plugin config always wins. Otherwise the database
 * lives under the same DSH_HOME as the host profile, so backups and profiles
 * stay together. ':memory:' remains available for tests.
 */
export function resolveMemoryCorePath(
  configuredPath: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const explicit = configuredPath?.trim()
  if (explicit) return explicit
  return join(resolveDshHome(env), 'memory-core', 'memory.sqlite3')
}
