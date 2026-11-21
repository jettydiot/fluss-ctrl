import { createExecutionContext, createMessageBatch, env, getQueueResult } from 'cloudflare:test'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { cloudflareQueue, consumeBatch } from './queue.ts'

const schema = z.object({ n: z.number() })

describe('cloudflareQueue', () => {
  it('sends single messages and batches to the binding', async () => {
    const send = vi.spyOn(env.TEST_QUEUE, 'send')
    const sendBatch = vi.spyOn(env.TEST_QUEUE, 'sendBatch')
    const queue = cloudflareQueue(env.TEST_QUEUE)
    await queue.send({ n: 1 }, { delaySeconds: 5 })
    await queue.sendBatch([{ body: { n: 2 } }, { body: { n: 3 }, delaySeconds: 1 }])
    await queue.sendBatch([])
    expect(send).toHaveBeenCalledWith({ n: 1 }, { contentType: 'json', delaySeconds: 5 })
    expect(sendBatch).toHaveBeenCalledTimes(1)
    expect(sendBatch.mock.calls[0]?.[0]).toEqual([
      { body: { n: 2 }, contentType: 'json', delaySeconds: undefined },
      { body: { n: 3 }, contentType: 'json', delaySeconds: 1 },
    ])
    vi.restoreAllMocks()
  })

  it('refuses a delay the queue cannot honour before sending anything', async () => {
    const queue = cloudflareQueue(env.TEST_QUEUE)
    await expect(queue.send({ n: 1 }, { delaySeconds: -1 })).rejects.toThrow(RangeError)
    await expect(queue.sendBatch([{ body: { n: 1 } }, { body: { n: 2 }, delaySeconds: 1e9 }])).rejects.toThrow(RangeError)
  })
})

describe('consumeBatch', () => {
  const messages = [
    { id: 'm1', timestamp: 1000, attempts: 1, body: { n: 1 } },
    { id: 'm2', timestamp: 2000, attempts: 2, body: { wrong: true } },
    { id: 'm3', timestamp: 3000, attempts: 1, body: { n: 3 } },
  ]

  it('hands valid bodies to the handler and retries bodies that do not match the schema', async () => {
    const batch = createMessageBatch<unknown>('fluss-ctrl-test', messages)
    const retryM3 = vi.spyOn(batch.messages[2] as Message<unknown>, 'retry')
    const seen: unknown[] = []
    await consumeBatch(batch, schema, async (msgs) => {
      for (const m of msgs) {
        seen.push({ id: m.id, body: m.body, attempts: m.attempts, sentAt: m.sentAt })
        if (m.id === 'm1') m.ack()
        else m.retry({ delaySeconds: 10 })
      }
    })
    expect(seen).toEqual([
      { id: 'm1', body: { n: 1 }, attempts: 1, sentAt: 1000 },
      { id: 'm3', body: { n: 3 }, attempts: 1, sentAt: 3000 },
    ])
    const result = await getQueueResult(batch, createExecutionContext())
    expect(result.explicitAcks).toEqual(['m1'])
    expect(result.retryMessages.map((m) => m.msgId).sort()).toEqual(['m2', 'm3'])
    expect(retryM3).toHaveBeenCalledWith({ delaySeconds: 10 })
    expect(result.retryBatch.retry).toBe(false)
  })

  it('retries every undecided message if the handler throws, keeping explicit acks', async () => {
    const batch = createMessageBatch<unknown>('fluss-ctrl-test', messages)
    await expect(consumeBatch(batch, schema, async (msgs) => {
      msgs[0]?.ack()
      throw new Error('boom')
    })).rejects.toThrow('boom')
    const result = await getQueueResult(batch, createExecutionContext())
    expect(result.explicitAcks).toEqual(['m1'])
    expect(result.retryMessages.map((m) => m.msgId).sort()).toEqual(['m2', 'm3'])
  })

  it('retries a message the handler left undecided, and keeps the one it acked', async () => {
    const batch = createMessageBatch<unknown>('fluss-ctrl-test', messages)
    await consumeBatch(batch, schema, async (msgs) => { msgs[0]?.ack() })
    const result = await getQueueResult(batch, createExecutionContext())
    expect(result.explicitAcks).toEqual(['m1'])
    expect(result.retryMessages.map((m) => m.msgId).sort()).toEqual(['m2', 'm3'])
    expect(result.retryBatch.retry).toBe(false)
  })

  it('does not call the handler when no body is valid', async () => {
    const batch = createMessageBatch<unknown>('fluss-ctrl-test', [messages[1] as typeof messages[number]])
    const handler = vi.fn()
    await consumeBatch(batch, schema, handler)
    expect(handler).not.toHaveBeenCalled()
  })
})
