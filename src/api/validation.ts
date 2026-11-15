import { z } from 'zod'
import { invalidArgument, type MemoryError } from './errors.js'
import { countCodePoints } from '../utils/text.js'

export interface ValidationConfig {
  /** Maximum content length in Unicode code points. */
  maxContentChars: number
  /** Maximum serialized metadata size in UTF-8 bytes. */
  maxMetadataBytes: number
}

const DEFAULT_MAX_CONTENT_CHARS = 100_000
const DEFAULT_MAX_METADATA_BYTES = 16 * 1024
const NAMESPACE_RE = /^[a-z0-9][a-z0-9._-]*$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO_DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function hasNul(value: string): boolean {
  return value.includes('\u0000')
}

function isIsoDateTime(value: string): boolean {
  if (!ISO_DATE_TIME_RE.test(value)) return false
  const ms = Date.parse(value)
  return Number.isFinite(ms)
}

function isPlainJsonValue(value: unknown, depth = 0, seen = new WeakSet<object>()): boolean {
  if (depth > 20) return false
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object') return false
  if (seen.has(value)) return false
  seen.add(value)
  let ok: boolean
  if (Array.isArray(value)) {
    ok = value.every(item => isPlainJsonValue(item, depth + 1, seen))
  } else {
    const prototype = Object.getPrototypeOf(value)
    ok = (prototype === Object.prototype || prototype === null) &&
      Object.keys(value).every(key => !DANGEROUS_KEYS.has(key) && isPlainJsonValue((value as Record<string, unknown>)[key], depth + 1, seen))
  }
  seen.delete(value)
  return ok
}

function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const tag of tags) {
    if (!seen.has(tag)) {
      seen.add(tag)
      result.push(tag)
    }
  }
  return result
}

function dedupe<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function metadataSchema(maxBytes: number) {
  return z.record(z.string(), z.unknown()).superRefine((value, ctx) => {
    if (!isPlainJsonValue(value)) {
      ctx.addIssue({
        code: 'custom',
        message: 'metadata must be a JSON object containing only null, boolean, finite number, string, array, or plain object values',
      })
      return
    }
    let serialized: string
    try {
      serialized = JSON.stringify(value)
    } catch {
      ctx.addIssue({ code: 'custom', message: 'metadata must be JSON-serializable' })
      return
    }
    if (Buffer.byteLength(serialized, 'utf8') > maxBytes) {
      ctx.addIssue({ code: 'custom', message: 'metadata is too large' })
    }
  })
}

function stringField(min: number, max: number) {
  return z.string().min(min).max(max).refine(value => !hasNul(value), { message: 'must not contain NUL' })
}

function optionalText(max: number) {
  return z.string().max(max).refine(value => !hasNul(value), { message: 'must not contain NUL' })
}

export function createValidationSchemas(config: ValidationConfig) {
  const maxContentChars = config.maxContentChars
  const maxMetadataBytes = config.maxMetadataBytes
  if (!Number.isInteger(maxContentChars) || maxContentChars < 1) {
    throw new RangeError('maxContentChars must be a positive integer')
  }
  if (!Number.isInteger(maxMetadataBytes) || maxMetadataBytes < 1) {
    throw new RangeError('maxMetadataBytes must be a positive integer')
  }

  const namespaceSchema = stringField(1, 64).regex(NAMESPACE_RE, {
    message: 'must match ^[a-z0-9][a-z0-9._-]*$',
  })
  const uuidSchema = z.string().regex(UUID_RE, { message: 'must be a UUID' }).transform(value => value.toLowerCase())
  const memoryTypeSchema = z.enum(['working', 'semantic', 'episodic', 'procedural'])
  const memoryStatusSchema = z.enum(['candidate', 'active', 'flagged', 'rejected', 'deleted'])
  const originSchema = z.enum(['direct', 'inferred', 'imported'])
  const sourceTypeSchema = z.enum(['session', 'file', 'url', 'manual', 'plugin', 'import', 'other'])
  const relationSchema = z.enum(['origin', 'corroborates', 'contradicts'])
  const confidenceSchema = z.number().finite().min(0).max(1)
  const expiresAtSchema = z.string().max(64).refine(isIsoDateTime, { message: 'must be an ISO 8601 date-time with timezone' })
  const metadata = metadataSchema(maxMetadataBytes)
  const tags = z.array(
    z.string().max(64).refine(value => value.trim().length >= 1, { message: 'must not be empty' }).refine(value => !hasNul(value), { message: 'must not contain NUL' }).transform(value => value.trim()),
  ).max(32).transform(normalizeTags)
  const titleSchema = optionalText(1000)
  const contentSchema = stringField(1, maxContentChars).refine(value => value.trim().length > 0, {
    message: 'must not be blank',
  })
  const expectedVersion = z.number().int().min(1)
  const optionalReason = optionalText(2000).optional()
  const changedBy = optionalText(128).optional()
  const limit = z.number().int().min(1).max(100).default(20)
  const offset = z.number().int().min(0).default(0)

  const externalRefSchema = z
    .string()
    .min(1)
    .max(2048)
    .refine(value => !hasNul(value), { message: 'must not contain NUL' })
    .nullable()
    .default(null)

  const createSourceSchema = z.object({
    type: sourceTypeSchema,
    externalRef: externalRefSchema,
    title: titleSchema.default(''),
    metadata: metadata.default({}),
    relation: relationSchema.default('origin'),
  }).strict()

  const createMemorySchema = z.object({
    id: uuidSchema.optional(),
    namespaceId: namespaceSchema,
    type: memoryTypeSchema,
    title: titleSchema.default(''),
    content: contentSchema,
    tags: tags.default([]),
    confidence: confidenceSchema.nullable().default(null),
    origin: originSchema.default('direct'),
    status: z.enum(['candidate', 'active']).default('candidate'),
    metadata: metadata.default({}),
    expiresAt: expiresAtSchema.nullable().default(null),
    sources: z.array(createSourceSchema).max(32).default([]),
  }).strict()

  const getMemorySchema = z.object({
    namespaceId: namespaceSchema,
    memoryId: uuidSchema,
    includeDeleted: z.boolean().default(false),
  }).strict()

  const listMemoriesSchema = z.object({
    namespaceId: namespaceSchema,
    types: z.array(memoryTypeSchema).min(1).max(4).transform(dedupe).optional(),
    statuses: z.array(memoryStatusSchema).min(1).max(5).transform(dedupe).optional(),
    origins: z.array(originSchema).min(1).max(3).transform(dedupe).optional(),
    sourceId: uuidSchema.optional(),
    includeDeleted: z.boolean().default(false),
    includeExpired: z.boolean().default(false),
    limit,
    offset,
    orderBy: z.enum(['createdAt', 'updatedAt']).default('updatedAt'),
    order: z.enum(['asc', 'desc']).default('desc'),
  }).strict()

  const updatePatchSchema = z.object({
    type: memoryTypeSchema.optional(),
    title: titleSchema.optional(),
    content: contentSchema.optional(),
    tags: tags.optional(),
    confidence: confidenceSchema.nullable().optional(),
    metadata: metadata.optional(),
    expiresAt: expiresAtSchema.nullable().optional(),
  }).strict().refine(value => Object.keys(value).length > 0, {
    message: 'patch must contain at least one field',
  })

  const updateMemorySchema = z.object({
    namespaceId: namespaceSchema,
    memoryId: uuidSchema,
    expectedVersion,
    patch: updatePatchSchema,
    changeReason: optionalReason,
    changedBy,
  }).strict()

  const deleteMemorySchema = z.object({
    namespaceId: namespaceSchema,
    memoryId: uuidSchema,
    expectedVersion,
    reason: optionalReason,
  }).strict()

  const purgeMemorySchema = z.object({
    namespaceId: namespaceSchema,
    memoryId: uuidSchema,
    expectedVersion,
    confirmationToken: stringField(1, 200),
    reason: optionalReason,
  }).strict()

  const addSourceSchema = z.object({
    namespaceId: namespaceSchema,
    memoryId: uuidSchema,
    source: createSourceSchema,
  }).strict()

  const getSourcesSchema = z.object({
    namespaceId: namespaceSchema,
    memoryId: uuidSchema,
  }).strict()

  const getMemoryVersionsSchema = z.object({
    namespaceId: namespaceSchema,
    memoryId: uuidSchema,
    limit,
    offset,
  }).strict()

  const snippetChars = z.number().int().min(32).max(500).default(160)
  const searchStatusSchema = z.enum(['candidate', 'active', 'flagged'])
  const searchQuerySchema = z
    .string()
    .refine(value => !hasNul(value), { message: 'must not contain NUL' })
    .refine(value => value.trim().replace(/\s+/gu, ' ').length > 0, { message: 'must not be blank' })
    .refine(value => countCodePoints(value.trim().replace(/\s+/gu, ' ')) <= 500, {
      message: 'must be at most 500 Unicode code points',
    })

  const searchMemoriesSchema = z.object({
    namespaceId: namespaceSchema,
    query: searchQuerySchema,
    types: z.array(memoryTypeSchema).min(1).max(4).transform(dedupe).optional(),
    statuses: z.array(searchStatusSchema).min(1).max(3).transform(dedupe).optional(),
    limit,
    offset,
    snippetChars,
  }).strict()

  const feedbackPatchSchema = z.object({
    title: titleSchema.optional(),
    content: contentSchema.optional(),
    tags: tags.optional(),
    confidence: confidenceSchema.nullable().optional(),
    metadata: metadata.optional(),
    expiresAt: expiresAtSchema.nullable().optional(),
  }).strict().refine(value => Object.keys(value).length > 0, {
    message: 'patch must contain at least one field',
  })

  const submitFeedbackSchema = z.object({
    namespaceId: namespaceSchema,
    memoryId: uuidSchema,
    action: z.enum(['confirm', 'correct', 'reject', 'flag']),
    requestId: stringField(1, 128).regex(/^[A-Za-z0-9._:-]+$/, {
      message: 'must match ^[A-Za-z0-9._:-]+$',
    }),
    expectedVersion,
    comment: optionalText(10_000).optional(),
    patch: feedbackPatchSchema.optional(),
    metadata: metadata.default({}),
    actor: optionalText(128).optional(),
  }).strict().superRefine((value, ctx) => {
    if (value.action === 'correct' && value.patch === undefined) {
      ctx.addIssue({ code: 'custom', path: ['patch'], message: 'is required for correct' })
    }
    if (value.action !== 'correct' && value.patch !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['patch'], message: 'is only allowed for correct' })
    }
  })

  const getFeedbackHistorySchema = z.object({
    namespaceId: namespaceSchema,
    memoryId: uuidSchema,
    limit,
    offset,
  }).strict()

  return {
    createMemory: createMemorySchema,
    getMemory: getMemorySchema,
    listMemories: listMemoriesSchema,
    updateMemory: updateMemorySchema,
    deleteMemory: deleteMemorySchema,
    purgeMemory: purgeMemorySchema,
    addSource: addSourceSchema,
    getSources: getSourcesSchema,
    getMemoryVersions: getMemoryVersionsSchema,
    searchMemories: searchMemoriesSchema,
    submitFeedback: submitFeedbackSchema,
    getFeedbackHistory: getFeedbackHistorySchema,
  }
}

export type ValidationSchemas = ReturnType<typeof createValidationSchemas>
export type ValidatedCreateMemoryInput = z.infer<ValidationSchemas['createMemory']>
export type ValidatedGetMemoryInput = z.infer<ValidationSchemas['getMemory']>
export type ValidatedListMemoriesInput = z.infer<ValidationSchemas['listMemories']>
export type ValidatedUpdateMemoryInput = z.infer<ValidationSchemas['updateMemory']>
export type ValidatedDeleteMemoryInput = z.infer<ValidationSchemas['deleteMemory']>
export type ValidatedPurgeMemoryInput = z.infer<ValidationSchemas['purgeMemory']>
export type ValidatedAddSourceInput = z.infer<ValidationSchemas['addSource']>
export type ValidatedGetSourcesInput = z.infer<ValidationSchemas['getSources']>
export type ValidatedGetMemoryVersionsInput = z.infer<ValidationSchemas['getMemoryVersions']>
export type ValidatedSearchMemoriesInput = z.infer<ValidationSchemas['searchMemories']>
export type ValidatedSubmitFeedbackInput = z.infer<ValidationSchemas['submitFeedback']>
export type ValidatedGetFeedbackHistoryInput = z.infer<ValidationSchemas['getFeedbackHistory']>

function containsForbiddenKey(value: unknown, depth = 0, seen = new WeakSet<object>()): boolean {
  if (depth > 20) return true
  if (value === null || typeof value !== 'object') return false
  if (seen.has(value)) return true
  seen.add(value)
  let forbidden = false
  if (Array.isArray(value)) {
    forbidden = value.some(item => containsForbiddenKey(item, depth + 1, seen))
  } else {
    for (const key of Object.keys(value)) {
      if (DANGEROUS_KEYS.has(key) || containsForbiddenKey((value as Record<string, unknown>)[key], depth + 1, seen)) {
        forbidden = true
        break
      }
    }
  }
  seen.delete(value)
  return forbidden
}

export function parseInput<T>(schema: z.ZodType<T>, input: unknown, label: string): T {
  if (containsForbiddenKey(input)) {
    throw invalidArgument(label, 'contains a forbidden object key or cycle')
  }
  const result = schema.safeParse(input)
  if (result.success) return result.data
  const issue = result.error.issues[0]
  const path = issue?.path?.length ? issue.path.join('.') : label
  const reason = issue?.code ?? 'invalid'
  throw invalidArgument(path, reason)
}

export function resolveValidationConfig(partial: Partial<ValidationConfig> = {}): ValidationConfig {
  return {
    maxContentChars: partial.maxContentChars ?? DEFAULT_MAX_CONTENT_CHARS,
    maxMetadataBytes: partial.maxMetadataBytes ?? DEFAULT_MAX_METADATA_BYTES,
  }
}

export function assertValidMemoryError(error: MemoryError): MemoryError {
  return error
}
