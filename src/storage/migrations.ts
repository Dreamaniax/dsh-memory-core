import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { APPLICATION_ID, MIGRATIONS_TABLE } from './constants.js'
import { MemoryStorageError } from './sqlite-errors.js'

export interface MigrationFile {
  version: number
  name: string
  checksum: string
  sql: string
  filePath: string
}

export interface AppliedMigration {
  version: number
  name: string
  checksum: string
  appliedAt: number
}

export interface MigrationReport {
  fromVersion: number
  toVersion: number
  applied: AppliedMigration[]
  backupPath?: string
}

export interface MigrationOptions {
  db: DatabaseSync
  migrationsDir: string
  now: () => number
  transaction: <T>(fn: () => T) => T
  backupBeforeMigrate?: boolean
  backup?: (reason: string) => Promise<string | undefined>
}

const MIGRATION_FILE_RE = /^(\d+)_(.+)\.sql$/

export function readApplicationId(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA application_id').get() as { application_id?: number } | undefined
  return typeof row?.application_id === 'number' ? row.application_id : 0
}

export function readUserVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined
  return typeof row?.user_version === 'number' ? row.user_version : 0
}

export function listUserTables(db: DatabaseSync): string[] {
  const rows = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT GLOB 'sqlite_*' ORDER BY name",
  ).all() as Array<{ name: string }>
  return rows.map(row => row.name)
}

export function tableExists(db: DatabaseSync, name: string): boolean {
  const row = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
  ).get(name) as { name?: string } | undefined
  return row?.name === name
}

function checksum(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex')
}

export async function loadMigrations(migrationsDir: string): Promise<MigrationFile[]> {
  let names: string[]
  try {
    names = await readdir(migrationsDir)
  } catch (error) {
    throw new MemoryStorageError(
      'MIGRATION_FAILED',
      'cannot read migrations directory: ' + migrationsDir,
      { cause: error },
    )
  }

  const files: MigrationFile[] = []
  const seen = new Set<number>()
  for (const name of names.sort()) {
    const match = MIGRATION_FILE_RE.exec(name)
    if (!match) continue
    const version = Number(match[1])
    const label = match[2]
    if (label === undefined || label.length === 0) {
      throw new MemoryStorageError('MIGRATION_FAILED', 'invalid migration label in ' + name)
    }
    if (!Number.isSafeInteger(version) || version < 1) {
      throw new MemoryStorageError('MIGRATION_FAILED', 'invalid migration version in ' + name)
    }
    if (seen.has(version)) {
      throw new MemoryStorageError('MIGRATION_FAILED', 'duplicate migration version ' + version)
    }
    seen.add(version)
    const filePath = join(migrationsDir, name)
    const sql = await readFile(filePath, 'utf8')
    files.push({ version, name: label, checksum: checksum(sql), sql, filePath })
  }

  files.sort((a, b) => a.version - b.version)
  if (files.length === 0) {
    throw new MemoryStorageError('MIGRATION_FAILED', 'no migrations found in ' + migrationsDir)
  }
  for (let index = 0; index < files.length; index += 1) {
    const expected = index + 1
    if (files[index]?.version !== expected) {
      throw new MemoryStorageError(
        'MIGRATION_FAILED',
        'migration versions must be contiguous from 1; expected ' + expected,
      )
    }
  }
  return files
}

function ensureMigrationsTable(db: DatabaseSync): void {
  db.exec(
    'CREATE TABLE IF NOT EXISTS ' + MIGRATIONS_TABLE + ' (' +
      'version INTEGER PRIMARY KEY, ' +
      'name TEXT NOT NULL, ' +
      'checksum TEXT NOT NULL, ' +
      'applied_at INTEGER NOT NULL' +
    ') STRICT',
  )
}

function readAppliedMigrations(db: DatabaseSync): AppliedMigration[] {
  const rows = db.prepare(
    'SELECT version, name, checksum, applied_at FROM ' + MIGRATIONS_TABLE + ' ORDER BY version',
  ).all() as Array<{ version: number; name: string; checksum: string; applied_at: number }>
  return rows.map(row => ({
    version: row.version,
    name: row.name,
    checksum: row.checksum,
    appliedAt: row.applied_at,
  }))
}

function assertDatabaseIdentity(db: DatabaseSync): void {
  const applicationId = readApplicationId(db)
  const tables = listUserTables(db)
  if (applicationId !== 0 && applicationId !== APPLICATION_ID) {
    throw new MemoryStorageError(
      'MIGRATION_FAILED',
      'database belongs to another application (application_id=' + applicationId + ')',
    )
  }
  if (applicationId === 0 && tables.length > 0) {
    throw new MemoryStorageError(
      'MIGRATION_FAILED',
      'refusing to initialize a database that already has user tables but no DSH Memory Core application_id',
    )
  }
  if (applicationId === APPLICATION_ID && tables.length > 0 && !tableExists(db, MIGRATIONS_TABLE)) {
    throw new MemoryStorageError(
      'MIGRATION_FAILED',
      'database is marked as DSH Memory Core but has no schema_migrations table',
    )
  }
}

export async function migrateDatabase(options: MigrationOptions): Promise<MigrationReport> {
  const files = await loadMigrations(options.migrationsDir)
  const db = options.db
  assertDatabaseIdentity(db)
  ensureMigrationsTable(db)

  const applied = readAppliedMigrations(db)
  const byVersion = new Map(files.map(file => [file.version, file]))
  for (const row of applied) {
    const file = byVersion.get(row.version)
    if (file === undefined) {
      throw new MemoryStorageError(
        'MIGRATION_FAILED',
        'applied migration ' + row.version + ' has no matching file',
      )
    }
    if (file.checksum !== row.checksum) {
      throw new MemoryStorageError(
        'MIGRATION_FAILED',
        'checksum mismatch for applied migration ' + row.version,
      )
    }
  }

  const userVersion = readUserVersion(db)
  const maxFileVersion = files[files.length - 1]?.version ?? 0
  if (userVersion > maxFileVersion) {
    throw new MemoryStorageError(
      'MIGRATION_FAILED',
      'database schema version ' + userVersion + ' is newer than supported version ' + maxFileVersion,
    )
  }

  const appliedVersions = applied.map(row => row.version)
  for (let index = 0; index < appliedVersions.length; index += 1) {
    if (appliedVersions[index] !== index + 1) {
      throw new MemoryStorageError('MIGRATION_FAILED', 'applied migrations are not contiguous from 1')
    }
  }

  const currentVersion = Math.max(userVersion, appliedVersions[appliedVersions.length - 1] ?? 0)
  const pending = files.filter(file => file.version > currentVersion)

  let backupPath: string | undefined
  if (pending.length > 0 && applied.length > 0 && options.backupBeforeMigrate !== false && options.backup !== undefined) {
    backupPath = await options.backup('before-migration-v' + pending[0]?.version)
  }

  const newlyApplied: AppliedMigration[] = []
  for (const file of pending) {
    const appliedAt = options.now()
    try {
      options.transaction(() => {
        db.exec(file.sql)
        db.prepare(
          'INSERT INTO ' + MIGRATIONS_TABLE + ' (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
        ).run(file.version, file.name, file.checksum, appliedAt)
        db.exec('PRAGMA user_version = ' + file.version)
      })
    } catch (error) {
      throw new MemoryStorageError(
        'MIGRATION_FAILED',
        'migration ' + file.version + ' (' + file.name + ') failed',
        { cause: error, details: { version: file.version } },
      )
    }
    newlyApplied.push({
      version: file.version,
      name: file.name,
      checksum: file.checksum,
      appliedAt,
    })
  }

  const toVersion = pending[pending.length - 1]?.version ?? currentVersion
  return {
    fromVersion: currentVersion,
    toVersion,
    applied: newlyApplied,
    ...(backupPath === undefined ? {} : { backupPath }),
  }
}
