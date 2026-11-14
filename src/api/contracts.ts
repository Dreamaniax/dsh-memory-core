export type MemoryType = 'working' | 'semantic' | 'episodic' | 'procedural'
export type MemoryStatus = 'candidate' | 'active' | 'flagged' | 'rejected' | 'deleted'
export type ExtractionOrigin = 'direct' | 'inferred' | 'imported'
export type SourceType = 'session' | 'file' | 'url' | 'manual' | 'plugin' | 'import' | 'other'
export type SourceRelation = 'origin' | 'corroborates' | 'contradicts'
export type FeedbackAction = 'confirm' | 'correct' | 'reject' | 'flag'
export type SearchMode = 'fts' | 'like'
export type MemoryChangeType = 'create' | 'update' | 'delete' | 'confirm' | 'correct' | 'reject' | 'flag'

export type Metadata = Record<string, unknown>

export interface Memory {
  id: string
  namespaceId: string
  type: MemoryType
  status: MemoryStatus
  origin: ExtractionOrigin
  title: string
  content: string
  tags: string[]
  confidence: number | null
  metadata: Metadata
  version: number
  createdAt: string
  updatedAt: string
  expiresAt: string | null
  confirmedAt: string | null
  deletedAt: string | null
  isExpired: boolean
}

export interface Source {
  id: string
  namespaceId: string
  type: SourceType
  externalRef: string | null
  title: string
  metadata: Metadata
  autoCreated: boolean
  createdAt: string
  relation?: SourceRelation
}

export interface Feedback {
  id: string
  namespaceId: string
  memoryId: string
  action: FeedbackAction
  requestId: string
  requestHash: string
  expectedVersion: number | null
  appliedVersion: number
  comment: string | null
  patch: Metadata | null
  metadata: Metadata
  actor: string | null
  createdAt: string
}

export interface SearchHit {
  memory: Memory
  score: number | null
  matchedBy: SearchMode
  snippet: string
}

export interface Page<T> {
  items: T[]
  limit: number
  offset: number
  total: number
  hasMore: boolean
}

export interface MemoryVersion {
  namespaceId: string
  memoryId: string
  version: number
  changeType: MemoryChangeType
  changeReason: string | null
  changedBy: string | null
  contentHash: string
  createdAt: string
  snapshot: Omit<Memory, 'isExpired'>
}

export interface CreateSourceInput {
  type: SourceType
  externalRef?: string | null
  title?: string
  metadata?: Metadata
  relation?: SourceRelation
}

export interface CreateMemoryInput {
  id?: string
  namespaceId: string
  type: MemoryType
  title?: string
  content: string
  tags?: string[]
  confidence?: number | null
  origin?: ExtractionOrigin
  status?: 'candidate' | 'active'
  metadata?: Metadata
  expiresAt?: string | null
  sources?: CreateSourceInput[]
}

export interface GetMemoryInput {
  namespaceId: string
  memoryId: string
  includeDeleted?: boolean
}

export interface ListMemoriesInput {
  namespaceId: string
  types?: MemoryType[]
  statuses?: MemoryStatus[]
  origins?: ExtractionOrigin[]
  sourceId?: string
  includeDeleted?: boolean
  includeExpired?: boolean
  limit?: number
  offset?: number
  orderBy?: 'createdAt' | 'updatedAt'
  order?: 'asc' | 'desc'
}

export interface UpdateMemoryPatch {
  type?: MemoryType
  title?: string
  content?: string
  tags?: string[]
  confidence?: number | null
  metadata?: Metadata
  expiresAt?: string | null
}

export interface UpdateMemoryInput {
  namespaceId: string
  memoryId: string
  expectedVersion: number
  patch: UpdateMemoryPatch
  changeReason?: string
  changedBy?: string
}

export interface DeleteMemoryInput {
  namespaceId: string
  memoryId: string
  expectedVersion: number
  reason?: string
}

export interface PurgeMemoryInput {
  namespaceId: string
  memoryId: string
  expectedVersion: number
  confirmationToken: string
  reason?: string
}

export interface AddSourceInput {
  namespaceId: string
  memoryId: string
  source: CreateSourceInput
}

export interface GetSourcesInput {
  namespaceId: string
  memoryId: string
}

export interface GetMemoryVersionsInput {
  namespaceId: string
  memoryId: string
  limit?: number
  offset?: number
}

export interface SearchMemoriesInput {
  namespaceId: string
  query: string
  types?: MemoryType[]
  statuses?: Array<'candidate' | 'active' | 'flagged'>
  limit?: number
  offset?: number
  snippetChars?: number
}

export interface FeedbackPatch {
  title?: string
  content?: string
  tags?: string[]
  confidence?: number | null
  metadata?: Metadata
  expiresAt?: string | null
}

export interface SubmitFeedbackInput {
  namespaceId: string
  memoryId: string
  action: FeedbackAction
  requestId: string
  expectedVersion: number
  comment?: string
  patch?: FeedbackPatch
  metadata?: Metadata
  actor?: string
}

export interface GetFeedbackHistoryInput {
  namespaceId: string
  memoryId: string
  limit?: number
  offset?: number
}

export interface FeedbackResult {
  feedback: Feedback
  memory: Memory
  duplicate: boolean
}
