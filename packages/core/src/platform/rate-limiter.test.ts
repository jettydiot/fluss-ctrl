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

  it('takes nothing when it refuses: the stored bucket stays as it was, and remaining is what it holds now', () => {
    const stored: TokenBucketState = { tokens: 0.5, updatedAt: T0 }
    const { state, decision } = takeTokens(stored, policy, 3, T0 + 250)
    expect(decision).toEqual({ allowed: false, remaining: 1, retryAfterMs: 1000 })
    expect(state).toEqual(stored)
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

  it('does not keep the time a refused call saw: after a step back, the bucket is what the clock says it has earned', () => {
    const refused = takeTokens({ tokens: 0, updatedAt: T0 }, policy, 5, T0 + 1000)
    expect(refused.decision).toEqual({ allowed: false, remaining: 2, retryAfterMs: 1500 })
    // Back to T0 + 400: 0.8 tokens since the last call that took any, not the 2 seen at T0 + 1000.
    expect(takeTokens(refused.state, policy, 1, T0 + 400).decision).toEqual({ allowed: false, remaining: 0, retryAfterMs: 100 })
    expect(takeTokens(refused.state, policy, 1, T0 + 500).decision.allowed).toBe(true)
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

  // #36: the refill rounds differently from the estimate of the wait, so each of these was still a
  // hair under `cost` (4.999999999999999 and 1.9999999999999998 tokens) after exactly retryAfterMs.
  it.each([
    { capacity: 5, refillPerSecond: 0.01, calls: [[0, 3], [4411, 1], [2102, 1], [1481, 5]] },
    { capacity: 2, refillPerSecond: 0.01, calls: [[0, 1], [3273, 1], [-3, 1], [78, 1], [0, 2]] },
  ] as const)('allows a refused call after exactly retryAfterMs, and no sooner (capacity $capacity)', ({ capacity, refillPerSecond, calls }) => {
    const p = { name: 'regression', capacity, refillPerSecond }
    let state: TokenBucketState | undefined
    let now = T0
    let lastCost = 0
    let retryAfterMs = 0
    for (const [gapMs, cost] of calls) {
      now += gapMs
      const result = takeTokens(state, p, cost, now)
      state = result.state
      lastCost = cost
      retryAfterMs = result.decision.retryAfterMs
    }
    expect(retryAfterMs).toBeGreaterThan(0)
    expect(takeTokens(state, p, lastCost, now + retryAfterMs).decision.allowed).toBe(true)
    expect(takeTokens(state, p, lastCost, now + retryAfterMs - 1).decision.allowed).toBe(false)
  })

  it('still promises a long enough wait when one millisecond is below the precision of the wait', () => {
    // The estimate (about 222 million years) is short here too, and adding 1 ms to a number that
    // size leaves it unchanged, so a search that only ever stepped by 1 ms would never end.
    const glacial = { name: 'glacial', capacity: 7, refillPerSecond: 1e-15 }
    const { state, decision } = takeTokens({ tokens: 0, updatedAt: T0 }, glacial, 7, T0)
    expect(decision.allowed).toBe(false)
    expect(Number.isFinite(decision.retryAfterMs)).toBe(true)
    expect(takeTokens(state, glacial, 7, T0 + decision.retryAfterMs).decision.allowed).toBe(true)
  })

  // #40: every call used to store the refilled count, a refused one too, so a refusal part-way
  // through a wait split the refill into two rounded steps and the retry found 0.9999999999999999.
  it('keeps a refusal\'s wait through other refused calls on the same bucket', () => {
    const slow = { name: 'regression', capacity: 1, refillPerSecond: 0.01 }
    const first = takeTokens({ tokens: 0, updatedAt: T0 }, slow, 1, T0)
    expect(first.decision).toEqual({ allowed: false, remaining: 0, retryAfterMs: 100_000 })
    const second = takeTokens(first.state, slow, 1, T0 + 1)
    expect(second.decision.allowed).toBe(false)
    expect(takeTokens(second.state, slow, 1, T0 + 100_000).decision.allowed).toBe(true)
    expect(takeTokens(second.state, slow, 1, T0 + 99_999).decision.allowed).toBe(false)
  })

  // A fresh random run, then the seeds of the two CI runs that found the examples above (#36). The
  // seeds replay those runs only while the arbitraries below stay as they are.
  it.each([
    { run: 'a random seed', params: {} },
    { run: 'seed 815970254', params: { seed: 815970254 } },
    { run: 'seed -327760126', params: { seed: -327760126 } },
  ])('never lets more through than capacity plus refill over any run of calls ($run)', ({ params }) => {
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
        // Refusals whose wait still stands: no call has taken tokens since.
        let waiting: Array<{ cost: number, at: number }> = []
        for (const call of calls) {
          now += call.gapMs
          latest = Math.max(latest, now)
          first ??= now
          const cost = Math.min(call.cost, capacity)
          const stored = state
          const result = takeTokens(state, p, cost, now)
          state = result.state
          if (result.decision.allowed) {
            taken += cost
            waiting = []
          }
          expect(result.state.tokens).toBeGreaterThanOrEqual(0)
          expect(result.state.tokens).toBeLessThanOrEqual(capacity)
          if (!result.decision.allowed) {
            // Waiting exactly retryAfterMs is always enough.
            expect(takeTokens(state, p, cost, now + result.decision.retryAfterMs).decision.allowed).toBe(true)
            // A refused call leaves the bucket as it was stored (#40), so the wait of every earlier
            // refusal is still enough too, however many refused calls came after it.
            expect(state).toEqual(stored)
            for (const earlier of waiting) expect(takeTokens(state, p, earlier.cost, earlier.at).decision.allowed).toBe(true)
            waiting.push({ cost, at: now + result.decision.retryAfterMs })
          }
        }
        // The bucket starts full at the first call; time only counts once the clock passes its high-water mark.
        const budget = first === undefined ? capacity : capacity + ((latest - first) / 1000) * refillPerSecond
        expect(taken).toBeLessThanOrEqual(budget + 1e-9)
      }
    ), params)
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
