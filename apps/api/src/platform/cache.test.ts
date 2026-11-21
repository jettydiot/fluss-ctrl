import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { kvCache } from './cache.ts'

describe('kvCache', () => {
  const cache = kvCache(env.CACHE)

  it('round-trips JSON values with a TTL', async () => {
    await cache.put('status:dev_1', { state: 'open', online: true }, { ttlSeconds: 60 })
    expect(await cache.get('status:dev_1')).toEqual({ state: 'open', online: true })
    const { metadata, value } = await env.CACHE.getWithMetadata('status:dev_1')
    expect(value).not.toBeNull()
    expect(metadata).toBeNull()
  })

  it('sets the KV expiry from ttlSeconds', async () => {
    const before = Math.floor(Date.now() / 1000)
    await cache.put('ttl:key', 1, { ttlSeconds: 120 })
    const listed = await env.CACHE.list({ prefix: 'ttl:' })
    const expiration = listed.keys[0]?.expiration ?? 0
    expect(expiration).toBeGreaterThanOrEqual(before + 119)
    expect(expiration).toBeLessThanOrEqual(before + 121)
  })

  it('round-trips a cached null as null, not as a miss', async () => {
    await cache.put('null:key', null, { ttlSeconds: 60 })
    expect(await cache.get('null:key')).toBeNull()
  })

  it('returns undefined for a missing key and after delete', async () => {
    expect(await cache.get('missing')).toBeUndefined()
    await cache.put('gone', 'x', { ttlSeconds: 60 })
    await cache.delete('gone')
    expect(await cache.get('gone')).toBeUndefined()
  })

  it('refuses TTLs KV cannot honour, bad keys and undefined values', async () => {
    await expect(cache.put('k', 1, { ttlSeconds: 30 })).rejects.toThrow(RangeError)
    await expect(cache.put('', 1, { ttlSeconds: 60 })).rejects.toThrow(RangeError)
    await expect(cache.get('x'.repeat(513))).rejects.toThrow(RangeError)
    await expect(cache.delete('')).rejects.toThrow(RangeError)
    await expect(cache.put('k', undefined, { ttlSeconds: 60 })).rejects.toThrow(TypeError)
  })
})
