// RateLimiter port: one token bucket per (policy, key) in its own Durable Object, so a decision is
// exact, not per Cloudflare location. The maths is takeTokens in packages/core.
import { DurableObject } from 'cloudflare:workers'
import { assertTokenBucketPolicy, systemClock, takeTokens, type Clock, type RateLimitDecision, type RateLimiter, type TokenBucketPolicy, type TokenBucketState } from '@flussctrl/core'

const STATE_KEY = 'bucket'

/** The Durable Object. Its class name is part of its storage identity: never rename it. */
export class TokenBucketLimiter extends DurableObject {
  /** Overridable in tests only; production always uses the system clock. */
  protected clock: Clock = systemClock

  async consume (policy: TokenBucketPolicy, cost: number): Promise<RateLimitDecision> {
    const storage = this.ctx.storage
    const stored = await storage.get<TokenBucketState>(STATE_KEY)
    const { state, decision } = takeTokens(stored, policy, cost, this.clock.now())
    // Input and output gates make this read-modify-write atomic for one object.
    await storage.put(STATE_KEY, state)
    return decision
  }
}

/** A RateLimiter for one policy. Keys are opaque (`cli_…`, `dev_…`) and never logged. */
export function durableRateLimiter (
  namespace: DurableObjectNamespace<TokenBucketLimiter>,
  policy: TokenBucketPolicy,
  locationHint: DurableObjectLocationHint
): RateLimiter {
  assertTokenBucketPolicy(policy)
  return {
    async consume (key, cost = 1) {
      if (key.length === 0) throw new RangeError('rate limit key must not be empty')
      const stub = namespace.get(namespace.idFromName(`${policy.name}:${key}`), { locationHint })
      return await stub.consume(policy, cost)
    },
  }
}
