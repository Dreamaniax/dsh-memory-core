import type { Memory, SearchMode } from '../api/contracts.js'
import { invalidArgument } from '../api/errors.js'
import { countCodePoints } from '../utils/text.js'

export interface SearchPlan {
  normalizedQuery: string
  tokens: string[]
  mode: SearchMode
  ftsQuery: string | null
  likePatterns: string[]
}

export function normalizeSearchQuery(value: string): string {
  if (value.includes('\u0000')) {
    throw invalidArgument('query', 'must not contain NUL')
  }
  const normalized = value.trim().replace(/\s+/gu, ' ')
  if (normalized.length === 0) {
    throw invalidArgument('query', 'must not be blank')
  }
  if (countCodePoints(normalized) > 500) {
    throw invalidArgument('query', 'must be at most 500 Unicode code points')
  }
  return normalized
}

export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, character => '\\' + character)
}

function quoteFtsPhrase(token: string): string {
  // FTS5 phrase quoting: double every embedded quote. The entire MATCH value
  // is a parameter, so no user input is ever parsed as FTS syntax.
  return '"' + token.replace(/"/g, '""') + '"'
}

export function buildSearchPlan(value: string): SearchPlan {
  const normalizedQuery = normalizeSearchQuery(value)
  const tokens = normalizedQuery.split(' ')
  const mode: SearchMode = countCodePoints(normalizedQuery) < 3 ||
    tokens.some(token => countCodePoints(token) < 3)
    ? 'like'
    : 'fts'
  return {
    normalizedQuery,
    tokens,
    mode,
    ftsQuery: mode === 'fts' ? tokens.map(quoteFtsPhrase).join(' AND ') : null,
    likePatterns: mode === 'like' ? tokens.map(token => '%' + escapeLikePattern(token) + '%') : [],
  }
}

function firstMatchIndex(haystack: string, tokens: string[]): number {
  const lower = haystack.toLowerCase()
  let best = -1
  for (const token of tokens) {
    const index = lower.indexOf(token.toLowerCase())
    if (index >= 0 && (best < 0 || index < best)) best = index
  }
  return best
}

function clip(text: string, maxChars: number): string {
  const runes = Array.from(text)
  if (runes.length <= maxChars) return text
  return runes.slice(0, Math.max(0, maxChars - 1)).join('') + '…'
}

function clipAround(text: string, utf16Index: number, maxChars: number, tokens: string[]): string {
  const runes = Array.from(text)
  if (runes.length <= maxChars) return text
  const matchCodePoint = countCodePoints(text.slice(0, utf16Index))
  const longestToken = Math.max(...tokens.map(countCodePoints), 1)
  const contentBudget = Math.max(maxChars - 2, 1)
  const contextBefore = Math.max(0, Math.min(contentBudget - longestToken, Math.floor(contentBudget / 3)))
  let start = Math.max(0, matchCodePoint - contextBefore)
  let end = Math.min(runes.length, start + contentBudget)
  if (end - start < contentBudget) start = Math.max(0, end - contentBudget)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < runes.length ? '…' : ''
  let result = prefix + runes.slice(start, end).join('') + suffix
  if (countCodePoints(result) > maxChars) {
    result = Array.from(result).slice(0, Math.max(0, maxChars - 1)).join('') + '…'
  }
  return result
}

/**
 * Build a plain-text snippet. It deliberately does not use FTS5 snippet()
 * markers so callers never have to strip HTML or match markers.
 */
export function buildSnippet(memory: Memory, tokens: string[], maxChars: number): string {
  const content = memory.content
  const contentIndex = firstMatchIndex(content, tokens)
  if (contentIndex >= 0) return clipAround(content, contentIndex, maxChars, tokens)

  const title = memory.title
  if (title.length > 0) {
    const titleIndex = firstMatchIndex(title, tokens)
    if (titleIndex >= 0) return clipAround(title, titleIndex, maxChars, tokens)
  }

  const tags = memory.tags.join(' ')
  if (tags.length > 0) {
    const tagsIndex = firstMatchIndex(tags, tokens)
    if (tagsIndex >= 0) return clipAround(tags, tagsIndex, maxChars, tokens)
  }

  return clip(content, maxChars)
}
