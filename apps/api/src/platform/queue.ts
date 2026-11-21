// Queue port on Cloudflare Queues: a producer over a Queue binding, and a consumer adapter that
// validates each body before the handler sees it.
import { assertQueueDelay, type Queue, type QueueHandler, type QueueMessage } from '@flussctrl/core'
import type { ZodType } from 'zod'

export function cloudflareQueue<T> (binding: globalThis.Queue<T>): Queue<T> {
  return {
    async send (body, options = {}) {
      assertQueueDelay(options.delaySeconds)
      await binding.send(body, { contentType: 'json', delaySeconds: options.delaySeconds })
    },
    async sendBatch (entries) {
      if (entries.length === 0) return
      for (const entry of entries) assertQueueDelay(entry.delaySeconds)
      await binding.sendBatch(entries.map((e) => ({ body: e.body, contentType: 'json', delaySeconds: e.delaySeconds })))
    },
  }
}

/**
 * Runs `handler` on the messages of a Cloudflare batch whose bodies match `schema`. A body that does
 * not match is retried rather than dropped, so after the queue's retry limit it reaches the dead
 * letter queue, where someone can see it; nothing is ever lost silently. If the handler throws,
 * every message it did not ack or retry is retried; so is
 * any message it left undecided when it returns.
 */
export async function consumeBatch<T> (batch: MessageBatch<unknown>, schema: ZodType<T>, handler: QueueHandler<T>): Promise<void> {
  const valid: QueueMessage<T>[] = []
  const undecided = new Set<Message<unknown>>()
  for (const message of batch.messages) {
    const body = schema.safeParse(message.body)
    if (!body.success) {
      message.retry()
      continue
    }
    undecided.add(message)
    valid.push({
      id: message.id,
      body: body.data,
      attempts: message.attempts,
      sentAt: message.timestamp.getTime(),
      ack: () => {
        undecided.delete(message)
        message.ack()
      },
      retry: (options = {}) => {
        assertQueueDelay(options.delaySeconds)
        undecided.delete(message)
        message.retry({ delaySeconds: options.delaySeconds })
      },
    })
  }
  if (valid.length === 0) return
  try {
    await handler(valid)
  } finally {
    // The port's default: a message the handler neither acked nor retried is retried, whether the
    // handler returned or threw. Explicit decisions are left as they are.
    for (const message of undecided) message.retry()
  }
}
