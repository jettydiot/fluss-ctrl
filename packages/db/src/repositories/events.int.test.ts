// Event paging (SPEC §4, §5; issue #5): lists follow recorded_at, never occurred_at, the cursor
// walks every event exactly once, and paging never crosses organisations.
import { sql } from 'drizzle-orm'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { createDb, type Db } from '../client.ts'
import { withOrg } from '../scope.ts'
import { testId } from '../test/ids.ts'
import { seedOrg, type SeededOrg } from '../test/seed.ts'
import { DEFAULT_LIMIT, insertEvent, listEvents, type EventRow } from './events.ts'

let client: postgres.Sql
let db: Db
let a: SeededOrg
let b: SeededOrg
const DAY = 86_400_000
const base = Date.UTC(2026, 10, 25) // 25 Nov 2026

beforeAll(async () => {
  client = postgres(inject('appUrl'), { max: 2, onnotice: () => {} })
  db = createDb(client)
  a = await seedOrg(db)
  b = await seedOrg(db)
  // Recorded across two monthly partitions and the default one (2031 has no monthly partition);
  // device time deliberately runs backwards, as a late or wrong device clock would.
  const recordedDays = [0, 1, 2, 10, 11, 40, 1900]
  await withOrg(db, a.orgId, async (scope) => {
    for (const [i, day] of recordedDays.entries()) {
      await insertEvent(scope, {
        id: testId('evt', base + day * DAY),
        type: 'access.granted',
        occurredAt: new Date(base - i * DAY),
        deviceId: i % 2 === 0 ? a.deviceId : null,
        method: 'api',
        result: 'ok',
      })
    }
  })
  await withOrg(db, b.orgId, (scope) => insertEvent(scope, { id: testId('evt', base + DAY / 2), type: 'access.denied', occurredAt: new Date(base) }))
})

afterAll(async () => { await client.end() })

async function walk (orgId: string, limit: number, extra: Parameters<typeof listEvents>[1] = {}): Promise<EventRow[]> {
  const out: EventRow[] = []
  let cursor: string | null = null
  do {
    const page = await withOrg(db, orgId, (scope) => listEvents(scope, { ...extra, limit, cursor }))
    expect(page.data.length).toBeLessThanOrEqual(limit)
    out.push(...page.data)
    cursor = page.nextCursor
  } while (cursor)
  return out
}

describe('listEvents', () => {
  it('orders by recorded_at and walks every event once, whatever the page size', async () => {
    for (const limit of [1, 2, 3, 50]) {
      const rows = await walk(a.orgId, limit)
      expect(rows).toHaveLength(8) // seven above plus the seeded one
      expect(new Set(rows.map((r) => r.id)).size).toBe(8)
      const recorded = rows.map((r) => r.recordedAt.getTime())
      expect(recorded).toEqual([...recorded].sort((x, y) => x - y))
      expect(rows.every((r) => r.orgId === a.orgId)).toBe(true)
    }
  })

  it('derives recorded_at from the id and lands rows in the right partition', async () => {
    const rows = await walk(a.orgId, 50)
    for (const r of rows) {
      expect(r.recordedAt.getTime()).toBe(Number.parseInt(r.id.slice(4).replaceAll('-', '').slice(0, 12), 16))
    }
    const parts = await withOrg(db, a.orgId, ({ tx }) =>
      tx.execute<{ p: string }>(sql`SELECT DISTINCT tableoid::regclass::text AS p FROM events ORDER BY 1`))
    expect(parts.map((r) => r.p)).toEqual(['events_default', 'events_y2026m11', 'events_y2026m12', 'events_y2027m01'])
  })

  it('filters on occurred_at without changing the order', async () => {
    // The seeded event uses the wall clock, so select the fixtures by type.
    const rows = await walk(a.orgId, 2, { type: 'access.granted', occurredSince: new Date(base - 2 * DAY), occurredUntil: new Date(base + 1) })
    expect(rows.map((r) => r.occurredAt.getTime())).toEqual([base, base - DAY, base - 2 * DAY])
  })

  it('filters on recorded_at and device', async () => {
    const rows = await walk(a.orgId, 2, { type: 'access.granted', since: new Date(base), until: new Date(base + 30 * DAY), deviceId: a.deviceId })
    expect(rows).toHaveLength(3)
  })

  it('treats a non-finite limit as the default, never as no limit', async () => {
    // More rows than the default page, so a dropped LIMIT would show.
    const c = await seedOrg(db)
    await withOrg(db, c.orgId, async (scope) => {
      for (let i = 0; i < DEFAULT_LIMIT + 10; i++) {
        await insertEvent(scope, { id: testId('evt', base + i * 1000), type: 'access.granted', occurredAt: new Date(base) })
      }
    })
    // Capture the SQL the driver sends, so the test sees the LIMIT itself, not just the page.
    const sent: { query: string, parameters: unknown[] }[] = []
    const traced = postgres(inject('appUrl'), { max: 1, onnotice: () => {}, debug: (_conn, query, parameters) => { sent.push({ query, parameters }) } })
    try {
      const tracedDb = createDb(traced)
      for (const limit of [Number.NaN, Number.POSITIVE_INFINITY]) {
        sent.length = 0
        const page = await withOrg(tracedDb, c.orgId, (scope) => listEvents(scope, { limit }))
        expect(page.data).toHaveLength(DEFAULT_LIMIT)
        expect(page.nextCursor).not.toBeNull()
        const select = sent.find((q) => q.query.includes('from "events"'))
        expect(select?.query).toMatch(/limit \$\d+$/)
        expect(Number(select?.parameters.at(-1))).toBe(DEFAULT_LIMIT + 1)
      }
    } finally {
      await traced.end()
    }
  })

  it('returns a null cursor on the last page and rejects a forged one', async () => {
    const page = await withOrg(db, a.orgId, (scope) => listEvents(scope, { limit: 200 }))
    expect(page.nextCursor).toBeNull()
    await expect(withOrg(db, a.orgId, (scope) => listEvents(scope, { cursor: 'not-a-cursor' }))).rejects.toThrow('Invalid cursor')
  })

  it('never shows another organisation, even with its cursor', async () => {
    const aPage = await withOrg(db, a.orgId, (scope) => listEvents(scope, { limit: 1 }))
    expect(aPage.nextCursor).not.toBeNull()
    const bPage = await withOrg(db, b.orgId, (scope) => listEvents(scope, { limit: 200, cursor: aPage.nextCursor }))
    expect(bPage.data.length).toBeGreaterThan(0)
    expect(bPage.data.every((r) => r.orgId === b.orgId)).toBe(true)
    const rows = await walk(b.orgId, 1)
    expect(rows.map((r) => r.type).sort()).toEqual(['access.denied', 'command.requested'])
  })
})
