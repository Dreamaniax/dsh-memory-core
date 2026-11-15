import type {
  CreateSourceInput,
  Source,
  SourceRelation,
  SourceType,
} from '../api/contracts.js'
import type { SourceRow } from '../repositories/rows.js'
import { rowToSource, serializeMetadata } from '../repositories/rows.js'
import type { SourceRepository } from '../repositories/source-repository.js'
import { newId } from '../utils/ids.js'

export interface NormalizedSourceInput {
  type: SourceType
  externalRef: string | null
  title: string
  metadata: Record<string, unknown>
  relation: SourceRelation
}

export interface AttachedSource {
  row: SourceRow
  relation: SourceRelation
}

export class SourceService {
  private readonly repository: SourceRepository

  constructor(repository: SourceRepository) {
    this.repository = repository
  }

  normalize(input: CreateSourceInput): NormalizedSourceInput {
    return {
      type: input.type,
      externalRef: input.externalRef ?? null,
      title: input.title ?? '',
      metadata: input.metadata ?? {},
      relation: input.relation ?? 'origin',
    }
  }

  ensureSource(
    namespaceId: string,
    input: NormalizedSourceInput,
    nowMs: number,
    autoCreated: boolean,
  ): SourceRow {
    if (input.externalRef !== null) {
      const existing = this.repository.findByExternalRef(namespaceId, input.type, input.externalRef)
      if (existing !== undefined) return existing
    }
    const row: SourceRow = {
      id: newId(),
      namespace_id: namespaceId,
      source_type: input.type,
      external_ref: input.externalRef,
      title: input.title,
      metadata_json: serializeMetadata(input.metadata),
      auto_created: autoCreated ? 1 : 0,
      created_at: nowMs,
    }
    this.repository.insert(row)
    return row
  }

  attachForCreate(
    namespaceId: string,
    memoryId: string,
    input: CreateSourceInput,
    nowMs: number,
  ): AttachedSource {
    const normalized = this.normalize(input)
    const row = this.ensureSource(namespaceId, normalized, nowMs, true)
    this.repository.link(namespaceId, memoryId, row.id, normalized.relation, nowMs)
    return { row, relation: normalized.relation }
  }

  addSource(
    namespaceId: string,
    memoryId: string,
    input: CreateSourceInput,
    nowMs: number,
  ): AttachedSource {
    const normalized = this.normalize(input)
    const row = this.ensureSource(namespaceId, normalized, nowMs, false)
    const existingRelation = this.repository.findRelation(namespaceId, memoryId, row.id)
    if (existingRelation !== undefined) {
      return { row, relation: existingRelation }
    }
    this.repository.link(namespaceId, memoryId, row.id, normalized.relation, nowMs)
    return { row, relation: normalized.relation }
  }

  list(namespaceId: string, memoryId: string): Source[] {
    return this.repository.listForMemory(namespaceId, memoryId)
      .map(row => rowToSource(row, row.relation))
  }

  sourceIdsForMemory(namespaceId: string, memoryId: string): string[] {
    return this.repository.sourceIdsForMemory(namespaceId, memoryId)
  }

  cleanupOrphans(namespaceId: string, sourceIds: string[]): number {
    return this.repository.deleteOrphanedAutoCreated(namespaceId, sourceIds)
  }
}
