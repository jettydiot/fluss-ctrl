import { env } from 'cloudflare:test'
import { ApiError, isId } from '@flussctrl/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { app, createApp } from './index.ts'

const goodEnv = { ...env, ENVIRONMENT: 'dev' }

afterEach(() => {
  vi.restoreAllMocks()
})

describe('GET /health', () => {
  it('answers ok on a valid config', async () => {
    const res = await app.request('/health', {}, goodEnv)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })

  it('refuses to serve when the config is invalid', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await app.request('/health', {}, { ENVIRONMENT: 'prod' })
    expect(res.status).toBe(500)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('config_invalid'))
  })

  it('refuses to serve when the config is missing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await app.request('/health', {}, {})
    expect(res.status).toBe(500)
  })
})

describe('X-Request-Id', () => {
  it('is on a successful response, as a req_ id', async () => {
    const res = await app.request('/health', {}, goodEnv)
    expect(isId(res.headers.get('X-Request-Id'), 'req')).toBe(true)
  })

  it('is new for each request and ignores one the caller sends', async () => {
    const a = await app.request('/health', { headers: { 'X-Request-Id': 'req_spoofed' } }, goodEnv)
    const b = await app.request('/health', {}, goodEnv)
    expect(a.headers.get('X-Request-Id')).not.toBe('req_spoofed')
    expect(a.headers.get('X-Request-Id')).not.toBe(b.headers.get('X-Request-Id'))
  })

  it('is on errors and matches the problem body and the log line', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await app.request('/health', {}, {})
    const id = res.headers.get('X-Request-Id')
    expect(isId(id, 'req')).toBe(true)
    expect((await res.json() as { request_id: string }).request_id).toBe(id)
    expect(JSON.parse(String(log.mock.calls[0]?.[0])).request_id).toBe(id)
  })
})

describe('problem details', () => {
  it('renders an unknown route as not_found', async () => {
    const res = await app.request('/nope', {}, goodEnv)
    expect(res.status).toBe(404)
    expect(res.headers.get('Content-Type')).toContain('application/problem+json')
    expect(await res.json()).toEqual({
      type: 'https://docs.flussctrl.com/errors/not_found',
      title: 'Not found',
      status: 404,
      code: 'not_found',
      request_id: res.headers.get('X-Request-Id'),
    })
  })

  it('renders an unexpected error as internal_error without leaking its message', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const t = createApp()
    t.get('/test/boom', () => { throw new Error('db password is hunter2') })
    const res = await t.request('/test/boom', {}, goodEnv)
    expect(res.status).toBe(500)
    const text = await res.text()
    expect(text).toContain('"code":"internal_error"')
    expect(text).not.toContain('hunter2')
    expect(String(log.mock.calls[0]?.[0])).not.toContain('hunter2')
  })

  it('renders an ApiError with its code, status, detail and extensions', async () => {
    const t = createApp()
    t.get('/test/denied', () => { throw new ApiError('grant_invalid', { detail: 'No grant for this time', extensions: { command_id: 'cmd_x' } }) })
    const res = await t.request('/test/denied', {}, goodEnv)
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'grant_invalid', status: 403, detail: 'No grant for this time', command_id: 'cmd_x' })
  })
})
