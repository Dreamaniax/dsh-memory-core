import { MemoryStorageError, isSqliteBusy, type StorageErrorCode } from '../storage/sqlite-errors.js'

export type MemoryErrorCode =
  | 'INVALID_ARGUMENT'
  | 'NOT_FOUND'
  | 'DUPLICATE_ID'
  | 'VERSION_CONFLICT'
  | 'INVALID_STATE_TRANSITION'
  | 'IDEMPOTENCY_CONFLICT'
  | 'MEMORY_DELETED'
  | 'CONFIRMATION_REQUIRED'
  | 'NAMESPACE_MISMATCH'
  | 'PAYLOAD_TOO_LARGE'
  | 'STORAGE_BUSY'
  | 'STORAGE_ERROR'
  | 'CORRUPT_DATABASE'
  | 'MIGRATION_FAILED'
  | 'CLOSED'

export interface MemoryErrorOptions {
  cause?: unknown
  details?: Record<string, unknown>
}

/**
 * Stable public error. Details must only contain structured metadata, never
 * memory content, SQL text, filesystem paths, or driver stack traces.
 */
export class MemoryError extends Error {
  readonly code: MemoryErrorCode
  readonly details?: Record<string, unknown>

  constructor(code: MemoryErrorCode, message: string, options: MemoryErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'MemoryError'
    this.code = code
    this.details = options.details
  }
}

export function isMemoryError(error: unknown): error is MemoryError {
  return error instanceof MemoryError
}

export function invalidArgument(field: string, reason: string): MemoryError {
  return new MemoryError('INVALID_ARGUMENT', 'Invalid input for "' + field + '"', {
    details: { field, reason },
  })
}

export function notFound(kind: 'memory' | 'source' | 'feedback' = 'memory'): MemoryError {
  return new MemoryError('NOT_FOUND', kind + ' not found')
}

export function duplicateId(): MemoryError {
  return new MemoryError('DUPLICATE_ID', 'A memory with this id already exists in the namespace')
}

export function versionConflict(expectedVersion: number, actualVersion: number): MemoryError {
  return new MemoryError('VERSION_CONFLICT', 'Memory version does not match expectedVersion', {
    details: { expectedVersion, actualVersion },
  })
}

export function memoryDeleted(): MemoryError {
  return new MemoryError('MEMORY_DELETED', 'Memory is deleted')
}

export function confirmationRequired(): MemoryError {
  return new MemoryError('CONFIRMATION_REQUIRED', 'A valid confirmation token is required')
}

export function namespaceMismatch(): MemoryError {
  return new MemoryError('NAMESPACE_MISMATCH', 'Related records must belong to the same namespace')
}

const STORAGE_MESSAGES: Record<StorageErrorCode, string> = {
  STORAGE_BUSY: 'Database is busy; retry with backoff',
  STORAGE_ERROR: 'Storage operation failed',
  CORRUPT_DATABASE: 'Database integrity check failed; restore from backup',
  MIGRATION_FAILED: 'Database migration failed',
  CLOSED: 'Memory core is closed',
}

const STORAGE_CODES = new Set<string>([
  'STORAGE_BUSY',
  'STORAGE_ERROR',
  'CORRUPT_DATABASE',
  'MIGRATION_FAILED',
  'CLOSED',
])

function isClosedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /database is not open|database connection is not open|closed/i.test(message)
}

/**
 * Convert storage/driver failures into the public error model. The original
 * error is retained only as cause; its message is never copied into the public
 * message because SQLite messages can contain SQL text.
 */
export function toMemoryError(error: unknown): MemoryError {
  if (error instanceof MemoryError) return error
  if (error instanceof MemoryStorageError) {
    return new MemoryError(error.code, STORAGE_MESSAGES[error.code], { cause: error })
  }
  if (isSqliteBusy(error)) {
    return new MemoryError('STORAGE_BUSY', STORAGE_MESSAGES.STORAGE_BUSY, { cause: error })
  }
  if (isClosedError(error)) {
    return new MemoryError('CLOSED', STORAGE_MESSAGES.CLOSED, { cause: error })
  }
  return new MemoryError('STORAGE_ERROR', STORAGE_MESSAGES.STORAGE_ERROR, { cause: error })
}

export function isStorageCode(code: string): code is StorageErrorCode {
  return STORAGE_CODES.has(code)
}
