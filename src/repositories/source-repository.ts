import type { DatabaseSync } from 'node:sqlite'
import type { SqliteStore } from '../storage/sqlite-store.js'
import type { SourceRelation, SourceType } from '../api/contracts.js'
import type { SourceRow, SourceRowWithRelation } from './rows.js'

export class SourceRepository {
  private readonly db: DatabaseSync

  constructor(store: SqliteStore) {
    this.db = store.db
  }

  findById(namespaceId: string, id: string): SourceRow | undefined {
    return this.db.prepare(
      'SELECT id, namespace_id, source_type, external_ref, title, metadata_json, auto_created, created_at ' +
      'FROM sources WHERE namespace_id = ? AND id = ? LIMIT 1',
    ).get(namespaceId, id) as SourceRow | undefined
  }

  findByExternalRef(namespaceId: string, type: SourceType, externalRef: string): SourceRow | undefined {
    return this.db.prepare(
      'SELECT id, namespace_id, source_type, external_ref, title, metadata_json, auto_created, created_at ' +
      'FROM sources WHERE namespace_id = ? AND source_type = ? AND external_ref = ? LIMIT 1',
    ).get(namespaceId, type, externalRef) as SourceRow | undefined
  }

  insert(row: SourceRow): void {
    this.db.prepare(
      'INSERT INTO sources (' +
        'id, namespace_id, source_type, external_ref, title, metadata_json, auto_created, created_at' +
      ') VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      row.id,
      row.namespace_id,
      row.source_type,
      row.external_ref,
      row.title,
      row.metadata_json,
      row.auto_created,
      row.created_at,
    )
  }

  link(
    namespaceId: string,
    memoryId: string,
    sourceId: string,
    relation: SourceRelation,
    nowMs: number,
  ): number {
    const result = this.db.prepare(
      'INSERT OR IGNORE INTO memory_sources (namespace_id, memory_id, source_id, relation, created_at) ' +
      'VALUES (?, ?, ?, ?, ?)',
    ).run(namespaceId, memoryId, sourceId, relation, nowMs)
    return Number(result.changes)
  }

  findRelation(namespaceId: string, memoryId: string, sourceId: string): SourceRelation | undefined {
    const row = this.db.prepare(
      'SELECT relation FROM memory_sources WHERE namespace_id = ? AND memory_id = ? AND source_id = ? LIMIT 1',
    ).get(namespaceId, memoryId, sourceId) as { relation?: SourceRelation } | undefined
    return row?.relation
  }

  listForMemory(namespaceId: string, memoryId: string): SourceRowWithRelation[] {
    return this.db.prepare(
      'SELECT s.id, s.namespace_id, s.source_type, s.external_ref, s.title, s.metadata_json, ' +
        's.auto_created, s.created_at, ms.relation ' +
      'FROM memory_sources ms ' +
      'JOIN sources s ON s.namespace_id = ms.namespace_id AND s.id = ms.source_id ' +
      'WHERE ms.namespace_id = ? AND ms.memory_id = ? ' +
      'ORDER BY ms.created_at ASC, s.id ASC',
    ).all(namespaceId, memoryId) as unknown as SourceRowWithRelation[]
  }

  sourceIdsForMemory(namespaceId: string, memoryId: string): string[] {
    const rows = this.db.prepare(
      'SELECT source_id FROM memory_sources WHERE namespace_id = ? AND memory_id = ?',
    ).all(namespaceId, memoryId) as Array<{ source_id: string }>
    return rows.map(row => row.source_id)
  }

  deleteOrphanedAutoCreated(namespaceId: string, sourceIds: string[]): number {
    const stmt = this.db.prepare(
      'DELETE FROM sources WHERE namespace_id = ? AND id = ? AND auto_created = 1 ' +
      'AND NOT EXISTS (' +
        'SELECT 1 FROM memory_sources ms WHERE ms.namespace_id = sources.namespace_id AND ms.source_id = sources.id' +
      ')',
    )
    let deleted = 0
    for (const sourceId of sourceIds) {
      const result = stmt.run(namespaceId, sourceId)
      deleted += Number(result.changes)
    }
    return deleted
  }
}
