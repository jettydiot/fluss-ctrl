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

/**
 * Refills the bucket for the time since `state.updatedAt`, then takes `cost` tokens if they are
 * there. A missing state is a full bucket. A clock that went backwards refills nothing (it never
 * drains the bucket either). A cost above capacity can never succeed, so it throws.
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

  const elapsedMs = state ? Math.max(0, nowMs - state.updatedAt) : 0
  const start = state ? Math.min(policy.capacity, Math.max(0, state.tokens)) : policy.capacity
  const tokens = Math.min(policy.capacity, start + (elapsedMs / 1000) * policy.refillPerSecond)
  const updatedAt = state ? Math.max(nowMs, state.updatedAt) : nowMs

  if (tokens >= cost) {
    const left = tokens - cost
    return { state: { tokens: left, updatedAt }, decision: { allowed: true, remaining: Math.floor(left), retryAfterMs: 0 } }
  }
  // After a clock step back, nothing refills until the clock passes updatedAt again, so add that gap.
  const rollbackMs = Math.max(0, updatedAt - nowMs)
  const retryAfterMs = rollbackMs + Math.ceil(((cost - tokens) / policy.refillPerSecond) * 1000)
  return { state: { tokens, updatedAt }, decision: { allowed: false, remaining: Math.floor(tokens), retryAfterMs } }
}
