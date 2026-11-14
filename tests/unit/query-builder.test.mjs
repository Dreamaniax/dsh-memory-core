import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildSearchPlan,
  buildSnippet,
  escapeLikePattern,
  normalizeSearchQuery,
} from '../../lib/search/query-builder.js'
import { countCodePoints } from '../../lib/utils/text.js'

function memory(overrides = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    namespaceId: 'test',
    type: 'semantic',
    status: 'active',
    origin: 'direct',
    title: '',
    content: '',
    tags: [],
    confidence: null,
    metadata: {},
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: null,
    confirmedAt: null,
    deletedAt: null,
    isExpired: false,
    ...overrides,
  }
}

test('normalizes whitespace and rejects blank, NUL, and oversized queries', () => {
  assert.equal(normalizeSearchQuery('  alpha\t beta\n gamma  '), 'alpha beta gamma')
  for (const value of ['', '   ', '\t\n', 'alpha\u0000beta', 'x'.repeat(501)]) {
    assert.throws(
      () => normalizeSearchQuery(value),
      error => error?.code === 'INVALID_ARGUMENT',
      'expected INVALID_ARGUMENT for ' + JSON.stringify(value),
    )
  }
})

test('counts Unicode code points rather than UTF-16 code units', () => {
  assert.equal(countCodePoints('人工智能'), 4)
  assert.equal(countCodePoints('😀😀'), 2)
  assert.equal(countCodePoints('a😀b'), 3)
})

test('selects FTS for words of at least three code points', () => {
  const english = buildSearchPlan('alpha beta')
  assert.equal(english.mode, 'fts')
  assert.equal(english.ftsQuery, '"alpha" AND "beta"')
  assert.deepEqual(english.likePatterns, [])

  const chinese = buildSearchPlan('人工智能')
  assert.equal(chinese.mode, 'fts')
  assert.equal(chinese.ftsQuery, '"人工智能"')

  const three = buildSearchPlan('人工智')
  assert.equal(three.mode, 'fts')
  assert.equal(three.ftsQuery, '"人工智"')
})

test('falls back to LIKE when the query or any word is shorter than three code points', () => {
  const shortTotal = buildSearchPlan('ab')
  assert.equal(shortTotal.mode, 'like')
  assert.equal(shortTotal.ftsQuery, null)
  assert.deepEqual(shortTotal.likePatterns, ['%ab%'])

  const shortWord = buildSearchPlan('alpha 模型')
  assert.equal(shortWord.mode, 'like')
  assert.deepEqual(shortWord.likePatterns, ['%alpha%', '%模型%'])

  assert.equal(buildSearchPlan('人工').mode, 'like')
  assert.equal(buildSearchPlan('人工 智能').mode, 'like')
})

test('quotes every FTS token as a phrase and doubles embedded quotes', () => {
  const plan = buildSearchPlan('foo"bar baz')
  assert.equal(plan.mode, 'fts')
  assert.equal(plan.ftsQuery, '"foo""bar" AND "baz"')
})

test('escapes LIKE metacharacters', () => {
  assert.equal(escapeLikePattern('50%_off'), '50\\%\\_off')
  assert.equal(escapeLikePattern('back\\slash'), 'back\\\\slash')
  assert.deepEqual(buildSearchPlan('a%b x').likePatterns, ['%a\\%b%', '%x%'])
})

test('builds a plain-text, code-point-safe snippet around a match', () => {
  const content = '前缀'.repeat(40) + 'needle' + '后缀'.repeat(40)
  const snippet = buildSnippet(memory({ content }), ['needle'], 32)
  assert.ok(snippet.includes('needle'))
  assert.ok(countCodePoints(snippet) <= 32)
  assert.ok(snippet.startsWith('…'))
  assert.ok(snippet.endsWith('…'))
  assert.equal(snippet.includes('<b>'), false)
})

test('snippet falls back to the title and then the beginning of content', () => {
  const titleSnippet = buildSnippet(memory({ title: 'title needle here', content: 'unrelated' }), ['needle'], 20)
  assert.ok(titleSnippet.includes('needle'))

  const fallback = buildSnippet(memory({ content: 'abcdefghij' }), ['zzz'], 5)
  assert.equal(countCodePoints(fallback), 5)
  assert.ok(fallback.endsWith('…'))
})
