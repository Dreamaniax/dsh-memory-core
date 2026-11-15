import { randomUUID } from 'node:crypto'
import { readdir, rename, rm, unlink } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync, backup } from 'node:sqlite'
import { systemClock, type Clock } from '../utils/clock.js'
import { chmodPrivate, ensurePrivateDirectory, ensurePrivateFile, fileSize } from '../utils/fs.js'
import {
  APPLICATION_ID,
  DEFAULT_BACKUP_RETENTION,
  DEFAULT_BUSY_TIMEOUT_MS,
  DEFAULT_JOURNAL_MODE,
  DEFAULT_SYNCHRONOUS,
} from './constants.js'
import {
  migrateDatabase,
  readApplicationId,
  readUserVersion,
  type MigrationReport,
} from './migrations.js'
import {
  MemoryStorageError,
  isSqliteBusy,
  translateStorageError,
} from './sqlite-errors.js'

export type JournalMode = 'wal' | 'delete' | 'truncate' | 'persist'
export type SynchronousMode = 'NORMAL' | 'FULL'

export interface OpenSqliteStoreOptions {
  path: string
  journalMode?: JournalMode
  busyTimeoutMs?: number
  synchronous?: SynchronousMode
  migrationsDir?: string
  backupBeforeMigrate?: boolean
  backupDir?: string
  clock?: Clock
}

export interface BackupResult {
  path: string
  bytes: number
  integrity: 'ok'
  createdAt: string
}

export interface HealthReport {
  ok: boolean
  schemaVersion: number
  applicationId: number
  journalMode: string
  foreignKeys: boolean
  integrityCheck: string
  foreignKeyViolations: number
  ftsIntegrityCheck: 'ok' | 'error'
  checkedAt: string
}

const DEFAULT_MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url))
const BUSY_RETRY_DELAYS_MS = [25, 50, 100] as const

function normalizeJournalMode(value: JournalMode | undefined): JournalMode {
  if (value === undefined) return DEFAULT_JOURNAL_MODE
  if (value === 'wal' || value === 'delete' || value === 'truncate' || value === 'persist') return value
  throw new MemoryStorageError('STORAGE_ERROR', 'invalid journal mode')
}

function normalizeSynchronous(value: SynchronousMode | undefined): SynchronousMode {
  if (value === undefined) return DEFAULT_SYNCHRONOUS
  if (value === 'NORMAL' || value === 'FULL') return value
  throw new MemoryStorageError('STORAGE_ERROR', 'invalid synchronous mode')
}

function normalizeBusyTimeout(value: number | undefined): number {
  if (value === undefined) return DEFAULT_BUSY_TIMEOUT_MS
  if (!Number.isInteger(value) || value < 0 || value > 60000) {
    throw new MemoryStorageError('STORAGE_ERROR', 'busyTimeoutMs must be an integer between 0 and 60000')
  }
  return value
}

function sleepSync(ms: number): void {
  const lock = new Int32Array(new SharedArrayBuffer(4))
  Atomics.wait(lock, 0, 0, ms)
}

export class SqliteStore {
  readonly db: DatabaseSync
  readonly path: string
  readonly journalMode: string
  readonly foreignKeys: boolean
  private readonly clock: Clock
  private readonly inMemory: boolean
  private closed = false
  private inTransaction = false
  private migrationReport: MigrationReport = { fromVersion: 0, toVersion: 0, applied: [] }

  private constructor(
    db: DatabaseSync,
    path: string,
    journalMode: string,
    foreignKeys: boolean,
    clock: Clock,
  ) {
    this.db = db
    this.path = path
    this.journalMode = journalMode
    this.foreignKeys = foreignKeys
    this.clock = clock
    this.inMemory = path === ':memory:'
  }

  static async open(options: OpenSqliteStoreOptions): Promise<SqliteStore> {
    if (typeof options.path !== 'string' || options.path.length === 0) {
      throw new MemoryStorageError('STORAGE_ERROR', 'path must be a non-empty string')
    }
    const inMemory = options.path === ':memory:'
    const path = inMemory ? options.path : resolve(options.path)
    const journalMode = normalizeJournalMode(options.journalMode)
    const busyTimeoutMs = normalizeBusyTimeout(options.busyTimeoutMs)
    const synchronous = normalizeSynchronous(options.synchronous)
    const clock = options.clock ?? systemClock

    if (!inMemory) {
      await ensurePrivateDirectory(dirname(path))
      await ensurePrivateFile(path)
    }

    let db: DatabaseSync | undefined
    try {
      db = new DatabaseSync(path)
      db.exec('PRAGMA foreign_keys = ON')
      db.exec('PRAGMA busy_timeout = ' + busyTimeoutMs)
      const journal = db.prepare('PRAGMA journal_mode = ' + journalMode).get() as {
        journal_mode?: string
      } | undefined
      db.exec('PRAGMA synchronous = ' + synchronous)
      const foreignKeys = db.prepare('PRAGMA foreign_keys').get() as {
        foreign_keys?: number
      } | undefined
      const store = new SqliteStore(
        db,
        path,
        journal?.journal_mode ?? journalMode,
        foreignKeys?.foreign_keys === 1,
        clock,
      )
      store.migrationReport = await migrateDatabase({
        db,
        migrationsDir: options.migrationsDir ?? DEFAULT_MIGRATIONS_DIR,
        now: () => clock.now(),
        transaction: <T>(fn: () => T): T => store.transaction(fn),
        backupBeforeMigrate: options.backupBeforeMigrate ?? true,
        backup: async reason => store.createMigrationBackup(reason, options.backupDir),
      })
      const applicationId = readApplicationId(db)
      if (applicationId === 0) {
        db.exec('PRAGMA application_id = ' + APPLICATION_ID)
      } else if (applicationId !== APPLICATION_ID) {
        throw new MemoryStorageError(
          'MIGRATION_FAILED',
          'database belongs to another application (application_id=' + applicationId + ')',
        )
      }
      return store
    } catch (error) {
      try {
        db?.close()
      } catch {
        // Preserve the original failure.
      }
      throw translateStorageError(error, 'opening SQLite store')
    }
  }

  get migrations(): MigrationReport {
    return this.migrationReport
  }

  transaction<T>(fn: () => T): T {
    this.assertOpen()
    if (this.inTransaction) {
      throw new MemoryStorageError('STORAGE_ERROR', 'nested transactions are not supported')
    }
    for (let attempt = 0; attempt <= BUSY_RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        this.db.exec('BEGIN IMMEDIATE')
      } catch (error) {
        if (isSqliteBusy(error) && attempt < BUSY_RETRY_DELAYS_MS.length) {
          sleepSync(BUSY_RETRY_DELAYS_MS[attempt] ?? 100)
          continue
        }
        throw translateStorageError(error, 'begin transaction')
      }
      this.inTransaction = true
      try {
        const result = fn()
        this.db.exec('COMMIT')
        return result
      } catch (error) {
        try {
          this.db.exec('ROLLBACK')
        } catch {
          // The original failure remains actionable.
        }
        throw error
      } finally {
        this.inTransaction = false
      }
    }
    throw new MemoryStorageError('STORAGE_BUSY', 'could not begin transaction after retries')
  }

  async backupTo(targetPath: string): Promise<BackupResult> {
    this.assertOpen()
    if (typeof targetPath !== 'string' || targetPath.length === 0) {
      throw new MemoryStorageError('STORAGE_ERROR', 'backup path must be a non-empty string')
    }
    const target = resolve(targetPath)
    if (!this.inMemory && target === this.path) {
      throw new MemoryStorageError('STORAGE_ERROR', 'backup target must differ from the live database path')
    }
    await ensurePrivateDirectory(dirname(target))
    const temporary = target + '.tmp-' + randomUUID()
    try {
      await backup(this.db, temporary)
      await chmodPrivate(temporary)
      const copy = new DatabaseSync(temporary)
      try {
        const integrity = copy.prepare('PRAGMA integrity_check').get() as {
          integrity_check?: string
        } | undefined
        if (integrity?.integrity_check !== 'ok') {
          throw new MemoryStorageError('CORRUPT_DATABASE', 'backup integrity_check failed')
        }
      } finally {
        copy.close()
      }
      try {
        await rename(temporary, target)
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'EEXIST' && code !== 'EPERM' && code !== 'EACCES') throw error
        await rm(target, { force: true })
        await rename(temporary, target)
      }
      const bytes = await fileSize(target)
      return {
        path: target,
        bytes,
        integrity: 'ok',
        createdAt: new Date(this.clock.now()).toISOString(),
      }
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined)
      throw translateStorageError(error, 'creating backup')
    }
  }

  async healthCheck(): Promise<HealthReport> {
    this.assertOpen()
    const integrity = this.db.prepare('PRAGMA integrity_check').get() as {
      integrity_check?: string
    } | undefined
    const violations = this.db.prepare('PRAGMA foreign_key_check').all() as unknown[]
    let ftsIntegrityCheck: 'ok' | 'error' = 'ok'
    try {
      this.db.prepare("INSERT INTO memory_fts(memory_fts) VALUES('integrity-check')").run()
    } catch {
      ftsIntegrityCheck = 'error'
    }
    const journal = this.db.prepare('PRAGMA journal_mode').get() as {
      journal_mode?: string
    } | undefined
    const foreignKeys = this.db.prepare('PRAGMA foreign_keys').get() as {
      foreign_keys?: number
    } | undefined
    const integrityCheck = integrity?.integrity_check ?? 'unknown'
    return {
      ok: integrityCheck === 'ok' && violations.length === 0 && ftsIntegrityCheck === 'ok',
      schemaVersion: readUserVersion(this.db),
      applicationId: readApplicationId(this.db),
      journalMode: journal?.journal_mode ?? this.journalMode,
      foreignKeys: foreignKeys?.foreign_keys === 1,
      integrityCheck,
      foreignKeyViolations: violations.length,
      ftsIntegrityCheck,
      checkedAt: new Date(this.clock.now()).toISOString(),
    }
  }

  async close(): Promise<void> {
    if (this.closed) return
    if (this.inTransaction) {
      throw new MemoryStorageError('STORAGE_ERROR', 'cannot close while a transaction is active')
    }
    this.closed = true
    this.db.close()
  }

  private assertOpen(): void {
    if (this.closed) throw new MemoryStorageError('CLOSED', 'SQLite store is closed')
  }

  private async createMigrationBackup(reason: string, backupDir?: string): Promise<string | undefined> {
    if (this.inMemory) return undefined
    const directory = backupDir ?? dirname(this.path)
    await ensurePrivateDirectory(directory)
    const stamp = new Date(this.clock.now()).toISOString().replace(/[:.]/g, '-')
    const target = join(directory, basename(this.path) + '.bak-' + stamp)
    const result = await this.backupTo(target)
    await this.pruneBackups(directory, basename(this.path))
    return result.path
  }

  private async pruneBackups(directory: string, baseName: string): Promise<void> {
    const prefix = baseName + '.bak-'
    let entries: string[]
    try {
      entries = await readdir(directory)
    } catch {
      return
    }
    const backups = entries.filter(name => name.startsWith(prefix)).sort()
    const remove = backups.slice(0, Math.max(0, backups.length - DEFAULT_BACKUP_RETENTION))
    for (const name of remove) {
      await unlink(join(directory, name)).catch(() => undefined)
    }
  }
}

export async function openSqliteStore(options: OpenSqliteStoreOptions): Promise<SqliteStore> {
  return SqliteStore.open(options)
}
