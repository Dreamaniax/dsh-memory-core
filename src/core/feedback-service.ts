import type { Feedback, FeedbackResult, Page } from '../api/contracts.js'
import type {
  ValidatedGetFeedbackHistoryInput,
  ValidatedSubmitFeedbackInput,
} from '../api/validation.js'
import {
  idempotencyConflict,
  invalidArgument,
  invalidStateTransition,
  memoryDeleted,
  notFound,
  versionConflict,
} from '../api/errors.js'
import type { FeedbackRepository } from '../repositories/feedback-repository.js'
import type { MemoryRepository } from '../repositories/memory-repository.js'
import {
  parseMetadataText,
  parseTagsText,
  rowToFeedback,
  rowToMemory,
  serializeMetadata,
  serializeTags,
  type FeedbackRow,
  type MemoryRow,
} from '../repositories/rows.js'
import type { SqliteStore } from '../storage/sqlite-store.js'
import { systemClock, type Clock } from '../utils/clock.js'
import { newId } from '../utils/ids.js'
import { canonicalStringify, sha256Hex } from '../utils/json.js'
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

function cleanPatch(patch: object | undefined): Record<string, unknown> | null {
  if (patch === undefined) return null
  const cleaned: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) cleaned[key] = value
  }
  return Object.keys(cleaned).length === 0 ? null : cleaned
}

export class FeedbackService {
  private readonly store: SqliteStore
  private readonly memories: MemoryRepository
  private readonly feedback: FeedbackRepository
  private readonly clock: Clock

  constructor(
    store: SqliteStore,
    memories: MemoryRepository,
    feedback: FeedbackRepository,
    clock: Clock = systemClock,
  ) {
    this.store = store
    this.memories = memories
    this.feedback = feedback
    this.clock = clock
  }

  submit(input: ValidatedSubmitFeedbackInput): FeedbackResult {
    const now = this.clock.now()
    const requestHash = this.computeRequestHash(input)
    return this.store.transaction(() => {
      const existing = this.feedback.findByRequestId(input.namespaceId, input.requestId)
      if (existing !== undefined) return this.replay(existing, input, requestHash, now)

      const row = this.memories.findById(input.namespaceId, input.memoryId, true)
      if (row === undefined) throw notFound()
      if (row.status === 'deleted') throw memoryDeleted()
      if (row.version !== input.expectedVersion) {
        throw versionConflict(input.expectedVersion, row.version)
      }

      switch (input.action) {
        case 'confirm':
          return this.confirm(input, row, requestHash, now)
        case 'correct':
          return this.correct(input, row, requestHash, now)
        case 'reject':
          return this.reject(input, row, requestHash, now)
        case 'flag':
          return this.flag(input, row, requestHash, now)
      }
    })
  }

  history(input: ValidatedGetFeedbackHistoryInput): Page<Feedback> {
    const row = this.memories.findById(input.namespaceId, input.memoryId, true)
    if (row === undefined) throw notFound()
    const result = this.feedback.listForMemory({
      namespaceId: input.namespaceId,
      memoryId: input.memoryId,
      limit: input.limit,
      offset: input.offset,
    })
    return pageOf(result.rows.map(rowToFeedback), result.total, input.limit, input.offset)
  }

  private replay(
    existing: FeedbackRow,
    input: ValidatedSubmitFeedbackInput,
    requestHash: string,
    now: number,
  ): FeedbackResult {
    if (existing.request_hash !== requestHash) {
      throw idempotencyConflict(input.requestId)
    }
    const current = this.memories.findById(input.namespaceId, existing.memory_id, true)
    if (current === undefined) throw notFound()
    return {
      feedback: rowToFeedback(existing),
      memory: rowToMemory(current, now),
      duplicate: true,
    }
  }

  private confirm(
    input: ValidatedSubmitFeedbackInput,
    row: MemoryRow,
    requestHash: string,
    now: number,
  ): FeedbackResult {
    const changed = row.status !== 'active' || row.confirmed_at === null
    if (!changed) return this.append(input, row, requestHash, now, null)
    const next: MemoryRow = {
      ...row,
      status: 'active',
      confirmed_at: now,
      updated_at: Math.max(now, row.updated_at),
      version: row.version + 1,
    }
    this.applyLifecycle(input, row, next)
    writeMemoryVersion(
      this.memories,
      rowToMemory(next, now),
      'confirm',
      input.comment ?? null,
      input.actor ?? null,
      now,
    )
    return this.append(input, next, requestHash, now, null)
  }

  private reject(
    input: ValidatedSubmitFeedbackInput,
    row: MemoryRow,
    requestHash: string,
    now: number,
  ): FeedbackResult {
    if (row.status !== 'candidate' && row.status !== 'active' && row.status !== 'flagged') {
      throw invalidStateTransition('reject', row.status)
    }
    const next: MemoryRow = {
      ...row,
      status: 'rejected',
      updated_at: Math.max(now, row.updated_at),
      version: row.version + 1,
    }
    this.applyLifecycle(input, row, next)
    writeMemoryVersion(
      this.memories,
      rowToMemory(next, now),
      'reject',
      input.comment ?? null,
      input.actor ?? null,
      now,
    )
    return this.append(input, next, requestHash, now, null)
  }

  private flag(
    input: ValidatedSubmitFeedbackInput,
    row: MemoryRow,
    requestHash: string,
    now: number,
  ): FeedbackResult {
    if (row.status !== 'candidate' && row.status !== 'active') {
      throw invalidStateTransition('flag', row.status)
    }
    const next: MemoryRow = {
      ...row,
      status: 'flagged',
      updated_at: Math.max(now, row.updated_at),
      version: row.version + 1,
    }
    this.applyLifecycle(input, row, next)
    writeMemoryVersion(
      this.memories,
      rowToMemory(next, now),
      'flag',
      input.comment ?? null,
      input.actor ?? null,
      now,
    )
    return this.append(input, next, requestHash, now, null)
  }

  private correct(
    input: ValidatedSubmitFeedbackInput,
    row: MemoryRow,
    requestHash: string,
    now: number,
  ): FeedbackResult {
    const patch = cleanPatch(input.patch)
    if (patch === null) throw invalidArgument('patch', 'must contain at least one field')
    const next = this.applyCorrection(row, patch, now)
    if (!this.memories.updateFromFeedback(next, row.version)) {
      const latest = this.memories.findById(input.namespaceId, input.memoryId, true)
      throw versionConflict(row.version, latest?.version ?? row.version + 1)
    }
    writeMemoryVersion(
      this.memories,
      rowToMemory(next, now),
      'correct',
      input.comment ?? null,
      input.actor ?? null,
      now,
    )
    return this.append(input, next, requestHash, now, patch)
  }

  private applyLifecycle(
    input: ValidatedSubmitFeedbackInput,
    current: MemoryRow,
    next: MemoryRow,
  ): void {
    if (!this.memories.updateLifecycle(next, current.version)) {
      const latest = this.memories.findById(input.namespaceId, input.memoryId, true)
      throw versionConflict(current.version, latest?.version ?? current.version + 1)
    }
  }

  private applyCorrection(row: MemoryRow, patch: Record<string, unknown>, now: number): MemoryRow {
    const title = hasOwn(patch, 'title') ? patch.title as string : row.title
    const content = hasOwn(patch, 'content') ? patch.content as string : row.content
    const tags = hasOwn(patch, 'tags') ? patch.tags as string[] : parseTagsText(row.tags_text)
    const confidence = hasOwn(patch, 'confidence') ? patch.confidence as number | null : row.confidence
    const metadata = hasOwn(patch, 'metadata')
      ? patch.metadata as Record<string, unknown>
      : parseMetadataText(row.metadata_json)
    const expiresAt = hasOwn(patch, 'expiresAt')
      ? this.parseExpiresAt(patch.expiresAt as string | null)
      : row.expires_at
    if (row.memory_type === 'working' && expiresAt === null) {
      throw invalidArgument('expiresAt', 'is required for working memory')
    }
    if (expiresAt !== null && expiresAt <= row.created_at) {
      throw invalidArgument('expiresAt', 'must be after createdAt')
    }
    return {
      ...row,
      status: 'active',
      extraction_origin: 'direct',
      title,
      content,
      tags_text: serializeTags(tags),
      confidence,
      metadata_json: serializeMetadata(metadata),
      expires_at: expiresAt,
      confirmed_at: now,
      updated_at: Math.max(now, row.updated_at),
      version: row.version + 1,
    }
  }

  private append(
    input: ValidatedSubmitFeedbackInput,
    memoryRow: MemoryRow,
    requestHash: string,
    now: number,
    patch: Record<string, unknown> | null,
  ): FeedbackResult {
    const feedbackRow: FeedbackRow = {
      id: newId(),
      namespace_id: input.namespaceId,
      memory_id: input.memoryId,
      action: input.action,
      request_id: input.requestId,
      request_hash: requestHash,
      expected_version: input.expectedVersion,
      applied_version: memoryRow.version,
      comment: input.comment ?? null,
      patch_json: patch === null ? null : canonicalStringify(patch),
      metadata_json: serializeMetadata(input.metadata),
      actor: input.actor ?? null,
      created_at: now,
    }
    this.feedback.insert(feedbackRow)
    return {
      feedback: rowToFeedback(feedbackRow),
      memory: rowToMemory(memoryRow, now),
      duplicate: false,
    }
  }

  private computeRequestHash(input: ValidatedSubmitFeedbackInput): string {
    return sha256Hex(canonicalStringify({
      namespaceId: input.namespaceId,
      memoryId: input.memoryId,
      action: input.action,
      expectedVersion: input.expectedVersion,
      comment: input.comment ?? null,
      patch: cleanPatch(input.patch),
      metadata: input.metadata,
      actor: input.actor ?? null,
    }))
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
