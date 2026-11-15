import type {
  Memory,
  MemoryVersion,
  Page,
  Source,
} from '../api/contracts.js'
import type {
  ValidatedAddSourceInput,
  ValidatedCreateMemoryInput,
  ValidatedDeleteMemoryInput,
  ValidatedGetMemoryInput,
  ValidatedGetMemoryVersionsInput,
  ValidatedGetSourcesInput,
  ValidatedListMemoriesInput,
  ValidatedPurgeMemoryInput,
  ValidatedUpdateMemoryInput,
} from '../api/validation.js'
import {
  confirmationRequired,
  duplicateId,
  invalidArgument,
  memoryDeleted,
  notFound,
  versionConflict,
} from '../api/errors.js'
import type { MemoryRepository } from '../repositories/memory-repository.js'
import type { MemoryRow } from '../repositories/rows.js'
import {
  rowToMemory,
  rowToMemoryVersion,
  rowToSource,
  serializeMetadata,
  serializeTags,
} from '../repositories/rows.js'
import type { SourceService } from './source-service.js'
import type { SqliteStore } from '../storage/sqlite-store.js'
import { isUniqueConstraint } from '../storage/sqlite-errors.js'
import type { Clock } from '../utils/clock.js'
import { systemClock } from '../utils/clock.js'
import { newId } from '../utils/ids.js'
import { writeMemoryVersion } from './version-writer.js'

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function pageOf<T>(items: T[], total: number, limit: number, offset: number): Page<T> {
  return {
    items,
    limit,
    offset,
    total,
    hasMore: offset + items.length < total,
  }
}

export class MemoryManager {
  private readonly store: SqliteStore
  private readonly memories: MemoryRepository
  private readonly sources: SourceService
  private readonly clock: Clock

  constructor(
    store: SqliteStore,
    memories: MemoryRepository,
    sources: SourceService,
    clock: Clock = systemClock,
  ) {
    this.store = store
    this.memories = memories
    this.sources = sources
    this.clock = clock
  }

  createMemory(input: ValidatedCreateMemoryInput): Memory {
    const now = this.clock.now()
    const expiresAt = this.parseExpiresAt(input.expiresAt)
    if (expiresAt !== null && expiresAt <= now) {
      throw invalidArgument('expiresAt', 'must be after createdAt')
    }
    if (input.type === 'working' && expiresAt === null) {
      throw invalidArgument('expiresAt', 'is required for working memory')
    }
    const id = (input.id ?? newId()).toLowerCase()
    const row: MemoryRow = {
      fts_rowid: 0,
      id,
      namespace_id: input.namespaceId,
      memory_type: input.type,
      status: input.status,
      extraction_origin: input.origin,
      title: input.title,
      content: input.content,
      tags_text: serializeTags(input.tags),
      confidence: input.confidence,
      metadata_json: serializeMetadata(input.metadata),
      version: 1,
      created_at: now,
      updated_at: now,
      expires_at: expiresAt,
      confirmed_at: input.status === 'active' ? now : null,
      deleted_at: null,
    }

    return this.store.transaction(() => {
      if (this.memories.exists(input.namespaceId, id)) {
        throw duplicateId()
      }
      try {
        this.memories.insert(row)
      } catch (error) {
        if (isUniqueConstraint(error, 'memory_items')) throw duplicateId()
        throw error
      }
      const memory = rowToMemory(row, now)
      writeMemoryVersion(this.memories, memory, 'create', null, null, now)
      for (const sourceInput of input.sources) {
        this.sources.attachForCreate(input.namespaceId, id, sourceInput, now)
      }
      return memory
    })
  }

  getMemory(input: ValidatedGetMemoryInput): Memory | null {
    const row = this.memories.findById(input.namespaceId, input.memoryId, input.includeDeleted)
    return row === undefined ? null : rowToMemory(row, this.clock.now())
  }

  listMemories(input: ValidatedListMemoriesInput): Page<Memory> {
    const now = this.clock.now()
    const statuses = input.statuses ?? ['active']
    const result = this.memories.list({
      namespaceId: input.namespaceId,
      ...(input.types === undefined ? {} : { types: input.types }),
      statuses,
      ...(input.origins === undefined ? {} : { origins: input.origins }),
      ...(input.sourceId === undefined ? {} : { sourceId: input.sourceId }),
      includeDeleted: input.includeDeleted,
      includeExpired: input.includeExpired,
      limit: input.limit,
      offset: input.offset,
      orderBy: input.orderBy,
      order: input.order,
      nowMs: now,
    })
    return pageOf(result.rows.map(row => rowToMemory(row, now)), result.total, input.limit, input.offset)
  }

  updateMemory(input: ValidatedUpdateMemoryInput): Memory {
    const now = this.clock.now()
    return this.store.transaction(() => {
      const row = this.memories.findById(input.namespaceId, input.memoryId, true)
      if (row === undefined) throw notFound()
      if (row.status === 'deleted') throw memoryDeleted()
      if (row.version !== input.expectedVersion) {
        throw versionConflict(input.expectedVersion, row.version)
      }

      const current = rowToMemory(row, now)
      const patch = input.patch
      const type = patch.type ?? row.memory_type
      const title = patch.title ?? row.title
      const memoryContent = patch.content ?? row.content
      const tags = patch.tags ?? current.tags
      const confidence = hasOwn(patch, 'confidence') ? patch.confidence ?? null : row.confidence
      const metadata = patch.metadata ?? current.metadata
      const expiresAt = hasOwn(patch, 'expiresAt')
        ? this.parseExpiresAt(patch.expiresAt ?? null)
        : row.expires_at

      if (type === 'working' && expiresAt === null) {
        throw invalidArgument('expiresAt', 'is required for working memory')
      }
      if (expiresAt !== null && expiresAt <= row.created_at) {
        throw invalidArgument('expiresAt', 'must be after createdAt')
      }

      const tagsText = serializeTags(tags)
      const metadataJson = serializeMetadata(metadata)
      const changed = type !== row.memory_type ||
        title !== row.title ||
        memoryContent !== row.content ||
        tagsText !== row.tags_text ||
        confidence !== row.confidence ||
        metadataJson !== row.metadata_json ||
        expiresAt !== row.expires_at
      if (!changed) return current

      const updatedAt = Math.max(now, row.updated_at)
      const nextRow: MemoryRow = {
        ...row,
        memory_type: type,
        title,
        content: memoryContent,
        tags_text: tagsText,
        confidence,
        metadata_json: metadataJson,
        expires_at: expiresAt,
        updated_at: updatedAt,
        version: row.version + 1,
      }
      if (!this.memories.updateFields(nextRow, row.version)) {
        const latest = this.memories.findById(input.namespaceId, input.memoryId, true)
        throw versionConflict(row.version, latest?.version ?? row.version + 1)
      }
      const memory = rowToMemory(nextRow, now)
      writeMemoryVersion(this.memories, memory, 'update', input.changeReason ?? null, input.changedBy ?? null, now)
      return memory
    })
  }

  deleteMemory(input: ValidatedDeleteMemoryInput): void {
    const now = this.clock.now()
    this.store.transaction(() => {
      const row = this.memories.findById(input.namespaceId, input.memoryId, true)
      if (row === undefined) throw notFound()
      if (row.status === 'deleted') throw memoryDeleted()
      if (row.version !== input.expectedVersion) {
        throw versionConflict(input.expectedVersion, row.version)
      }
      const updatedAt = Math.max(now, row.updated_at)
      const nextRow: MemoryRow = {
        ...row,
        status: 'deleted',
        updated_at: updatedAt,
        deleted_at: now,
        version: row.version + 1,
      }
      if (!this.memories.softDelete(nextRow, row.version)) {
        const latest = this.memories.findById(input.namespaceId, input.memoryId, true)
        throw versionConflict(row.version, latest?.version ?? row.version + 1)
      }
      writeMemoryVersion(this.memories, rowToMemory(nextRow, now), 'delete', input.reason ?? null, null, now)
    })
  }

  purgeMemory(input: ValidatedPurgeMemoryInput): void {
    const expectedToken = 'PURGE:' + input.namespaceId + ':' + input.memoryId
    if (input.confirmationToken !== expectedToken) {
      throw confirmationRequired()
    }
    this.store.transaction(() => {
      const row = this.memories.findById(input.namespaceId, input.memoryId, true)
      if (row === undefined) throw notFound()
      if (row.version !== input.expectedVersion) {
        throw versionConflict(input.expectedVersion, row.version)
      }
      const sourceIds = this.sources.sourceIdsForMemory(input.namespaceId, input.memoryId)
      if (!this.memories.purge(input.namespaceId, input.memoryId, input.expectedVersion)) {
        const latest = this.memories.findById(input.namespaceId, input.memoryId, true)
        throw versionConflict(input.expectedVersion, latest?.version ?? input.expectedVersion + 1)
      }
      this.sources.cleanupOrphans(input.namespaceId, sourceIds)
    })
  }

  addSource(input: ValidatedAddSourceInput): Source {
    const now = this.clock.now()
    return this.store.transaction(() => {
      const row = this.memories.findById(input.namespaceId, input.memoryId, true)
      if (row === undefined) throw notFound()
      if (row.status === 'deleted') throw memoryDeleted()
      const attached = this.sources.addSource(input.namespaceId, input.memoryId, input.source, now)
      return rowToSource(attached.row, attached.relation)
    })
  }

  getSources(input: ValidatedGetSourcesInput): Source[] {
    const row = this.memories.findById(input.namespaceId, input.memoryId, true)
    if (row === undefined) throw notFound()
    return this.sources.list(input.namespaceId, input.memoryId)
  }

  getMemoryVersions(input: ValidatedGetMemoryVersionsInput): Page<MemoryVersion> {
    const row = this.memories.findById(input.namespaceId, input.memoryId, true)
    if (row === undefined) throw notFound()
    const result = this.memories.listVersions({
      namespaceId: input.namespaceId,
      memoryId: input.memoryId,
      limit: input.limit,
      offset: input.offset,
    })
    return pageOf(result.rows.map(rowToMemoryVersion), result.total, input.limit, input.offset)
  }

  private parseExpiresAt(value: string | null): number | null {
    if (value === null) return null
    const parsed = Date.parse(value)
    if (!Number.isFinite(parsed)) {
      throw invalidArgument('expiresAt', 'must be an ISO date-time')
    }
    return parsed
  }

}
