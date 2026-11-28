// Migrations (SPEC §11 items 4 and 12): applied by a non-superuser owner in global setup; here,
// re-running them is a no-op and the partitions land where SPEC §5 says.
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { createDb } from './client.ts'
import { runMigrations } from './migrate.ts'

let owner: postgres.Sql

beforeAll(() => { owner = postgres(inject('ownerUrl'), { max: 1, onnotice: () => {} }) })
afterAll(async () => { await owner.end() })

describe('migrations', () => {
  it('re-run as a no-op', async () => {
    await expect(runMigrations(createDb(owner))).resolves.toBeUndefined()
    const [row] = await owner<{ n: number }[]>`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`
    expect(row!.n).toBe(3)
  })

  it('partition events by recorded_at and deliveries by created_at, monthly in UTC with a default', async () => {
    const rows = await owner<{ parent: string, key: string }[]>`
      SELECT c.relname AS parent, pg_get_partkeydef(c.oid) AS key
      FROM pg_class c WHERE c.relkind = 'p' ORDER BY 1`
    expect(rows).toEqual([
      { parent: 'events', key: 'RANGE (recorded_at)' },
      { parent: 'webhook_deliveries', key: 'RANGE (created_at)' },
    ])
    const [nov] = await owner<{ bound: string }[]>`
      SELECT pg_get_expr(c.relpartbound, c.oid) AS bound FROM pg_class c WHERE c.relname = 'events_y2026m11'`
    expect(nov!.bound).toBe("FOR VALUES FROM ('2026-11-01 00:00:00+00') TO ('2026-12-01 00:00:00+00')")
    const defaults = await owner<{ relname: string }[]>`
      SELECT relname FROM pg_class WHERE relispartition AND pg_get_expr(relpartbound, oid) = 'DEFAULT' ORDER BY 1`
    expect(defaults.map((r) => r.relname)).toEqual(['events_default', 'webhook_deliveries_default'])
  })

  it('create_month_partitions is idempotent', async () => {
    await owner`SELECT create_month_partitions('events', '2026-11-15', 2)`
    const [row] = await owner<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_class WHERE relkind = 'r' AND relname IN ('events_y2026m11', 'events_y2026m12')`
    expect(row!.n).toBe(2)
  })
})
