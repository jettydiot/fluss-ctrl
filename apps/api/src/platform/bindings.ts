// The Worker's Cloudflare bindings, validated before anything serves (SPEC §1). This folder is the
// only code that may touch a binding (SPEC §11 item 16): dependency-cruiser refuses `cloudflare:*`
// imports elsewhere and ESLint refuses the binding types elsewhere.
import { z } from 'zod'
import { ConfigError } from '../env.ts'
import type { DeviceCoordinator } from './coordinator.ts'
import type { TokenBucketLimiter } from './rate-limiter.ts'

/** Cloudflare's Durable Object location hints. `enam` sits beside Neon `us-east-1` (SPEC §9). */
const LOCATION_HINTS = ['wnam', 'enam', 'sam', 'weur', 'eeur', 'apac', 'apac-ne', 'apac-se', 'oc', 'afr', 'me'] as const

const hasMethods = (...names: string[]) => (value: unknown): boolean =>
  typeof value === 'object' && value !== null && names.every((n) => typeof (value as Record<string, unknown>)[n] === 'function')

const bindingsSchema = z.object({
  DEVICE_COORDINATOR: z.custom<DurableObjectNamespace<DeviceCoordinator>>(hasMethods('idFromName', 'get'), 'expected a Durable Object namespace'),
  RATE_LIMITER: z.custom<DurableObjectNamespace<TokenBucketLimiter>>(hasMethods('idFromName', 'get'), 'expected a Durable Object namespace'),
  CACHE: z.custom<KVNamespace>(hasMethods('get', 'put', 'delete'), 'expected a KV namespace'),
  // Where new Durable Objects are created. Configuration, never code (SPEC §9): the hint is honoured
  // only on an object's first get(), so it must be right before the first command reaches a device.
  DO_LOCATION_HINT: z.enum(LOCATION_HINTS),
})

export type Bindings = z.infer<typeof bindingsSchema>

const parsed = new WeakMap<object, Bindings>()

/** The validated bindings, or a ConfigError naming the missing or wrong ones (never their values). */
export function loadBindings (raw: unknown): Bindings {
  if (typeof raw !== 'object' || raw === null) throw new ConfigError(['env: missing'])
  const cached = parsed.get(raw)
  if (cached) return cached
  const result = bindingsSchema.safeParse(raw)
  if (!result.success) {
    throw new ConfigError(result.error.issues.map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`))
  }
  parsed.set(raw, result.data)
  return result.data
}
