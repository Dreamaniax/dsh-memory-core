import type { Page, SearchHit } from '../api/contracts.js'
import type { ValidatedSearchMemoriesInput } from '../api/validation.js'
import { KeywordSearch } from '../search/keyword-search.js'
import { buildSearchPlan } from '../search/query-builder.js'
import type { SqliteStore } from '../storage/sqlite-store.js'
import { systemClock, type Clock } from '../utils/clock.js'

function pageOf<T>(items: T[], total: number, limit: number, offset: number): Page<T> {
  return {
    items,
    limit,
    offset,
    total,
    hasMore: offset + items.length < total,
  }
}

export class SearchService {
  private readonly index: KeywordSearch
  private readonly clock: Clock

  constructor(store: SqliteStore, clock: Clock = systemClock) {
    this.index = new KeywordSearch(store)
    this.clock = clock
  }

  search(input: ValidatedSearchMemoriesInput): Page<SearchHit> {
    const plan = buildSearchPlan(input.query)
    const result = this.index.search({
      namespaceId: input.namespaceId,
      plan,
      ...(input.types === undefined ? {} : { types: input.types }),
      statuses: input.statuses ?? ['active'],
      limit: input.limit,
      offset: input.offset,
      snippetChars: input.snippetChars,
      nowMs: this.clock.now(),
    })
    return pageOf(result.hits, result.total, input.limit, input.offset)
  }

  rebuildIndex(): void {
    this.index.rebuildIndex()
  }
}
