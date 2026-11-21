// The event log of record, ingest dedup and the audit log (SPEC §5, §8.1, §14). Phase 0–1.
//
// `events` is range-partitioned monthly on `recorded_at` with a default partition. Drizzle Kit
// cannot express partitioning, so the `PARTITION BY` clause is added by hand in the migration
// (see migrations/README.md). Event lists page on `recorded_at`; `occurred_at` is device-reported
// data and never a cursor or partition key (SPEC §4, §5).
//
// Events keep no foreign keys other than the organisation: the log must outlive the rows it
// mentions (commands are deleted after 90 days, SPEC §14).
import { sql } from 'drizzle-orm'
import { check, index, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core'
import { jsonObject, oneOf, orgId, prefixedId, sameOrg, tstz } from './columns.ts'
import { AUDIT_ACTOR_TYPES, EVENT_METHODS, EVENT_RESULTS } from './enums.ts'
import { controllers } from './inventory.ts'
import { organisations } from './tenancy.ts'

export const events = pgTable('events', {
  id: text('id').notNull(),
  orgId: orgId().references(() => organisations.id),
  siteId: text('site_id'),
  deviceId: text('device_id'),
  subjectId: text('subject_id'),
  grantId: text('grant_id'),
  commandId: text('command_id'),
  type: text('type').notNull(),
  method: text('method', { enum: EVENT_METHODS }),
  result: text('result', { enum: EVENT_RESULTS }),
  occurredAt: tstz('occurred_at').notNull(),
  // The time inside the UUIDv7 id, so a lookup by id prunes to one partition (SPEC §5).
  recordedAt: tstz('recorded_at').notNull(),
  data: jsonObject('data'),
  pseudonymisedAt: tstz('pseudonymised_at'),
}, (t) => [
  primaryKey({ columns: [t.id, t.recordedAt], name: 'events_pkey' }),
  check('events_id_check', prefixedId(t.id, 'evt')),
  check('events_type_check', sql`${t.type} ~ '^[a-z_]+(\\.[a-z_]+)+$'`),
  check('events_method_check', oneOf(t.method, EVENT_METHODS)),
  check('events_result_check', oneOf(t.result, EVENT_RESULTS)),
  index('events_org_id_recorded_at_idx').on(t.orgId, t.recordedAt.desc()),
  index('events_device_id_recorded_at_idx').on(t.deviceId, t.recordedAt.desc()),
  index('events_subject_id_recorded_at_idx').on(t.subjectId, t.recordedAt.desc()),
  index('events_org_id_occurred_at_idx').on(t.orgId, t.occurredAt),
])

// Ingest dedup (SPEC §8.1): a re-poll after a failure inserts nothing. Pruned after 90 days.
// `org_id` is denormalised from the controller for RLS (Thomas, issue #5).
export const ingestedRefs = pgTable('ingested_refs', {
  orgId: orgId().references(() => organisations.id),
  controllerId: text('controller_id').notNull(),
  providerEventRef: text('provider_event_ref').notNull(),
  eventId: text('event_id').notNull(),
  recordedAt: tstz('recorded_at').notNull(),
}, (t) => [
  primaryKey({ columns: [t.orgId, t.controllerId, t.providerEventRef], name: 'ingested_refs_pkey' }),
  sameOrg('ingested_refs_controller_fk', t.orgId, t.controllerId, controllers.orgId, controllers.id),
  index('ingested_refs_recorded_at_idx').on(t.recordedAt),
])

// Console and ops actions (SPEC §3.4, §14). Append-only for the API role.
export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey(),
  orgId: orgId().references(() => organisations.id),
  actorType: text('actor_type', { enum: AUDIT_ACTOR_TYPES }).notNull(),
  actorId: text('actor_id').notNull(),
  action: text('action').notNull(),
  target: text('target'),
  reason: text('reason'),
  data: jsonObject('data'),
  at: tstz('at').notNull().defaultNow(),
}, (t) => [
  check('audit_log_actor_type_check', oneOf(t.actorType, AUDIT_ACTOR_TYPES)),
  index('audit_log_org_id_at_idx').on(t.orgId, t.at.desc()),
])
