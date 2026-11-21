import { ApiError, newId, problemDetails, type ErrorCode } from '@flussctrl/core'
import { Hono, type Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { ConfigError, loadEnv, type Env } from './env.ts'
import { log } from './log.ts'
import { createPlatform, type Platform } from './platform/index.ts'

export { DeviceCoordinator, TokenBucketLimiter } from './platform/index.ts'

type AppEnv = { Bindings: Record<string, unknown>, Variables: { config: Env, platform: Platform, requestId: string } }

function problem (c: Context<AppEnv>, code: ErrorCode, body = problemDetails(code, c.get('requestId'))): Response {
  return c.json(body, body.status as ContentfulStatusCode, { 'Content-Type': 'application/problem+json' })
}

/** Builds the Worker's app. Tests build their own to mount extra routes before the first request. */
export function createApp (): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  // Every response carries X-Request-Id (SPEC §1). It is always generated here, never taken from
  // the caller, so a log search by id finds only our own lines. This runs first so that even a
  // request refused for a bad config gets one.
  app.use('*', async (c, next) => {
    const requestId = newId('req')
    c.set('requestId', requestId)
    await next()
    c.res.headers.set('X-Request-Id', requestId)
  })

  // Refuse to serve on a bad config (SPEC §1): nothing, not even /health, answers until the
  // environment validates.
  app.use('*', async (c, next) => {
    c.set('config', loadEnv(c.env))
    // Routes reach queues, coordinators, the cache and rate limits only through these ports.
    c.set('platform', createPlatform(c.env))
    await next()
  })

  // Shallow liveness check, no auth (SPEC §4 Meta).
  app.get('/health', (c) => c.json({ status: 'ok' }))

  app.notFound((c) => problem(c, 'not_found'))

  app.onError((err, c) => {
    const requestId = c.get('requestId')
    if (err instanceof ApiError) {
      return problem(c, err.code, err.toProblem(requestId))
    }
    if (err instanceof ConfigError) {
      log('error', 'config_invalid', { request_id: requestId, issues: err.issues })
    } else {
      log('error', 'unhandled_error', { request_id: requestId, name: err.name })
    }
    return problem(c, 'internal_error')
  })

  return app
}

export const app = createApp()

export default app
