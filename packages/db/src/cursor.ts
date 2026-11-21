// Opaque keyset cursors (SPEC §1 pagination). A cursor names the last row of a page by its sort
// key; it never carries an offset. Event cursors follow `recorded_at` and never `occurred_at`
// (SPEC §4, §5).

export class InvalidCursorError extends Error {
  constructor () {
    super('Invalid cursor')
    this.name = 'InvalidCursorError'
  }
}

export interface EventCursor {
  readonly recordedAt: Date
  readonly id: string
}

const EVENT_ID = /^evt_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

function toBase64Url (text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function fromBase64Url (value: string): string {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new InvalidCursorError()
  const b64 = value.replaceAll('-', '+').replaceAll('_', '/')
  let bin: string
  try {
    bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  } catch {
    throw new InvalidCursorError()
  }
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new InvalidCursorError()
  }
}

export function encodeEventCursor (cursor: EventCursor): string {
  return toBase64Url(JSON.stringify({ r: cursor.recordedAt.toISOString(), i: cursor.id }))
}

/** Throws InvalidCursorError for anything encodeEventCursor() did not produce. */
export function decodeEventCursor (value: string): EventCursor {
  let parsed: unknown
  try {
    parsed = JSON.parse(fromBase64Url(value))
  } catch (err) {
    if (err instanceof InvalidCursorError) throw err
    throw new InvalidCursorError()
  }
  if (typeof parsed !== 'object' || parsed === null) throw new InvalidCursorError()
  const { r, i } = parsed as Record<string, unknown>
  if (typeof r !== 'string' || !ISO_MS.test(r) || typeof i !== 'string' || !EVENT_ID.test(i)) {
    throw new InvalidCursorError()
  }
  const recordedAt = new Date(r)
  if (Number.isNaN(recordedAt.getTime()) || recordedAt.toISOString() !== r) throw new InvalidCursorError()
  return { recordedAt, id: i }
}
