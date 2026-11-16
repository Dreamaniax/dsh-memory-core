import { isAbsolute } from 'node:path'
import type {
  AddSourceInput,
  CreateMemoryInput,
  DeleteMemoryInput,
  Feedback,
  FeedbackResult,
  GetFeedbackHistoryInput,
  GetMemoryInput,
  GetMemoryVersionsInput,
  GetSourcesInput,
  ListMemoriesInput,
  Memory,
  MemoryVersion,
  Page,
  PurgeMemoryInput,
  SearchHit,
  SearchMemoriesInput,
  Source,
  SubmitFeedbackInput,
  UpdateMemoryInput,
} from './contracts.js'
import { invalidArgument, toMemoryError } from './errors.js'
import {
  createValidationSchemas,
  parseInput,
  resolveValidationConfig,
  type ValidationConfig,
} from './validation.js'
import { FeedbackService } from '../core/feedback-service.js'
import { MemoryManager } from '../core/memory-manager.js'
import { SearchService } from '../core/search-service.js'
import { SourceService } from '../core/source-service.js'
import { FeedbackRepository } from '../repositories/feedback-repository.js'
import { MemoryRepository } from '../repositories/memory-repository.js'
import { SourceRepository } from '../repositories/source-repository.js'
import { SqliteStore, type BackupResult, type HealthReport, type OpenSqliteStoreOptions } from '../storage/sqlite-store.js'
import { systemClock, type Clock } from '../utils/clock.js'

export interface MemoryApi {
  createMemory(input: CreateMemoryInput): Promise<Memory>
  getMemory(input: GetMemoryInput): Promise<Memory | null>
  listMemories(input: ListMemoriesInput): Promise<Page<Memory>>
  updateMemory(input: UpdateMemoryInput): Promise<Memory>
  deleteMemory(input: DeleteMemoryInput): Promise<void>
  purgeMemory(input: PurgeMemoryInput): Promise<void>
  addSource(input: AddSourceInput): Promise<Source>
  getSources(input: GetSourcesInput): Promise<Source[]>
  getMemoryVersions(input: GetMemoryVersionsInput): Promise<Page<MemoryVersion>>
  searchMemories(input: SearchMemoriesInput): Promise<Page<SearchHit>>
  submitFeedback(input: SubmitFeedbackInput): Promise<FeedbackResult>
  /** Compatibility alias for submitFeedback. */
  addMemoryFeedback(input: SubmitFeedbackInput): Promise<FeedbackResult>
  getFeedbackHistory(input: GetFeedbackHistoryInput): Promise<Page<Feedback>>
  rebuildSearchIndex(): Promise<void>
  backupTo(path: string): Promise<BackupResult>
  healthCheck(): Promise<HealthReport>
  close(): Promise<void>
}

export interface OpenMemoryCoreOptions extends OpenSqliteStoreOptions {
  validation?: Partial<ValidationConfig>
}

class MemoryApiImpl implements MemoryApi {
  private readonly store: SqliteStore
  private readonly manager: MemoryManager
  private readonly search: SearchService
  private readonly feedback: FeedbackService
  private readonly schemas: ReturnType<typeof createValidationSchemas>

  constructor(store: SqliteStore, validation: ValidationConfig, clock: Clock) {
    this.store = store
    this.schemas = createValidationSchemas(validation)
    const memories = new MemoryRepository(store)
    const sourceRepository = new SourceRepository(store)
    const sourceService = new SourceService(sourceRepository)
    this.manager = new MemoryManager(store, memories, sourceService, clock)
    this.search = new SearchService(store, clock)
    this.feedback = new FeedbackService(store, memories, new FeedbackRepository(store), clock)
  }

  async createMemory(input: CreateMemoryInput): Promise<Memory> {
    try {
      const validated = parseInput(this.schemas.createMemory, input, 'input')
      return this.manager.createMemory(validated)
    } catch (error) {
      throw toMemoryError(error)
    }
  }

  async getMemory(input: GetMemoryInput): Promise<Memory | null> {
    try {
      const validated = parseInput(this.schemas.getMemory, input, 'input')
      return this.manager.getMemory(validated)
    } catch (error) {
      throw toMemoryError(error)
    }
  }

  async listMemories(input: ListMemoriesInput): Promise<Page<Memory>> {
    try {
      const validated = parseInput(this.schemas.listMemories, input, 'input')
      return this.manager.listMemories(validated)
    } catch (error) {
      throw toMemoryError(error)
    }
  }

  async updateMemory(input: UpdateMemoryInput): Promise<Memory> {
    try {
      const validated = parseInput(this.schemas.updateMemory, input, 'input')
      return this.manager.updateMemory(validated)
    } catch (error) {
      throw toMemoryError(error)
    }
  }

  async deleteMemory(input: DeleteMemoryInput): Promise<void> {
    try {
      const validated = parseInput(this.schemas.deleteMemory, input, 'input')
      this.manager.deleteMemory(validated)
    } catch (error) {
      throw toMemoryError(error)
    }
  }

  async purgeMemory(input: PurgeMemoryInput): Promise<void> {
    try {
      const validated = parseInput(this.schemas.purgeMemory, input, 'input')
      this.manager.purgeMemory(validated)
    } catch (error) {
      throw toMemoryError(error)
    }
  }

  async addSource(input: AddSourceInput): Promise<Source> {
    try {
      const validated = parseInput(this.schemas.addSource, input, 'input')
      return this.manager.addSource(validated)
    } catch (error) {
      throw toMemoryError(error)
    }
  }

  async getSources(input: GetSourcesInput): Promise<Source[]> {
    try {
      const validated = parseInput(this.schemas.getSources, input, 'input')
      return this.manager.getSources(validated)
    } catch (error) {
      throw toMemoryError(error)
    }
  }

  async getMemoryVersions(input: GetMemoryVersionsInput): Promise<Page<MemoryVersion>> {
    try {
      const validated = parseInput(this.schemas.getMemoryVersions, input, 'input')
      return this.manager.getMemoryVersions(validated)
    } catch (error) {
      throw toMemoryError(error)
    }
  }

  async searchMemories(input: SearchMemoriesInput): Promise<Page<SearchHit>> {
    try {
      const validated = parseInput(this.schemas.searchMemories, input, 'input')
      return this.search.search(validated)
    } catch (error) {
      throw toMemoryError(error)
    }
  }

  async submitFeedback(input: SubmitFeedbackInput): Promise<FeedbackResult> {
    try {
      const validated = parseInput(this.schemas.submitFeedback, input, 'input')
      return this.feedback.submit(validated)
    } catch (error) {
      throw toMemoryError(error)
    }
  }

  async addMemoryFeedback(input: SubmitFeedbackInput): Promise<FeedbackResult> {
    return this.submitFeedback(input)
  }

  async getFeedbackHistory(input: GetFeedbackHistoryInput): Promise<Page<Feedback>> {
    try {
      const validated = parseInput(this.schemas.getFeedbackHistory, input, 'input')
      return this.feedback.history(validated)
    } catch (error) {
      throw toMemoryError(error)
    }
  }

  async rebuildSearchIndex(): Promise<void> {
    try {
      this.search.rebuildIndex()
    } catch (error) {
      throw toMemoryError(error)
    }
  }

  async backupTo(path: string): Promise<BackupResult> {
    try {
      if (typeof path !== 'string' || path.length === 0 || path.includes('\u0000') || !isAbsolute(path)) {
        throw invalidArgument('path', 'must be an absolute path')
      }
      return await this.store.backupTo(path)
    } catch (error) {
      throw toMemoryError(error)
    }
  }

  async healthCheck(): Promise<HealthReport> {
    try {
      return await this.store.healthCheck()
    } catch (error) {
      throw toMemoryError(error)
    }
  }

  async close(): Promise<void> {
    try {
      await this.store.close()
    } catch (error) {
      throw toMemoryError(error)
    }
  }
}

export async function openMemoryCore(options: OpenMemoryCoreOptions): Promise<MemoryApi> {
  try {
    const validation = resolveValidationConfig(options.validation)
    const store = await SqliteStore.open(options)
    try {
      return new MemoryApiImpl(store, validation, options.clock ?? systemClock)
    } catch (error) {
      await store.close().catch(() => undefined)
      throw error
    }
  } catch (error) {
    throw toMemoryError(error)
  }
}
