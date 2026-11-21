// Webhook endpoints and the delivery outbox (SPEC §5, §8.2). Phase 0–1.
//
// `webhook_deliveries` is range-partitioned monthly on `created_at` (90-day retention) with a
// default partition; the `PARTITION BY` clause is added by hand in the migration. It carries
// `event_recorded_at` instead of a foreign key into the partitioned `events` table, so a lookup of
// its event still prunes to one partition. `org_id` is denormalised for RLS (Thomas, issue #5).
import { sql } from 'drizzle-orm'
import { bigint, check, index, pgTable, primaryKey, text, unique, uuid } from 'drizzle-orm/pg-core'
import { oneOf, orgId, prefixedId, sameOrg, timestamps, tstz } from './columns.ts'
import { WEBHOOK_DELIVERY_STATUSES, WEBHOOK_ENDPOINT_STATUSES } from './enums.ts'
import { organisations } from './tenancy.ts'

export const webhookEndpoints = pgTable('webhook_endpoints', {
  id: text('id').primaryKey(),
  orgId: orgId().references(() => organisations.id),
  url: text('url').notNull(),
  secretHash: text('secret_hash').notNull(),
  previousSecretHash: text('previous_secret_hash'),
  previousSecretExpiresAt: tstz('previous_secret_expires_at'),
  eventTypes: text('event_types').array().notNull().default(sql`'{}'::text[]`),
  status: text('status', { enum: WEBHOOK_ENDPOINT_STATUSES }).notNull().default('active'),
  failureCount: bigint('failure_count', { mode: 'number' }).notNull().default(0),
  description: text('description'),
  ...timestamps,
}, (t) => [
  check('webhook_endpoints_id_check', prefixedId(t.id, 'whk')),
  check('webhook_endpoints_status_check', oneOf(t.status, WEBHOOK_ENDPOINT_STATUSES)),
  unique('webhook_endpoints_org_id_id_key').on(t.orgId, t.id),
])

export const webhookDeliveries = pgTable('webhook_deliveries', {
  id: uuid('id').notNull(),
  orgId: orgId().references(() => organisations.id),
  endpointId: text('endpoint_id').notNull(),
  eventId: text('event_id').notNull(),
  eventRecordedAt: tstz('event_recorded_at').notNull(),
  attempt: bigint('attempt', { mode: 'number' }).notNull().default(0),
  status: text('status', { enum: WEBHOOK_DELIVERY_STATUSES }).notNull().default('pending'),
  responseCode: bigint('response_code', { mode: 'number' }),
  nextAttemptAt: tstz('next_attempt_at'),
  lastError: text('last_error'),
  deliveredAt: tstz('delivered_at'),
  ...timestamps,
}, (t) => [
  primaryKey({ columns: [t.id, t.createdAt], name: 'webhook_deliveries_pkey' }),
  check('webhook_deliveries_status_check', oneOf(t.status, WEBHOOK_DELIVERY_STATUSES)),
  index('webhook_deliveries_org_id_created_at_idx').on(t.orgId, t.createdAt.desc()),
  sameOrg('webhook_deliveries_endpoint_fk', t.orgId, t.endpointId, webhookEndpoints.orgId, webhookEndpoints.id),
  index('webhook_deliveries_endpoint_id_idx').on(t.endpointId),
  index('webhook_deliveries_event_id_idx').on(t.eventId),
  index('webhook_deliveries_pending_idx').on(t.nextAttemptAt).where(sql`${t.status} = 'pending'`),
])
