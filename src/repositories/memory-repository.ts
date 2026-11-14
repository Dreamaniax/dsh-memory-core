import type { DatabaseSync } from 'node:sqlite'
import type { SqliteStore } from '../storage/sqlite-store.js'
import type {
  ExtractionOrigin,
  MemoryStatus,
  MemoryType,
} from '../api/contracts.js'
import type { MemoryRow, MemoryVersionRow } from './rows.js'

export interface MemoryListQuery {
  namespaceId: string
  types?: MemoryType[]
  statuses?: MemoryStatus[]
  origins?: ExtractionOrigin[]
  sourceId?: string
  includeDeleted: boolean
  includeExpired: boolean
  limit: number
  offset: number
  orderBy: 'createdAt' | 'updatedAt'
  order: 'asc' | 'desc'
  nowMs: number
}

export interface MemoryListRows {
  rows: MemoryRow[]
  total: number
}

export interface MemoryVersionListQuery {
  namespaceId: string
  memoryId: string
  limit: number
  offset: number
}

export interface MemoryVersionListRows {
  rows: MemoryVersionRow[]
  total: number
}

export const MEMORY_COLUMNS = [
  'm.fts_rowid',
  'm.id',
  'm.namespace_id',
  'm.memory_type',
  'm.status',
  'm.extraction_origin',
  'm.title',
  'm.content',
  'm.tags_text',
  'm.confidence',
  'm.metadata_json',
  'm.version',
  'm.created_at',
  'm.updated_at',
  'm.expires_at',
  'm.confirmed_at',
  'm.deleted_at',
].join(', ')

export class MemoryRepository {
  private readonly db: DatabaseSync

  constructor(store: SqliteStore) {
    this.db = store.db
  }

  exists(namespaceId: string, id: string): boolean {
    const row = this.db.prepare(
      'SELECT 1 AS present FROM memory_items WHERE namespace_id = ? AND id = ? LIMIT 1',
    ).get(namespaceId, id) as { present?: number } | undefined
    return row?.present === 1
  }

  findById(namespaceId: string, id: string, includeDeleted = true): MemoryRow | undefined {
    const sql = includeDeleted
      ? 'SELECT ' + MEMORY_COLUMNS + ' FROM memory_items m WHERE m.namespace_id = ? AND m.id = ? LIMIT 1'
      : 'SELECT ' + MEMORY_COLUMNS + ' FROM memory_items m WHERE m.namespace_id = ? AND m.id = ? AND m.status <> \'deleted\' LIMIT 1'
    return this.db.prepare(sql).get(namespaceId, id) as MemoryRow | undefined
  }

  insert(row: MemoryRow): void {
    this.db.prepare(
      'INSERT INTO memory_items (' +
        'id, namespace_id, memory_type, status, extraction_origin, title, content, tags_text, ' +
        'confidence, metadata_json, version, created_at, updated_at, expires_at, confirmed_at, deleted_at' +
      ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      row.id,
      row.namespace_id,
      row.memory_type,
      row.status,
      row.extraction_origin,
      row.title,
      row.content,
      row.tags_text,
      row.confidence,
      row.metadata_json,
      row.version,
      row.created_at,
      row.updated_at,
      row.expires_at,
      row.confirmed_at,
      row.deleted_at,
    )
  }

  updateFields(row: MemoryRow, expectedVersion: number): boolean {
    const result = this.db.prepare(
      'UPDATE memory_items SET ' +
        'memory_type = ?, title = ?, content = ?, tags_text = ?, confidence = ?, metadata_json = ?, ' +
        'expires_at = ?, updated_at = ?, version = ? ' +
      'WHERE namespace_id = ? AND id = ? AND version = ?',
    ).run(
      row.memory_type,
      row.title,
      row.content,
      row.tags_text,
      row.confidence,
      row.metadata_json,
      row.expires_at,
      row.updated_at,
      row.version,
      row.namespace_id,
      row.id,
      expectedVersion,
    )
    return result.changes === 1
  }

  updateLifecycle(row: MemoryRow, expectedVersion: number): boolean {
    const result = this.db.prepare(
      'UPDATE memory_items SET status = ?, confirmed_at = ?, updated_at = ?, version = ? ' +
      'WHERE namespace_id = ? AND id = ? AND version = ? AND status <> \'deleted\'',
    ).run(
      row.status,
      row.confirmed_at,
      row.updated_at,
      row.version,
      row.namespace_id,
      row.id,
      expectedVersion,
    )
    return result.changes === 1
  }

  updateFromFeedback(row: MemoryRow, expectedVersion: number): boolean {
    const result = this.db.prepare(
      'UPDATE memory_items SET ' +
        'memory_type = ?, status = ?, extraction_origin = ?, title = ?, content = ?, tags_text = ?, ' +
        'confidence = ?, metadata_json = ?, expires_at = ?, confirmed_at = ?, updated_at = ?, version = ? ' +
      'WHERE namespace_id = ? AND id = ? AND version = ? AND status <> \'deleted\'',
    ).run(
      row.memory_type,
      row.status,
      row.extraction_origin,
      row.title,
      row.content,
      row.tags_text,
      row.confidence,
      row.metadata_json,
      row.expires_at,
      row.confirmed_at,
      row.updated_at,
      row.version,
      row.namespace_id,
      row.id,
      expectedVersion,
    )
    return result.changes === 1
  }

  softDelete(row: MemoryRow, expectedVersion: number): boolean {
    const result = this.db.prepare(
      'UPDATE memory_items SET status = \'deleted\', deleted_at = ?, updated_at = ?, version = ? ' +
      'WHERE namespace_id = ? AND id = ? AND version = ? AND status <> \'deleted\'',
    ).run(row.deleted_at, row.updated_at, row.version, row.namespace_id, row.id, expectedVersion)
    return result.changes === 1
  }

  purge(namespaceId: string, id: string, expectedVersion: number): boolean {
    const result = this.db.prepare(
      'DELETE FROM memory_items WHERE namespace_id = ? AND id = ? AND version = ?',
    ).run(namespaceId, id, expectedVersion)
    return result.changes === 1
  }

  list(query: MemoryListQuery): MemoryListRows {
    const where: string[] = ['m.namespace_id = ?']
    const params: Array<string | number | null> = [query.namespaceId]
    if (query.types !== undefined && query.types.length > 0) {
      where.push('m.memory_type IN (' + query.types.map(() => '?').join(', ') + ')')
      params.push(...query.types)
    }
    if (query.statuses !== undefined && query.statuses.length > 0) {
      where.push('m.status IN (' + query.statuses.map(() => '?').join(', ') + ')')
      params.push(...query.statuses)
    }
    if (query.origins !== undefined && query.origins.length > 0) {
      where.push('m.extraction_origin IN (' + query.origins.map(() => '?').join(', ') + ')')
      params.push(...query.origins)
    }
    if (!query.includeDeleted) {
      where.push('m.status <> \'deleted\'')
    }
    if (!query.includeExpired) {
      where.push('(m.expires_at IS NULL OR m.expires_at > ?)')
      params.push(query.nowMs)
    }
    if (query.sourceId !== undefined) {
      where.push(
        'EXISTS (SELECT 1 FROM memory_sources ms WHERE ms.namespace_id = m.namespace_id ' +
        'AND ms.memory_id = m.id AND ms.source_id = ?)',
      )
      params.push(query.sourceId)
    }
    const whereSql = where.join(' AND ')
    const countRow = this.db.prepare('SELECT COUNT(*) AS total FROM memory_items m WHERE ' + whereSql)
      .get(...params) as { total?: number } | undefined
    const total = countRow?.total ?? 0
    const orderColumn = query.orderBy === 'createdAt' ? 'm.created_at' : 'm.updated_at'
    const direction = query.order === 'asc' ? 'ASC' : 'DESC'
    const rows = this.db.prepare(
      'SELECT ' + MEMORY_COLUMNS + ' FROM memory_items m WHERE ' + whereSql +
      ' ORDER BY ' + orderColumn + ' ' + direction + ', m.id ' + direction +
      ' LIMIT ? OFFSET ?',
    ).all(...params, query.limit, query.offset) as unknown as MemoryRow[]
    return { rows, total }
  }

  insertVersion(row: MemoryVersionRow): void {
    this.db.prepare(
      'INSERT INTO memory_versions (' +
        'namespace_id, memory_id, version, snapshot_json, content_hash, ' +
        'change_type, change_reason, changed_by, created_at' +
      ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      row.namespace_id,
      row.memory_id,
      row.version,
      row.snapshot_json,
      row.content_hash,
      row.change_type,
      row.change_reason,
      row.changed_by,
      row.created_at,
    )
  }

  listVersions(query: MemoryVersionListQuery): MemoryVersionListRows {
    const countRow = this.db.prepare(
      'SELECT COUNT(*) AS total FROM memory_versions WHERE namespace_id = ? AND memory_id = ?',
    ).get(query.namespaceId, query.memoryId) as { total?: number } | undefined
    const total = countRow?.total ?? 0
    const rows = this.db.prepare(
      'SELECT namespace_id, memory_id, version, snapshot_json, content_hash, ' +
        'change_type, change_reason, changed_by, created_at ' +
      'FROM memory_versions WHERE namespace_id = ? AND memory_id = ? ' +
      'ORDER BY created_at DESC, version DESC LIMIT ? OFFSET ?',
    ).all(query.namespaceId, query.memoryId, query.limit, query.offset) as unknown as MemoryVersionRow[]
    return { rows, total }
  }
}
