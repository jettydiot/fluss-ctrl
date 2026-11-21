import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { assertTokenBucketPolicy, takeTokens, type TokenBucketPolicy, type TokenBucketState } from './rate-limiter.ts'

const policy: TokenBucketPolicy = { name: 'client', capacity: 10, refillPerSecond: 2 }
const T0 = Date.UTC(2026, 10, 21)

describe('takeTokens', () => {
  it('starts full', () => {
    const { state, decision } = takeTokens(undefined, policy, 1, T0)
    expect(decision).toEqual({ allowed: true, remaining: 9, retryAfterMs: 0 })
    expect(state).toEqual({ tokens: 9, updatedAt: T0 })
  })

  it('refuses when empty and says how long to wait', () => {
    const empty: TokenBucketState = { tokens: 0, updatedAt: T0 }
    const { state, decision } = takeTokens(empty, policy, 3, T0)
    expect(decision).toEqual({ allowed: false, remaining: 0, retryAfterMs: 1500 })
    expect(state).toEqual(empty)
  })

  it('refills with elapsed time, up to capacity', () => {
    const empty: TokenBucketState = { tokens: 0, updatedAt: T0 }
    expect(takeTokens(empty, policy, 1, T0 + 500).decision.allowed).toBe(true)
    expect(takeTokens(empty, policy, 1, T0 + 499).decision.allowed).toBe(false)
    expect(takeTokens(empty, policy, 1, T0 + 3_600_000).decision.remaining).toBe(9)
  })

  it('refills nothing when the clock goes backwards, and keeps the later timestamp', () => {
    const { state, decision } = takeTokens({ tokens: 2, updatedAt: T0 }, policy, 1, T0 - 60_000)
    expect(decision.allowed).toBe(true)
    expect(state).toEqual({ tokens: 1, updatedAt: T0 })
  })

  it('includes the rollback gap in retryAfterMs, so waiting that long is enough', () => {
    const empty: TokenBucketState = { tokens: 0, updatedAt: T0 }
    const now = T0 - 60_000
    const { state, decision } = takeTokens(empty, policy, 1, now)
    expect(decision).toEqual({ allowed: false, remaining: 0, retryAfterMs: 60_500 })
    expect(takeTokens(state, policy, 1, now + decision.retryAfterMs).decision.allowed).toBe(true)
    expect(takeTokens(state, policy, 1, now + decision.retryAfterMs - 1).decision.allowed).toBe(false)
  })

  it('clamps a corrupt stored count into range', () => {
    expect(takeTokens({ tokens: 99, updatedAt: T0 }, policy, 1, T0).decision.remaining).toBe(9)
    expect(takeTokens({ tokens: -5, updatedAt: T0 }, policy, 1, T0).decision.allowed).toBe(false)
  })

  it.each([0, -1, 11, Number.NaN, Number.POSITIVE_INFINITY])('rejects cost %s', (cost) => {
    expect(() => takeTokens(undefined, policy, cost, T0)).toThrow(RangeError)
  })

  it('rejects a non-finite clock', () => {
    expect(() => takeTokens(undefined, policy, 1, Number.NaN)).toThrow(RangeError)
  })

  it('never lets more through than capacity plus refill over any run of calls', () => {
    fc.assert(fc.property(
      fc.record({ capacity: fc.integer({ min: 1, max: 50 }), refillPerSecond: fc.double({ min: 0.01, max: 20, noNaN: true }) }),
      fc.array(fc.record({ gapMs: fc.integer({ min: -2_000, max: 5_000 }), cost: fc.integer({ min: 1, max: 50 }) }), { maxLength: 60 }),
      ({ capacity, refillPerSecond }, calls) => {
        const p = { name: 'prop', capacity, refillPerSecond }
        let state: TokenBucketState | undefined
        let now = T0
        let taken = 0
        let latest = Number.NEGATIVE_INFINITY
        let first: number | undefined
        for (const call of calls) {
          now += call.gapMs
          latest = Math.max(latest, now)
          first ??= now
          const cost = Math.min(call.cost, capacity)
          const result = takeTokens(state, p, cost, now)
          state = result.state
          if (result.decision.allowed) taken += cost
          expect(result.state.tokens).toBeGreaterThanOrEqual(0)
          expect(result.state.tokens).toBeLessThanOrEqual(capacity)
          if (!result.decision.allowed) {
            // Waiting exactly retryAfterMs is always enough.
            expect(takeTokens(state, p, cost, now + result.decision.retryAfterMs).decision.allowed).toBe(true)
          }
        }
        // The bucket starts full at the first call; time only counts once the clock passes its high-water mark.
        const budget = first === undefined ? capacity : capacity + ((latest - first) / 1000) * refillPerSecond
        expect(taken).toBeLessThanOrEqual(budget + 1e-9)
      }
    ))
  })
})

describe('assertTokenBucketPolicy', () => {
  it('accepts a sane policy', () => {
    expect(() => assertTokenBucketPolicy(policy)).not.toThrow()
  })

  it.each([
    { ...policy, name: '' },
    { ...policy, name: 'Client' },
    { ...policy, name: 'a'.repeat(33) },
    { ...policy, capacity: 0 },
    { ...policy, capacity: Number.POSITIVE_INFINITY },
    { ...policy, refillPerSecond: 0 },
    { ...policy, refillPerSecond: Number.NaN },
  ])('rejects %o', (bad) => {
    expect(() => assertTokenBucketPolicy(bad)).toThrow(RangeError)
  })
})
