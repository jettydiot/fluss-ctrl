import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { decodeEventCursor, encodeEventCursor, InvalidCursorError } from './cursor.ts'
import { testId } from './test/ids.ts'

const cursorArb = fc.record({
  recordedAt: fc.date({ min: new Date(Date.UTC(2020, 0, 1)), max: new Date(Date.UTC(2100, 0, 1)), noInvalidDate: true }),
  ms: fc.integer({ min: 0, max: 2 ** 47 }),
}).map(({ recordedAt, ms }) => ({ recordedAt, id: testId('evt', ms) }))

describe('event cursors', () => {
  it('round-trip', () => {
    fc.assert(fc.property(cursorArb, (c) => {
      const back = decodeEventCursor(encodeEventCursor(c))
      expect(back.id).toBe(c.id)
      expect(back.recordedAt.getTime()).toBe(c.recordedAt.getTime())
    }))
  })

  it('are URL-safe', () => {
    fc.assert(fc.property(cursorArb, (c) => {
      expect(encodeEventCursor(c)).toMatch(/^[A-Za-z0-9_-]+$/)
    }))
  })

  it('reject strings outside the base64url alphabet', () => {
    const bad = fc.string({ minLength: 1 }).filter((s) => /[^A-Za-z0-9_-]/.test(s))
    fc.assert(fc.property(bad, (s) => {
      expect(() => decodeEventCursor(s)).toThrow(InvalidCursorError)
    }))
  })

  it('reject any encoded JSON that is not a cursor', () => {
    const notCursor = fc.jsonValue().filter((v) => {
      const o = v as Record<string, unknown> | null
      return typeof o !== 'object' || o === null || typeof o.r !== 'string' || typeof o.i !== 'string'
    })
    fc.assert(fc.property(notCursor, (v) => {
      expect(() => decodeEventCursor(Buffer.from(JSON.stringify(v)).toString('base64url'))).toThrow(InvalidCursorError)
    }))
  })

  it('throw nothing but InvalidCursorError for arbitrary input', () => {
    fc.assert(fc.property(fc.string(), (s) => {
      let thrown: unknown
      try { decodeEventCursor(s) } catch (err) { thrown = err }
      // An arbitrary string almost never decodes; when it does it must round-trip.
      if (thrown === undefined) expect(encodeEventCursor(decodeEventCursor(s))).toBe(s)
      else expect(thrown).toBeInstanceOf(InvalidCursorError)
    }))
  })

  it('reject well-formed JSON with the wrong contents', () => {
    const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
    for (const bad of [null, 1, [], {}, { r: '2026-11-21T00:00:00.000Z' }, { r: 'x', i: testId('evt') },
      { r: '2026-11-21T00:00:00.000Z', i: testId('dev') }, { r: '2026-02-30T00:00:00.000Z', i: testId('evt') }]) {
      expect(() => decodeEventCursor(enc(bad))).toThrow(InvalidCursorError)
    }
    expect(() => decodeEventCursor(Buffer.from([0xff, 0xfe]).toString('base64url'))).toThrow(InvalidCursorError)
  })
})
