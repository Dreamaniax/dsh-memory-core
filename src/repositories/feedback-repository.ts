import type { DatabaseSync } from 'node:sqlite'
import type { SqliteStore } from '../storage/sqlite-store.js'
import type { FeedbackRow } from './rows.js'

const FEEDBACK_COLUMNS = [
  'id',
  'namespace_id',
  'memory_id',
  'action',
  'request_id',
  'request_hash',
  'expected_version',
  'applied_version',
  'comment',
  'patch_json',
  'metadata_json',
  'actor',
  'created_at',
].join(', ')

export interface FeedbackListQuery {
  namespaceId: string
  memoryId: string
  limit: number
  offset: number
}

export interface FeedbackListResult {
  rows: FeedbackRow[]
  total: number
}

export class FeedbackRepository {
  private readonly db: DatabaseSync

  constructor(store: SqliteStore) {
    this.db = store.db
  }

  findByRequestId(namespaceId: string, requestId: string): FeedbackRow | undefined {
    return this.db.prepare(
      'SELECT ' + FEEDBACK_COLUMNS +
      ' FROM memory_feedback WHERE namespace_id = ? AND request_id = ?',
    ).get(namespaceId, requestId) as FeedbackRow | undefined
  }

  insert(row: FeedbackRow): void {
    this.db.prepare(
      'INSERT INTO memory_feedback (' + FEEDBACK_COLUMNS + ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      row.id,
      row.namespace_id,
      row.memory_id,
      row.action,
      row.request_id,
      row.request_hash,
      row.expected_version,
      row.applied_version,
      row.comment,
      row.patch_json,
      row.metadata_json,
      row.actor,
      row.created_at,
    )
  }

  listForMemory(query: FeedbackListQuery): FeedbackListResult {
    const countRow = this.db.prepare(
      'SELECT COUNT(*) AS total FROM memory_feedback WHERE namespace_id = ? AND memory_id = ?',
    ).get(query.namespaceId, query.memoryId) as { total?: number } | undefined
    const rows = this.db.prepare(
      'SELECT ' + FEEDBACK_COLUMNS +
      ' FROM memory_feedback WHERE namespace_id = ? AND memory_id = ?' +
      ' ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?',
    ).all(query.namespaceId, query.memoryId, query.limit, query.offset) as unknown as FeedbackRow[]
    return { rows, total: Number(countRow?.total ?? 0) }
  }
}
