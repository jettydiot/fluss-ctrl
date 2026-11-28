// The webhook signing secret is stored encrypted, not hashed (SPEC §5, §8.2; issue #28, ADR-0005).
// Migration 0002 is the expand step, so two shapes of row must be writable through the API role:
// this release's (ciphertext only) and the previous release's (hash only), because old and new
// Worker versions run side by side during a rollout (SPEC §11 item 4).
import { sql } from 'drizzle-orm'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { createDb, type Db } from './client.ts'
import * as s from './schema/index.ts'
import { withOrg } from './scope.ts'
import { testId } from './test/ids.ts'
import { sealedForTest, seedOrg, type SeededOrg } from './test/seed.ts'

let client: postgres.Sql
let owner: postgres.Sql
let db: Db
let org: SeededOrg

// Stand-ins for the envelope of SPEC §5 "Encryption". The database stores it as opaque text.
const SEALED_A = sealedForTest('a')
const SEALED_B = sealedForTest('b')

beforeAll(async () => {
  client = postgres(inject('appUrl'), { max: 1, onnotice: () => {} })
  owner = postgres(inject('ownerUrl'), { max: 1, onnotice: () => {} })
  db = createDb(client)
  org = await seedOrg(db)
})

afterAll(async () => {
  await client.end()
  await owner.end()
})

describe('webhook_endpoints signing secret columns', () => {
  it('has the encrypted columns, and an insert may leave every secret column out while both shapes are live', async () => {
    const rows = await owner<{ name: string, type: string, nullable: string, fallback: string | null }[]>`
      SELECT column_name AS name, data_type AS type, is_nullable AS nullable, column_default AS fallback
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'webhook_endpoints' AND column_name LIKE '%secret%'
      ORDER BY column_name`
    expect(rows.map((r) => ({ ...r }))).toEqual([
      { name: 'previous_secret_enc', type: 'text', nullable: 'YES', fallback: null },
      { name: 'previous_secret_expires_at', type: 'timestamp with time zone', nullable: 'YES', fallback: null },
      { name: 'previous_secret_hash', type: 'text', nullable: 'YES', fallback: null },
      { name: 'secret_enc', type: 'text', nullable: 'YES', fallback: null },
      // Still NOT NULL, so a reader of the old shape never meets a NULL; the default is what
      // lets new code stop writing it.
      { name: 'secret_hash', type: 'text', nullable: 'NO', fallback: "''::text" },
    ])
  })

  it('accepts an endpoint that carries only the encrypted secret', async () => {
    const id = testId('whk')
    const [row] = await withOrg(db, org.orgId, async ({ tx, orgId }) =>
      tx.insert(s.webhookEndpoints).values({ id, orgId, url: 'https://hooks.example.com/new', secretEnc: SEALED_A }).returning())
    expect(row).toMatchObject({ id, secretEnc: SEALED_A, previousSecretEnc: null, previousSecretExpiresAt: null, secretHash: '', previousSecretHash: null })
  })

  it('still accepts the previous release\'s insert, which writes only secret_hash', async () => {
    const id = testId('whk')
    // Raw SQL on purpose: the statement of a Worker version that has never heard of secret_enc.
    const rows = await withOrg(db, org.orgId, async ({ tx, orgId }) =>
      tx.execute<{ secret_hash: string | null, secret_enc: string | null }>(sql`
        INSERT INTO webhook_endpoints (id, org_id, url, secret_hash)
        VALUES (${id}, ${orgId}, 'https://hooks.example.com/old', 'h')
        RETURNING secret_hash, secret_enc`))
    expect(rows[0]).toEqual({ secret_hash: 'h', secret_enc: null })
  })

  it('rotates in one statement: the current secret becomes the previous one, with an expiry', async () => {
    const id = testId('whk')
    const expiresAt = new Date('2026-12-01T10:00:00Z')
    const [row] = await withOrg(db, org.orgId, async ({ tx, orgId }) => {
      await tx.insert(s.webhookEndpoints).values({ id, orgId, url: 'https://hooks.example.com/rotate', secretEnc: SEALED_A })
      return tx.update(s.webhookEndpoints)
        .set({ previousSecretEnc: sql`${s.webhookEndpoints.secretEnc}`, secretEnc: SEALED_B, previousSecretExpiresAt: expiresAt })
        .where(sql`${s.webhookEndpoints.orgId} = ${orgId} AND ${s.webhookEndpoints.id} = ${id}`)
        .returning()
    })
    expect(row).toMatchObject({ secretEnc: SEALED_B, previousSecretEnc: SEALED_A, previousSecretExpiresAt: expiresAt })
  })
})
