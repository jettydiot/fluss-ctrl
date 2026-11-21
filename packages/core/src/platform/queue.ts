// The Queue port (SPEC §21.3, PLAN decision 7): fire-and-forget background work such as webhook
// delivery and exports. Production uses Cloudflare Queues (apps/api/src/platform); nothing else may
// depend on a Queues binding. Never use a queue to defer a device command: a command that cannot
// run now fails fast (SPEC §21.5).

/** Cloudflare Queues caps a delay at 12 hours; the port keeps the same ceiling so adapters agree. */
export const QUEUE_MAX_DELAY_SECONDS = 43_200

export interface QueueSendOptions {
  /** Seconds before the message is delivered, 0 to {@link QUEUE_MAX_DELAY_SECONDS}. */
  readonly delaySeconds?: number
}

export interface QueueBatchEntry<T> extends QueueSendOptions {
  readonly body: T
}

/** The producer side. Bodies must survive structured cloning (plain JSON-like data). */
export interface Queue<T> {
  send(body: T, options?: QueueSendOptions): Promise<void>
  sendBatch(entries: readonly QueueBatchEntry<T>[]): Promise<void>
}

/** One delivered message. Call exactly one of `ack` or `retry`; neither means retry. */
export interface QueueMessage<T> {
  readonly id: string
  readonly body: T
  /** 1 on the first delivery. */
  readonly attempts: number
  /** When the message was sent, in milliseconds since the Unix epoch. */
  readonly sentAt: number
  ack(): void
  retry(options?: QueueSendOptions): void
}

/** The consumer side: handles one batch. A thrown error retries every message not yet acked. */
export type QueueHandler<T> = (messages: readonly QueueMessage<T>[]) => Promise<void>

/** Throws a RangeError unless `delaySeconds` is absent or a whole number of seconds in range. */
export function assertQueueDelay (delaySeconds: number | undefined): void {
  if (delaySeconds === undefined) return
  if (!Number.isInteger(delaySeconds) || delaySeconds < 0 || delaySeconds > QUEUE_MAX_DELAY_SECONDS) {
    throw new RangeError(`delaySeconds must be a whole number from 0 to ${QUEUE_MAX_DELAY_SECONDS}`)
  }
}
