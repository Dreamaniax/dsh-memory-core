import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  MemoryStorageError,
  openSqliteStore,
} from '../../lib/index.js'
import { makeTempDir } from '../helpers/temp-dir.mjs'

const V1 = 'CREATE TABLE demo (id TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL) STRICT;\n'
const V2 = 'CREATE TABLE demo2 (id TEXT PRIMARY KEY NOT NULL) STRICT;\n'

async function migrationDir() {
  const temp = await makeTempDir('dsh-memory-migrations-')
  const dir = join(temp.dir, 'migrations')
  await mkdir(dir, { recursive: true })
  return { temp, dir }
}

async function writeMigration(dir, name, sql) {
  await writeFile(join(dir, name), sql, 'utf8')
}

test('applies contiguous migrations and records user_version', async () => {
  const { temp, dir } = await migrationDir()
  const dbPath = join(temp.dir, 'memory.db')
  try {
    await writeMigration(dir, '001_init.sql', V1)
    await writeMigration(dir, '002_more.sql', V2)
    const store = await openSqliteStore({ path: dbPath, migrationsDir: dir })
    try {
      assert.equal(store.migrations.toVersion, 2)
      assert.equal(store.migrations.applied.length, 2)
      assert.equal(store.db.prepare('PRAGMA user_version').get().user_version, 2)
      const tables = store.db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'demo%' ORDER BY name",
      ).all().map(row => row.name)
      assert.deepEqual(tables, ['demo', 'demo2'])
      assert.equal(store.db.prepare('PRAGMA application_id').get().application_id, 0x44534D43)
    } finally {
      await store.close()
    }
  } finally {
    await temp.cleanup()
  }
})

test('rejects a changed checksum for an applied migration', async () => {
  const { temp, dir } = await migrationDir()
  const dbPath = join(temp.dir, 'memory.db')
  try {
    await writeMigration(dir, '001_init.sql', V1)
    const first = await openSqliteStore({ path: dbPath, migrationsDir: dir })
    await first.close()

    await writeMigration(dir, '001_init.sql', V1 + '-- changed after apply\n')
    await assert.rejects(
      () => openSqliteStore({ path: dbPath, migrationsDir: dir }),
      (error) => error instanceof MemoryStorageError && error.code === 'MIGRATION_FAILED',
    )
  } finally {
    await temp.cleanup()
  }
})

test('rolls back a failed migration and leaves the prior version', async () => {
  const { temp, dir } = await migrationDir()
  const dbPath = join(temp.dir, 'memory.db')
  try {
    await writeMigration(dir, '001_init.sql', V1)
    await writeMigration(dir, '002_broken.sql', 'CREATE TABLE broken (;\n')
    await assert.rejects(
      () => openSqliteStore({ path: dbPath, migrationsDir: dir }),
      (error) => error instanceof MemoryStorageError && error.code === 'MIGRATION_FAILED',
    )

    const db = new DatabaseSync(dbPath)
    try {
      assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1)
      const applied = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all()
      assert.deepEqual(applied.map(row => row.version), [1])
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'demo%' ORDER BY name",
      ).all().map(row => row.name)
      assert.deepEqual(tables, ['demo'])
    } finally {
      db.close()
    }
  } finally {
    await temp.cleanup()
  }
})

test('rejects a database whose schema version is newer than supported', async () => {
  const { temp, dir } = await migrationDir()
  const dbPath = join(temp.dir, 'memory.db')
  try {
    await writeMigration(dir, '001_init.sql', V1)
    const first = await openSqliteStore({ path: dbPath, migrationsDir: dir })
    await first.close()

    const db = new DatabaseSync(dbPath)
    try {
      db.exec('PRAGMA user_version = 99')
    } finally {
      db.close()
    }

    await assert.rejects(
      () => openSqliteStore({ path: dbPath, migrationsDir: dir }),
      (error) => error instanceof MemoryStorageError && error.code === 'MIGRATION_FAILED',
    )
  } finally {
    await temp.cleanup()
  }
})

test('rejects a database with a foreign application_id', async () => {
  const { temp, dir } = await migrationDir()
  const dbPath = join(temp.dir, 'memory.db')
  try {
    await writeMigration(dir, '001_init.sql', V1)
    const db = new DatabaseSync(dbPath)
    try {
      db.exec('PRAGMA application_id = 123')
    } finally {
      db.close()
    }

    await assert.rejects(
      () => openSqliteStore({ path: dbPath, migrationsDir: dir }),
      (error) => error instanceof MemoryStorageError && error.code === 'MIGRATION_FAILED',
    )
  } finally {
    await temp.cleanup()
  }
})

test('backs up the existing database before applying a pending migration', async () => {
  const { temp, dir } = await migrationDir()
  const dbPath = join(temp.dir, 'memory.db')
  try {
    await writeMigration(dir, '001_init.sql', V1)
    const first = await openSqliteStore({ path: dbPath, migrationsDir: dir })
    await first.close()

    await writeMigration(dir, '002_more.sql', V2)
    const second = await openSqliteStore({ path: dbPath, migrationsDir: dir })
    try {
      assert.ok(second.migrations.backupPath, 'expected a migration backup path')
      assert.equal(existsSync(second.migrations.backupPath), true)
      assert.equal(second.migrations.toVersion, 2)
      assert.ok(second.migrations.backupPath.includes('.bak-'))
    } finally {
      await second.close()
    }
  } finally {
    await temp.cleanup()
  }
})
