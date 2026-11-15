import z from '@deepseek-ai/schemastery'
import { Service, type Context } from '@deepseek-ai/cordis'
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
} from './api/contracts.js'
import { openMemoryCore, type MemoryApi } from './api/memory-api.js'
import type { BackupResult, HealthReport, JournalMode, SynchronousMode } from './storage/sqlite-store.js'
import { resolveMemoryCorePath } from './plugin-config.js'

/** Raw plugin configuration accepted from the DSH profile patch. */
export interface MemoryCoreConfig {
  path?: string
  journalMode?: JournalMode
  busyTimeoutMs?: number
  synchronous?: SynchronousMode
  backupBeforeMigrate?: boolean
  backupDir?: string
}

const ConfigSchema = z.object({
  path: z.string().default(''),
  journalMode: z.union(['wal', 'delete', 'truncate', 'persist']).default('wal'),
  busyTimeoutMs: z.number().step(1).min(0).max(60000).default(5000),
  synchronous: z.union(['NORMAL', 'FULL']).default('NORMAL'),
  backupBeforeMigrate: z.boolean().default(true),
  backupDir: z.string().default(''),
})

/**
 * DSH host service exposing the memory API as `ctx.memoryCore`.
 *
 * The database opens during Cordis service initialization. If opening or
 * migrating fails, initialization fails and the plugin does not silently fall
 * back to an in-memory store: a memory system that quietly forgets is worse
 * than one that refuses to start.
 */
export class MemoryCoreService extends Service implements MemoryApi {
  static readonly inject: string[] = []
  static readonly Config: unknown = ConfigSchema

  private api: MemoryApi | undefined
  private closed = false

  constructor(
    private readonly serviceContext: Context,
    private readonly options: MemoryCoreConfig = {},
  ) {
    super(serviceContext, 'memoryCore')
  }

  async [Service.init](): Promise<void> {
    const api = await openMemoryCore({
      path: resolveMemoryCorePath(this.options.path),
      journalMode: this.options.journalMode,
      busyTimeoutMs: this.options.busyTimeoutMs,
      synchronous: this.options.synchronous,
      backupBeforeMigrate: this.options.backupBeforeMigrate,
      backupDir: this.options.backupDir || undefined,
    })
    this.api = api
    this.serviceContext.effect(
      () => async () => {
        await this.close()
      },
      'memoryCore.close',
    )
  }

  private get client(): MemoryApi {
    if (this.closed) throw new Error('memoryCore service is closed')
    if (!this.api) throw new Error('memoryCore service is not initialized')
    return this.api
  }

  createMemory(input: CreateMemoryInput): Promise<Memory> {
    return this.client.createMemory(input)
  }

  getMemory(input: GetMemoryInput): Promise<Memory | null> {
    return this.client.getMemory(input)
  }

  listMemories(input: ListMemoriesInput): Promise<Page<Memory>> {
    return this.client.listMemories(input)
  }

  updateMemory(input: UpdateMemoryInput): Promise<Memory> {
    return this.client.updateMemory(input)
  }

  deleteMemory(input: DeleteMemoryInput): Promise<void> {
    return this.client.deleteMemory(input)
  }

  purgeMemory(input: PurgeMemoryInput): Promise<void> {
    return this.client.purgeMemory(input)
  }

  addSource(input: AddSourceInput): Promise<Source> {
    return this.client.addSource(input)
  }

  getSources(input: GetSourcesInput): Promise<Source[]> {
    return this.client.getSources(input)
  }

  getMemoryVersions(input: GetMemoryVersionsInput): Promise<Page<MemoryVersion>> {
    return this.client.getMemoryVersions(input)
  }

  searchMemories(input: SearchMemoriesInput): Promise<Page<SearchHit>> {
    return this.client.searchMemories(input)
  }

  submitFeedback(input: SubmitFeedbackInput): Promise<FeedbackResult> {
    return this.client.submitFeedback(input)
  }

  addMemoryFeedback(input: SubmitFeedbackInput): Promise<FeedbackResult> {
    return this.client.addMemoryFeedback(input)
  }

  getFeedbackHistory(input: GetFeedbackHistoryInput): Promise<Page<Feedback>> {
    return this.client.getFeedbackHistory(input)
  }

  rebuildSearchIndex(): Promise<void> {
    return this.client.rebuildSearchIndex()
  }

  backupTo(path: string): Promise<BackupResult> {
    return this.client.backupTo(path)
  }

  healthCheck(): Promise<HealthReport> {
    return this.client.healthCheck()
  }

  async close(): Promise<void> {
    if (this.closed) return
    const api = this.api
    if (api === undefined) {
      this.closed = true
      return
    }
    // Keep the handle until the store closes so a transient close failure can
    // be retried by the Cordis disposal effect instead of leaking the database.
    await api.close()
    this.api = undefined
    this.closed = true
  }
}

export default MemoryCoreService
