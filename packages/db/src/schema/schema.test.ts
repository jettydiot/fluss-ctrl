// The schema holds exactly the Phase 0–1 tables of SPEC §0 and none of the later-phase columns.
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import * as schema from './index.ts'

const tables = (Object.values(schema) as unknown[]).filter((v): v is PgTable => v instanceof PgTable).map((t) => getTableConfig(t))

// SPEC §0 "Tables by phase", 0–1. `members` is `org_members` only until Phase 2 (Better Auth).
const PHASE_0_1 = [
  'organisations', 'clients', 'client_secrets', 'org_members', 'sites', 'providers', 'controllers',
  'devices', 'device_groups', 'subjects', 'grants', 'commands', 'events', 'ingested_refs',
  'webhook_endpoints', 'webhook_deliveries', 'idempotency_keys', 'audit_log',
]

// SPEC §0 later-phase columns, plus the billing columns deferred to Phase 3 (issue #5).
const LATER = {
  sites: ['emergency_config'],
  devices: ['egress'],
  grants: ['emergency_exempt'],
  commands: ['emergency_id'],
  organisations: ['plan', 'price_per_device_month', 'billing_provider'],
} as Record<string, string[]>

describe('schema', () => {
  it('has exactly the Phase 0–1 tables', () => {
    expect(tables.map((t) => t.name).sort()).toEqual([...PHASE_0_1].sort())
  })

  it('has no later-phase column', () => {
    for (const t of tables) {
      const names = t.columns.map((c) => c.name)
      for (const col of LATER[t.name] ?? []) expect(names, `${t.name}.${col}`).not.toContain(col)
    }
  })

  it('puts org_id on every table except the organisation itself and the provider catalogue', () => {
    const without = tables.filter((t) => !t.columns.some((c) => c.name === 'org_id')).map((t) => t.name).sort()
    expect(without).toEqual(['organisations', 'providers'])
  })

  it('pages events on recorded_at: it is in the primary key, and occurred_at is in no key', () => {
    const events = tables.find((t) => t.name === 'events')!
    const pk = events.primaryKeys[0]!.columns.map((c) => c.name)
    expect(pk).toEqual(['id', 'recorded_at'])
    expect(pk).not.toContain('occurred_at')
  })
})
