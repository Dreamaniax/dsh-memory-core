import type { DatabaseSync } from 'node:sqlite'
import type { MemoryType, SearchHit } from '../api/contracts.js'
import { MEMORY_COLUMNS } from '../repositories/memory-repository.js'
import { rowToMemory, type MemoryRow } from '../repositories/rows.js'
import type { SqliteStore } from '../storage/sqlite-store.js'
import { buildSnippet, type SearchPlan } from './query-builder.js'

export interface KeywordSearchInput {
  namespaceId: string
  plan: SearchPlan
  types?: MemoryType[]
  statuses: Array<'candidate' | 'active' | 'flagged'>
  limit: number
  offset: number
  snippetChars: number
  nowMs: number
}

export interface KeywordSearchResult {
  hits: SearchHit[]
  total: number
}

interface ScoredMemoryRow extends MemoryRow {
  score: number | null
}

interface SearchFilters {
  from: string
  where: string[]
  params: Array<string | number>
}

const FTS_FROM = 'memory_fts JOIN memory_items m ON m.fts_rowid = memory_fts.rowid'
const LIKE_FROM = 'memory_items m'
const LIKE_CLAUSE = "(m.title LIKE ? ESCAPE '\\' OR m.content LIKE ? ESCAPE '\\' OR m.tags_text LIKE ? ESCAPE '\\')"

export class KeywordSearch {
  private readonly db: DatabaseSync

  constructor(store: SqliteStore) {
    this.db = store.db
  }

  search(input: KeywordSearchInput): KeywordSearchResult {
    const filters = this.buildFilters(input)
    const whereSql = filters.where.join(' AND ')
    const countRow = this.db.prepare(
      'SELECT COUNT(*) AS total FROM ' + filters.from + ' WHERE ' + whereSql,
    ).get(...filters.params) as { total?: number } | undefined
    const total = Number(countRow?.total ?? 0)

    const scoreColumn = input.plan.mode === 'fts'
      ? ', -bm25(memory_fts, 5.0, 1.0, 2.0) AS score'
      : ', NULL AS score'
    const order = input.plan.mode === 'fts'
      ? 'score DESC, m.updated_at DESC, m.id DESC'
      : 'm.updated_at DESC, m.id DESC'
    const rows = this.db.prepare(
      'SELECT ' + MEMORY_COLUMNS + scoreColumn +
      ' FROM ' + filters.from + ' WHERE ' + whereSql +
      ' ORDER BY ' + order + ' LIMIT ? OFFSET ?',
    ).all(...filters.params, input.limit, input.offset) as unknown as ScoredMemoryRow[]

    const hits = rows.map(row => {
      const memory = rowToMemory(row, input.nowMs)
      return {
        memory,
        score: input.plan.mode === 'fts' && row.score !== null ? Number(row.score) : null,
        matchedBy: input.plan.mode,
        snippet: buildSnippet(memory, input.plan.tokens, input.snippetChars),
      }
    })
    return { hits, total }
  }

  rebuildIndex(): void {
    this.db.prepare("INSERT INTO memory_fts(memory_fts) VALUES('rebuild')").run()
  }

  private buildFilters(input: KeywordSearchInput): SearchFilters {
    const from = input.plan.mode === 'fts' ? FTS_FROM : LIKE_FROM
    const where: string[] = []
    const params: Array<string | number> = []

    if (input.plan.mode === 'fts') {
      where.push('memory_fts MATCH ?')
      params.push(input.plan.ftsQuery as string)
    } else {
      for (const pattern of input.plan.likePatterns) {
        where.push(LIKE_CLAUSE)
        params.push(pattern, pattern, pattern)
      }
    }

    where.push('m.namespace_id = ?')
    params.push(input.namespaceId)
    where.push('m.status IN (' + input.statuses.map(() => '?').join(', ') + ')')
    params.push(...input.statuses)
    if (input.types !== undefined && input.types.length > 0) {
      where.push('m.memory_type IN (' + input.types.map(() => '?').join(', ') + ')')
      params.push(...input.types)
    }
    where.push('(m.expires_at IS NULL OR m.expires_at > ?)')
    params.push(input.nowMs)

    return { from, where, params }
  }
}
