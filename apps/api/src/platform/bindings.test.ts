import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { ConfigError } from '../env.ts'
import { loadBindings } from './bindings.ts'
import { createPlatform } from './index.ts'

describe('loadBindings', () => {
  it('accepts the configured bindings and caches the result per env object', () => {
    expect(loadBindings(env)).toBe(loadBindings(env))
    expect(loadBindings(env).DO_LOCATION_HINT).toBe('enam')
  })

  it('names missing or wrong bindings without their values', () => {
    const bad = { ...env, CACHE: 'secret-looking-value', DO_LOCATION_HINT: 'mars' }
    try {
      loadBindings(bad)
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError)
      const issues = (err as ConfigError).issues.join(' ')
      expect(issues).toContain('CACHE')
      expect(issues).toContain('DO_LOCATION_HINT')
      expect(issues).not.toContain('secret-looking-value')
    }
    expect(() => loadBindings(null)).toThrow(ConfigError)
  })
})

describe('createPlatform', () => {
  it('builds every port from the env', async () => {
    const platform = createPlatform(env)
    expect(await platform.cache.get('nothing-here')).toBeUndefined()
    expect((await platform.rateLimiter({ name: 'platform', capacity: 1, refillPerSecond: 1 }).consume(crypto.randomUUID())).allowed).toBe(true)
  })
})
