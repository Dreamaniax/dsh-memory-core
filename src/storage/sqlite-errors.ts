export type StorageErrorCode =
  | 'STORAGE_BUSY'
  | 'STORAGE_ERROR'
  | 'CORRUPT_DATABASE'
  | 'MIGRATION_FAILED'
  | 'CLOSED'

export interface StorageErrorOptions {
  cause?: unknown
  details?: Record<string, unknown>
}

export class MemoryStorageError extends Error {
  readonly code: StorageErrorCode
  readonly details?: Record<string, unknown>

  constructor(code: StorageErrorCode, message: string, options: StorageErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'MemoryStorageError'
    this.code = code
    this.details = options.details
  }
}

export function isSqliteBusy(error: unknown): boolean {
  const errcode = (error as { errcode?: unknown } | null)?.errcode
  return errcode === 5 || errcode === 6
}

export function translateStorageError(error: unknown, context: string): MemoryStorageError {
  if (error instanceof MemoryStorageError) return error
  const message = error instanceof Error ? error.message : String(error)
  if (isSqliteBusy(error)) {
    return new MemoryStorageError('STORAGE_BUSY', context + ': SQLite is busy', { cause: error })
  }
  if (/malformed|not a database|database disk image is malformed|integrity/i.test(message)) {
    return new MemoryStorageError('CORRUPT_DATABASE', context + ': database integrity failure', { cause: error })
  }
  return new MemoryStorageError('STORAGE_ERROR', context + ': ' + message, { cause: error })
}
