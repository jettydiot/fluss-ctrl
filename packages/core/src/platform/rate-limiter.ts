// The RateLimiter port (SPEC §21.3) and the token-bucket arithmetic every adapter shares. The
// Cloudflare adapter keeps one bucket per key in a Durable Object (apps/api/src/platform), so a
// decision is exact rather than per-location; this module is the maths, with no I/O.

/** A bucket holds up to `capacity` tokens and gains `refillPerSecond` tokens a second. */
export interface TokenBucketPolicy {
  /** Names the policy, so two policies never share a bucket for the same key (`client`, `device`). */
  readonly name: string
  readonly capacity: number
  readonly refillPerSecond: number
}

/** What is stored per bucket. */
export interface TokenBucketState {
  readonly tokens: number
  /** When `tokens` was last computed, in milliseconds since the Unix epoch. */
  readonly updatedAt: number
}

export interface RateLimitDecision {
  readonly allowed: boolean
  /** Whole tokens left after this call. */
  readonly remaining: number
  /** 0 when allowed; otherwise milliseconds until `cost` tokens will be there. */
  readonly retryAfterMs: number
}

export interface RateLimiter {
  /** Takes `cost` tokens (default 1) from the bucket for `key` under this limiter's policy. */
  consume(key: string, cost?: number): Promise<RateLimitDecision>
}

const POLICY_NAME = /^[a-z][a-z0-9_]{0,31}$/

/** Throws a RangeError unless the policy is usable. */
export function assertTokenBucketPolicy (policy: TokenBucketPolicy): void {
  if (!POLICY_NAME.test(policy.name)) throw new RangeError('policy name must be 1 to 32 of a-z, 0-9 and _, starting with a letter')
  if (!Number.isFinite(policy.capacity) || policy.capacity <= 0) throw new RangeError('capacity must be a positive finite number')
  if (!Number.isFinite(policy.refillPerSecond) || policy.refillPerSecond <= 0) throw new RangeError('refillPerSecond must be a positive finite number')
}

/** What a bucket that held `tokens` at `updatedAt` holds at `atMs`. A clock that went backwards refills nothing. */
function refill (tokens: number, updatedAt: number, policy: TokenBucketPolicy, atMs: number): number {
  const elapsedMs = Math.max(0, atMs - updatedAt)
  return Math.min(policy.capacity, tokens + (elapsedMs / 1000) * policy.refillPerSecond)
}

/**
 * Refills the bucket for the time since `state.updatedAt`, then takes `cost` tokens if they are
 * there. A missing state is a full bucket. A clock that went backwards refills nothing (it never
 * drains the bucket either). A cost above capacity can never succeed, so it throws.
 *
 * A refused call takes nothing, so it returns the stored bucket as it was (clamped into range): not
 * the refilled count, and not a new `updatedAt`. Every refill is then worked out in one step from
 * the last call that took tokens, and a refusal cannot move what an earlier refusal promised (#40).
 * The time a refused call saw is not kept either: if the clock steps back after one, the bucket
 * holds what the new reading says it has earned, which can be less than that call reported.
 *
 * When it refuses, the same call at `nowMs + retryAfterMs` or later is allowed, however many other
 * refused calls reach the bucket first. A call that is allowed in between takes tokens, and the
 * wait no longer holds: that is how a shared bucket works.
 */
export function takeTokens (
  state: TokenBucketState | undefined,
  policy: TokenBucketPolicy,
  cost: number,
  nowMs: number
): { state: TokenBucketState, decision: RateLimitDecision } {
  assertTokenBucketPolicy(policy)
  if (!Number.isFinite(cost) || cost <= 0 || cost > policy.capacity) throw new RangeError('cost must be positive and at most the capacity')
  if (!Number.isFinite(nowMs)) throw new RangeError('now must be finite')

  const start = state ? Math.min(policy.capacity, Math.max(0, state.tokens)) : policy.capacity
  const since = state ? state.updatedAt : nowMs
  const tokens = refill(start, since, policy, nowMs)

  if (tokens >= cost) {
    const left = tokens - cost
    return { state: { tokens: left, updatedAt: Math.max(nowMs, since) }, decision: { allowed: true, remaining: Math.floor(left), retryAfterMs: 0 } }
  }
  // After a clock step back, nothing refills until the clock passes `since` again, so add that gap.
  const rollbackMs = Math.max(0, since - nowMs)
  let retryAfterMs = rollbackMs + Math.ceil(((cost - tokens) / policy.refillPerSecond) * 1000)
  // That division is only an estimate of what refill will add: the two round differently, and the
  // estimate can land a millisecond short (#36). So hold it to the arithmetic the retry will run:
  // one refill from the stored bucket, which this call leaves as it was.
  // One step is enough for any real policy; doubling the step keeps the loop finite for every policy.
  for (let stepMs = 1; refill(start, since, policy, nowMs + retryAfterMs) < cost; stepMs *= 2) retryAfterMs += stepMs
  return { state: { tokens: start, updatedAt: since }, decision: { allowed: false, remaining: Math.floor(tokens), retryAfterMs } }
}
