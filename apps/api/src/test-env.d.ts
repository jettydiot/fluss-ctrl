// Types for `env` from `cloudflare:test` in the Workers test pool.
import type { DeviceCoordinator, TokenBucketLimiter } from './platform/index.ts'

declare global {
  namespace Cloudflare {
    interface Env {
      ENVIRONMENT: string
      DO_LOCATION_HINT: DurableObjectLocationHint
      DEVICE_COORDINATOR: DurableObjectNamespace<DeviceCoordinator>
      RATE_LIMITER: DurableObjectNamespace<TokenBucketLimiter>
      CACHE: KVNamespace
      TEST_QUEUE: Queue<unknown>
    }
  }
}
