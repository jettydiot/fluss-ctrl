import { describe, expect, it } from 'vitest'
import { assertCacheKey, assertCacheTtl, CACHE_MAX_KEY_BYTES, CACHE_MAX_TTL_SECONDS, CACHE_MIN_TTL_SECONDS } from './cache.ts'

describe('assertCacheTtl', () => {
  it.each([CACHE_MIN_TTL_SECONDS, 300, CACHE_MAX_TTL_SECONDS])('accepts %s', (ttl) => {
    expect(() => assertCacheTtl(ttl)).not.toThrow()
  })

  it.each([0, 59, 60.5, CACHE_MAX_TTL_SECONDS + 1, Number.NaN])('rejects %s', (ttl) => {
    expect(() => assertCacheTtl(ttl)).toThrow(RangeError)
  })
})

describe('assertCacheKey', () => {
  it('accepts a key up to the byte limit', () => {
    expect(() => assertCacheKey('status:dev_1')).not.toThrow()
    expect(() => assertCacheKey('a'.repeat(CACHE_MAX_KEY_BYTES))).not.toThrow()
  })

  it('counts bytes, not characters, and rejects empty keys', () => {
    expect(() => assertCacheKey('')).toThrow(RangeError)
    expect(() => assertCacheKey('é'.repeat(CACHE_MAX_KEY_BYTES / 2 + 1))).toThrow(RangeError)
  })
})
