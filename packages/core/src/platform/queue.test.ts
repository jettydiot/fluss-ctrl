import { describe, expect, it } from 'vitest'
import { assertQueueDelay, QUEUE_MAX_DELAY_SECONDS } from './queue.ts'

describe('assertQueueDelay', () => {
  it.each([undefined, 0, 1, QUEUE_MAX_DELAY_SECONDS])('accepts %s', (delay) => {
    expect(() => assertQueueDelay(delay)).not.toThrow()
  })

  it.each([-1, 1.5, QUEUE_MAX_DELAY_SECONDS + 1, Number.NaN])('rejects %s', (delay) => {
    expect(() => assertQueueDelay(delay)).toThrow(RangeError)
  })
})
