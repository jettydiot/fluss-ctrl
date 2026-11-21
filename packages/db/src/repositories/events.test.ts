import { describe, expect, it } from 'vitest'
import { testId } from '../test/ids.ts'
import { clampLimit, DEFAULT_LIMIT, MAX_LIMIT, recordedAtFromId } from './events.ts'

describe('recordedAtFromId', () => {
  it('reads the UUIDv7 time', () => {
    const ms = Date.UTC(2026, 10, 21, 6, 56, 29, 123)
    expect(recordedAtFromId(testId('evt', ms)).toISOString()).toBe('2026-11-21T06:56:29.123Z')
  })

  it('refuses ids that are not events', () => {
    expect(() => recordedAtFromId(testId('cmd'))).toThrow(TypeError)
    expect(() => recordedAtFromId('evt_nope')).toThrow(TypeError)
  })
})

describe('clampLimit', () => {
  it('defaults anything that is not a finite number', () => {
    for (const v of [undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(clampLimit(v)).toBe(DEFAULT_LIMIT)
    }
  })

  it('keeps finite values between 1 and the maximum', () => {
    expect(clampLimit(0)).toBe(1)
    expect(clampLimit(-5)).toBe(1)
    expect(clampLimit(2.9)).toBe(2)
    expect(clampLimit(10_000)).toBe(MAX_LIMIT)
  })
})
