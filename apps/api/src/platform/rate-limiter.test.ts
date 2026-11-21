import { manualClock, type ManualClock, type TokenBucketPolicy } from '@flussctrl/core'
import { env, evictDurableObject, runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { durableRateLimiter, type TokenBucketLimiter } from './rate-limiter.ts'

const policy: TokenBucketPolicy = { name: 'test', capacity: 3, refillPerSecond: 1 }
const freshKey = () => `cli_test_${crypto.randomUUID()}`

/** Gives the live object for `key` a manual clock, so real execution time never refills a bucket. */
async function useClock (policyName: string, key: string, clock: ManualClock): Promise<void> {
  const stub = env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(`${policyName}:${key}`))
  await runInDurableObject(stub, (instance: TokenBucketLimiter) => {
    (instance as unknown as { clock: ManualClock }).clock = clock
  })
}

describe('TokenBucketLimiter Durable Object', () => {
  it('allows up to capacity, then refuses with a retry-after, then refills as the clock moves', async () => {
    const clock = manualClock()
    const limiter = durableRateLimiter(env.RATE_LIMITER, policy, 'enam')
    const key = freshKey()
    await useClock(policy.name, key, clock)
    const results = []
    for (let i = 0; i < 4; i++) results.push(await limiter.consume(key))
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false])
    expect(results[3]?.retryAfterMs).toBe(1000)
    clock.advance(999)
    expect((await limiter.consume(key)).allowed).toBe(false)
    clock.advance(1)
    expect((await limiter.consume(key)).allowed).toBe(true)
  })

  it('serialises concurrent calls on one key: never more than capacity', async () => {
    const clock = manualClock()
    const limiter = durableRateLimiter(env.RATE_LIMITER, policy, 'enam')
    const key = freshKey()
    await useClock(policy.name, key, clock)
    const results = await Promise.all(Array.from({ length: 10 }, async () => await limiter.consume(key)))
    expect(results.filter((r) => r.allowed)).toHaveLength(3)
  })

  it('keeps separate buckets per key and per policy', async () => {
    const clock = manualClock()
    const other = { ...policy, name: 'other' }
    const key = freshKey()
    const a = durableRateLimiter(env.RATE_LIMITER, policy, 'enam')
    const b = durableRateLimiter(env.RATE_LIMITER, other, 'enam')
    await useClock(policy.name, key, clock)
    await useClock(other.name, key, clock)
    await a.consume(key, 3)
    expect((await a.consume(key)).allowed).toBe(false)
    expect((await b.consume(key)).allowed).toBe(true)
    expect((await a.consume(freshKey())).allowed).toBe(true)
  })

  it('keeps the bucket in storage across an eviction and refills from the stored time', async () => {
    const clock = manualClock()
    const limiter = durableRateLimiter(env.RATE_LIMITER, policy, 'enam')
    const key = freshKey()
    await useClock(policy.name, key, clock)
    await limiter.consume(key, 3)

    // The restarted instance has a fresh clock field; give it the same manual clock.
    await evictDurableObject(env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(`test:${key}`)))
    await useClock(policy.name, key, clock)
    expect((await limiter.consume(key)).allowed).toBe(false)

    clock.advance(2000)
    expect((await limiter.consume(key, 2)).allowed).toBe(true)
  })

  it('rejects a bad policy, cost or key', async () => {
    expect(() => durableRateLimiter(env.RATE_LIMITER, { ...policy, capacity: 0 }, 'enam')).toThrow(RangeError)
    const limiter = durableRateLimiter(env.RATE_LIMITER, policy, 'enam')
    await expect(limiter.consume('')).rejects.toThrow(RangeError)
    await expect((async () => await limiter.consume(freshKey(), 4))()).rejects.toThrow('cost')
  })
})
