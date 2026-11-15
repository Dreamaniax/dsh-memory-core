import { createHash } from 'node:crypto'

function serialize(value: unknown, stack: Set<object>): string {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value)
    case 'boolean':
      return value ? 'true' : 'false'
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('cannot serialize a non-finite number')
      return JSON.stringify(value)
    case 'object': {
      if (stack.has(value)) throw new TypeError('cannot serialize a circular value')
      stack.add(value)
      try {
        if (Array.isArray(value)) {
          return '[' + value.map(item => serialize(item, stack)).join(',') + ']'
        }
        const prototype = Object.getPrototypeOf(value)
        if (prototype !== Object.prototype && prototype !== null) {
          throw new TypeError('cannot serialize a non-plain object')
        }
        const record = value as Record<string, unknown>
        const keys = Object.keys(record).sort()
        return '{' + keys.map(key => JSON.stringify(key) + ':' + serialize(record[key], stack)).join(',') + '}'
      } finally {
        stack.delete(value)
      }
    }
    default:
      throw new TypeError('cannot serialize a value of type ' + typeof value)
  }
}

/** Deterministic JSON used for content hashes and stored metadata. */
export function canonicalStringify(value: unknown): string {
  return serialize(value, new Set<object>())
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}
