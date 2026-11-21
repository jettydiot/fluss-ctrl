// The event log (SPEC §5, §8.1). Lists are ordered by `recorded_at` (ingest order), which is also
// what the cursor follows, so a consumer tailing the log does not skip an event whose device time
// is late (SPEC §4). `occurred_at` is a filter only. Request rules (`since` required without
// another filter, the 31-day window) belong to the API layer, not here.
import { and, asc, eq, gte, lt, sql, type SQL } from 'drizzle-orm'
import { decodeEventCursor, encodeEventCursor } from '../cursor.ts'
import { events } from '../schema/index.ts'
import type { OrgScope } from '../scope.ts'

export type EventRow = typeof events.$inferSelect

export interface NewEvent {
  /** `evt_<UUIDv7>`; `recorded_at` is the time inside it (SPEC §5). */
  id: string
  type: string
  occurredAt: Date
  siteId?: string | null
  deviceId?: string | null
  subjectId?: string | null
  grantId?: string | null
  commandId?: string | null
  method?: EventRow['method']
  result?: EventRow['result']
  data?: Record<string, unknown>
}

export interface ListEventsQuery {
  limit?: number
  cursor?: string | null
  siteId?: string
  deviceId?: string
  subjectId?: string
  type?: string
  /** `recorded_at` lower bound, inclusive. */
  since?: Date
  /** `recorded_at` upper bound, exclusive. */
  until?: Date
  /** `occurred_at` lower bound, inclusive. */
  occurredSince?: Date
  /** `occurred_at` upper bound, exclusive. */
  occurredUntil?: Date
}

export interface Page<T> {
  data: T[]
  nextCursor: string | null
}

export const DEFAULT_LIMIT = 50
export const MAX_LIMIT = 200

/** Milliseconds encoded in a UUIDv7 under a prefix (mirrors idTimestamp in packages/core). */
export function recordedAtFromId (id: string): Date {
  const hex = id.slice(id.indexOf('_') + 1).replaceAll('-', '').slice(0, 12)
  const ms = Number.parseInt(hex, 16)
  if (!/^evt_[0-9a-f]{8}-[0-9a-f]{4}-7/.test(id) || !Number.isFinite(ms)) {
    throw new TypeError('Event id must be evt_<UUIDv7>')
  }
  return new Date(ms)
}

/** `?limit=` per SPEC §1: default 50, between 1 and 200. Anything not a finite number is the default. */
export function clampLimit (limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_LIMIT)
}

export async function insertEvent (scope: OrgScope, event: NewEvent): Promise<EventRow> {
  const [row] = await scope.tx.insert(events).values({
    ...event,
    orgId: scope.orgId,
    recordedAt: recordedAtFromId(event.id),
  }).returning()
  return row!
}

export async function listEvents (scope: OrgScope, query: ListEventsQuery = {}): Promise<Page<EventRow>> {
  const limit = clampLimit(query.limit)
  const where: (SQL | undefined)[] = [eq(events.orgId, scope.orgId)]
  if (query.cursor) {
    const c = decodeEventCursor(query.cursor)
    where.push(sql`(${events.recordedAt}, ${events.id}) > (${c.recordedAt.toISOString()}::timestamptz, ${c.id})`)
  }
  if (query.siteId !== undefined) where.push(eq(events.siteId, query.siteId))
  if (query.deviceId !== undefined) where.push(eq(events.deviceId, query.deviceId))
  if (query.subjectId !== undefined) where.push(eq(events.subjectId, query.subjectId))
  if (query.type !== undefined) where.push(eq(events.type, query.type))
  if (query.since !== undefined) where.push(gte(events.recordedAt, query.since))
  if (query.until !== undefined) where.push(lt(events.recordedAt, query.until))
  if (query.occurredSince !== undefined) where.push(gte(events.occurredAt, query.occurredSince))
  if (query.occurredUntil !== undefined) where.push(lt(events.occurredAt, query.occurredUntil))

  const rows = await scope.tx.select().from(events)
    .where(and(...where))
    .orderBy(asc(events.recordedAt), asc(events.id))
    .limit(limit + 1)

  const data = rows.slice(0, limit)
  const last = data.at(-1)
  const nextCursor = rows.length > limit && last ? encodeEventCursor({ recordedAt: last.recordedAt, id: last.id }) : null
  return { data, nextCursor }
}
