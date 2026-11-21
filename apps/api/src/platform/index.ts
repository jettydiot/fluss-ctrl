// The platform module: Cloudflare implementations of the ports in packages/core (SPEC §21.3).
// Everything else in the API reaches them through `c.get('platform')`, never through a binding.
import type { Cache, Coordinator, RateLimiter, TokenBucketPolicy } from '@flussctrl/core'
import { loadBindings } from './bindings.ts'
import { kvCache } from './cache.ts'
import { durableCoordinator } from './coordinator.ts'
import { durableRateLimiter } from './rate-limiter.ts'

export { DeviceCoordinator } from './coordinator.ts'
export { TokenBucketLimiter } from './rate-limiter.ts'
export { cloudflareQueue, consumeBatch } from './queue.ts'

export interface Platform {
  readonly coordinator: Coordinator
  readonly cache: Cache
  rateLimiter(policy: TokenBucketPolicy): RateLimiter
}

/** Builds the platform from the Worker's env. Throws ConfigError if a binding is missing. */
export function createPlatform (rawEnv: unknown): Platform {
  const b = loadBindings(rawEnv)
  return {
    coordinator: durableCoordinator(b.DEVICE_COORDINATOR, b.DO_LOCATION_HINT),
    cache: kvCache(b.CACHE),
    rateLimiter: (policy) => durableRateLimiter(b.RATE_LIMITER, policy, b.DO_LOCATION_HINT),
  }
}
