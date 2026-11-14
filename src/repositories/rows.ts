import type {
  Feedback,
  FeedbackAction,
  Memory,
  MemoryChangeType,
  MemoryStatus,
  MemoryType,
  ExtractionOrigin,
  MemoryVersion,
  Source,
  SourceRelation,
  SourceType,
} from '../api/contracts.js'
import { MemoryStorageError } from '../storage/sqlite-errors.js'
import { canonicalStringify, sha256Hex } from '../utils/json.js'

export interface MemoryRow {
  fts_rowid: number
  id: string
  namespace_id: string
  memory_type: MemoryType
  status: MemoryStatus
  extraction_origin: ExtractionOrigin
  title: string
  content: string
  tags_text: string
  confidence: number | null
  metadata_json: string
  version: number
  created_at: number
  updated_at: number
  expires_at: number | null
  confirmed_at: number | null
  deleted_at: number | null
}

export interface SourceRow {
  id: string
  namespace_id: string
  source_type: SourceType
  external_ref: string | null
  title: string
  metadata_json: string
  auto_created: number
  created_at: number
}

export interface SourceRowWithRelation extends SourceRow {
  relation: SourceRelation
}

export interface MemoryVersionRow {
  namespace_id: string
  memory_id: string
  version: number
  snapshot_json: string
  content_hash: string
  change_type: MemoryChangeType
  change_reason: string | null
  changed_by: string | null
  created_at: number
}

export interface FeedbackRow {
  id: string
  namespace_id: string
  memory_id: string
  action: FeedbackAction
  request_id: string
  request_hash: string
  expected_version: number | null
  applied_version: number
  comment: string | null
  patch_json: string | null
  metadata_json: string
  actor: string | null
  created_at: number
}

function corrupt(message: string): MemoryStorageError {
  return new MemoryStorageError('CORRUPT_DATABASE', message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseStoredJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    throw new MemoryStorageError('CORRUPT_DATABASE', 'stored ' + label + ' is not valid JSON', { cause: error })
  }
}

export function parseTagsText(text: string): string[] {
  if (text === '') return []
  if (text.startsWith('[')) {
    const parsed = parseStoredJson(text, 'tags')
    if (!Array.isArray(parsed) || parsed.some(tag => typeof tag !== 'string')) {
      throw corrupt('stored tags are not a string array')
    }
    return parsed as string[]
  }
  // Legacy space-joined format from early design drafts.
  return text.split(/\s+/).filter(tag => tag.length > 0)
}

export function serializeTags(tags: string[]): string {
  return canonicalStringify(tags)
}

export function parseMetadataText(text: string): Record<string, unknown> {
  const parsed = parseStoredJson(text, 'metadata')
  if (!isRecord(parsed)) throw corrupt('stored metadata is not an object')
  return parsed
}

export function serializeMetadata(metadata: Record<string, unknown>): string {
  return canonicalStringify(metadata)
}

export function rowToMemory(row: MemoryRow, nowMs: number): Memory {
  return {
    id: row.id,
    namespaceId: row.namespace_id,
    type: row.memory_type,
    status: row.status,
    origin: row.extraction_origin,
    title: row.title,
    content: row.content,
    tags: parseTagsText(row.tags_text),
    confidence: row.confidence,
    metadata: parseMetadataText(row.metadata_json),
    version: row.version,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    expiresAt: row.expires_at === null ? null : new Date(row.expires_at).toISOString(),
    confirmedAt: row.confirmed_at === null ? null : new Date(row.confirmed_at).toISOString(),
    deletedAt: row.deleted_at === null ? null : new Date(row.deleted_at).toISOString(),
    isExpired: row.expires_at !== null && row.expires_at <= nowMs,
  }
}

export function rowToSource(row: SourceRow, relation?: SourceRelation): Source {
  return {
    id: row.id,
    namespaceId: row.namespace_id,
    type: row.source_type,
    externalRef: row.external_ref,
    title: row.title,
    metadata: parseMetadataText(row.metadata_json),
    autoCreated: row.auto_created === 1,
    createdAt: new Date(row.created_at).toISOString(),
    ...(relation === undefined ? {} : { relation }),
  }
}

export type MemorySnapshot = Omit<Memory, 'isExpired'>

export function toMemorySnapshot(memory: Memory): MemorySnapshot {
  const { isExpired: _isExpired, ...snapshot } = memory
  return snapshot
}

export function memorySnapshotHash(snapshot: MemorySnapshot): string {
  return sha256Hex(canonicalStringify(snapshot))
}

export function rowToMemoryVersion(row: MemoryVersionRow): MemoryVersion {
  const parsed = parseStoredJson(row.snapshot_json, 'memory version snapshot')
  if (!isRecord(parsed)) throw corrupt('stored memory version snapshot is not an object')
  const snapshot = parsed as unknown as MemorySnapshot
  if (snapshot.version !== row.version || snapshot.id === undefined || snapshot.namespaceId === undefined) {
    throw corrupt('stored memory version snapshot does not match its row')
  }
  return {
    namespaceId: row.namespace_id,
    memoryId: row.memory_id,
    version: row.version,
    changeType: row.change_type,
    changeReason: row.change_reason,
    changedBy: row.changed_by,
    contentHash: row.content_hash,
    createdAt: new Date(row.created_at).toISOString(),
    snapshot,
  }
}

export function rowToFeedback(row: FeedbackRow): Feedback {
  const patch = row.patch_json === null ? null : parseStoredJson(row.patch_json, 'feedback patch')
  if (patch !== null && !isRecord(patch)) {
    throw corrupt('stored feedback patch is not an object')
  }
  return {
    id: row.id,
    namespaceId: row.namespace_id,
    memoryId: row.memory_id,
    action: row.action,
    requestId: row.request_id,
    requestHash: row.request_hash,
    expectedVersion: row.expected_version,
    appliedVersion: row.applied_version,
    comment: row.comment,
    patch,
    metadata: parseMetadataText(row.metadata_json),
    actor: row.actor,
    createdAt: new Date(row.created_at).toISOString(),
  }
}

export function parseNullableTimestamp(value: string | null): number | null {
  return value === null ? null : Date.parse(value)
}
