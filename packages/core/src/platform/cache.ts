// The Cache port (SPEC §21.3). Production uses Workers KV (apps/api/src/platform), which is
// eventually consistent: a write can take up to a minute to be seen everywhere, and a delete too.
// So a cache entry may be stale. Use it only for data that is safe to serve stale (cached device
// status, the provider list), never for auth, grants, devices or commands (SPEC §9, CLAUDE.md).

/** Workers KV refuses an expiry under 60 seconds; the port keeps the same floor so adapters agree. */
export const CACHE_MIN_TTL_SECONDS = 60
/** A day. Anything that should live longer belongs in Postgres. */
export const CACHE_MAX_TTL_SECONDS = 86_400

export interface CachePutOptions {
  /** Seconds until the entry expires, {@link CACHE_MIN_TTL_SECONDS} to {@link CACHE_MAX_TTL_SECONDS}. */
  readonly ttlSeconds: number
}

/** A JSON value cache. Keys are opaque strings; callers prefix them by purpose (`status:dev_…`). */
export interface Cache {
  /** The stored value, or undefined if absent or expired. The caller validates the shape. */
  get(key: string): Promise<unknown>
  put(key: string, value: unknown, options: CachePutOptions): Promise<void>
  delete(key: string): Promise<void>
}

/** Workers KV limits keys to 512 bytes. */
export const CACHE_MAX_KEY_BYTES = 512

/** Throws unless the key is non-empty and fits {@link CACHE_MAX_KEY_BYTES} in UTF-8. */
export function assertCacheKey (key: string): void {
  const bytes = new TextEncoder().encode(key).length
  if (bytes === 0 || bytes > CACHE_MAX_KEY_BYTES) {
    throw new RangeError(`cache keys must be 1 to ${CACHE_MAX_KEY_BYTES} bytes`)
  }
}

/** Throws unless the TTL is a whole number of seconds in range. */
export function assertCacheTtl (ttlSeconds: number): void {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < CACHE_MIN_TTL_SECONDS || ttlSeconds > CACHE_MAX_TTL_SECONDS) {
    throw new RangeError(`ttlSeconds must be a whole number from ${CACHE_MIN_TTL_SECONDS} to ${CACHE_MAX_TTL_SECONDS}`)
  }
}
