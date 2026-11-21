// The only way to reach org-scoped data (SPEC §5, CLAUDE.md "Data and tenancy").
//
// withOrg() opens a transaction, sets `app.org_id` for that transaction alone with
// set_config(…, true) and hands the callback an OrgScope. Repositories take an OrgScope, filter on
// its org id in every query, and RLS checks the same id underneath. The context is never set per
// session: Hyperdrive returns connections to a shared pool and resets session state.
import { sql } from 'drizzle-orm'
import type { Db } from './client.ts'

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

const ORG_ID = /^org_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const token = Symbol('OrgScope')

/** A transaction bound to one organisation. Only withOrg() can create one. */
export class OrgScope {
  readonly tx: Tx
  readonly orgId: string

  constructor (key: symbol, tx: Tx, orgId: string) {
    if (key !== token) throw new TypeError('OrgScope is created by withOrg() only')
    this.tx = tx
    this.orgId = orgId
  }
}

/** Runs `fn` in one transaction with the org context set; commits when it resolves. */
export async function withOrg<T> (db: Db, orgId: string, fn: (scope: OrgScope) => Promise<T>): Promise<T> {
  if (!ORG_ID.test(orgId)) throw new TypeError('withOrg needs an org id (org_<UUIDv7>)')
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.org_id', ${orgId}, true)`)
    return fn(new OrgScope(token, tx, orgId))
  })
}
