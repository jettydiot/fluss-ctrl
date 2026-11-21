// Subjects, grants and commands (SPEC §2, §6, §7). Phase 0–1. The Phase 4 columns
// `grants.emergency_exempt` and `commands.emergency_id` are not created (SPEC §0).
import { sql } from 'drizzle-orm'
import { bigint, check, index, jsonb, pgTable, text, unique } from 'drizzle-orm/pg-core'
import { jsonObject, oneOf, orgId, prefixedId, sameOrg, timestamps, tstz } from './columns.ts'
import { COMMAND_ACTIONS, COMMAND_STATES, GRANT_STATUSES, GRANT_TYPES, VERIFICATION_LEVELS } from './enums.ts'
import { deviceGroups, devices, sites } from './inventory.ts'
import { clients, organisations } from './tenancy.ts'

export const subjects = pgTable('subjects', {
  id: text('id').primaryKey(),
  orgId: orgId().references(() => organisations.id),
  externalId: text('external_id').notNull(),
  name: text('name'),
  phone: text('phone'),
  email: text('email'),
  metadata: jsonObject('metadata'),
  erasedAt: tstz('erased_at'),
  ...timestamps,
}, (t) => [
  check('subjects_id_check', prefixedId(t.id, 'sub')),
  unique('subjects_org_id_id_key').on(t.orgId, t.id),
  unique('subjects_org_id_external_id_key').on(t.orgId, t.externalId),
])

export const grants = pgTable('grants', {
  id: text('id').primaryKey(),
  orgId: orgId().references(() => organisations.id),
  siteId: text('site_id').notNull(),
  subjectId: text('subject_id').notNull(),
  deviceId: text('device_id'),
  groupId: text('group_id'),
  type: text('type', { enum: GRANT_TYPES }).notNull(),
  // Computed on read; stored on transition for indexing (SPEC §6).
  status: text('status', { enum: GRANT_STATUSES }).notNull(),
  validFrom: tstz('valid_from'),
  validUntil: tstz('valid_until'),
  schedule: jsonb('schedule').$type<Record<string, unknown>>(),
  maxUses: bigint('max_uses', { mode: 'number' }),
  uses: bigint('uses', { mode: 'number' }).notNull().default(0),
  // `count_limited` uses reserved at accept and committed or released at the terminal state.
  reserved: bigint('reserved', { mode: 'number' }).notNull().default(0),
  delegation: jsonb('delegation').$type<Record<string, unknown>>(),
  parentGrantId: text('parent_grant_id'),
  providerSync: jsonb('provider_sync').$type<Record<string, unknown>>(),
  revokedAt: tstz('revoked_at'),
  revokedReason: text('revoked_reason'),
  createdByClientId: text('created_by_client_id'),
  ...timestamps,
}, (t) => [
  check('grants_id_check', prefixedId(t.id, 'grt')),
  check('grants_type_check', oneOf(t.type, GRANT_TYPES)),
  check('grants_status_check', oneOf(t.status, GRANT_STATUSES)),
  // A grant targets one device or one group, never both (SPEC §2, §5).
  check('grants_target_check', sql`(${t.deviceId} IS NULL) <> (${t.groupId} IS NULL)`),
  check('grants_uses_check', sql`${t.uses} >= 0 AND ${t.reserved} >= 0`),
  check('grants_max_uses_check', sql`${t.maxUses} IS NULL OR (${t.maxUses} > 0 AND ${t.uses} + ${t.reserved} <= ${t.maxUses})`),
  check('grants_window_check', sql`${t.validFrom} IS NULL OR ${t.validUntil} IS NULL OR ${t.validFrom} < ${t.validUntil}`),
  unique('grants_org_id_id_key').on(t.orgId, t.id),
  sameOrg('grants_site_fk', t.orgId, t.siteId, sites.orgId, sites.id),
  sameOrg('grants_subject_fk', t.orgId, t.subjectId, subjects.orgId, subjects.id),
  sameOrg('grants_device_fk', t.orgId, t.deviceId, devices.orgId, devices.id),
  sameOrg('grants_group_fk', t.orgId, t.groupId, deviceGroups.orgId, deviceGroups.id),
  sameOrg('grants_parent_grant_fk', t.orgId, t.parentGrantId, t.orgId, t.id),
  sameOrg('grants_created_by_client_fk', t.orgId, t.createdByClientId, clients.orgId, clients.id),
  index('grants_subject_id_idx').on(t.subjectId),
  index('grants_device_id_idx').on(t.deviceId),
  index('grants_group_id_idx').on(t.groupId),
  index('grants_parent_grant_id_idx').on(t.parentGrantId),
])

export const commands = pgTable('commands', {
  id: text('id').primaryKey(),
  orgId: orgId().references(() => organisations.id),
  siteId: text('site_id').notNull(),
  deviceId: text('device_id').notNull(),
  subjectId: text('subject_id'),
  grantId: text('grant_id'),
  action: text('action', { enum: COMMAND_ACTIONS }).notNull(),
  params: jsonObject('params'),
  state: text('state', { enum: COMMAND_STATES }).notNull(),
  verificationLevel: text('verification_level', { enum: VERIFICATION_LEVELS }).notNull(),
  requestedAt: tstz('requested_at').notNull(),
  sentAt: tstz('sent_at'),
  ackedAt: tstz('acked_at'),
  completedAt: tstz('completed_at'),
  outcome: jsonb('outcome').$type<Record<string, unknown>>(),
  errorCode: text('error_code'),
  idempotencyKey: text('idempotency_key'),
  clientId: text('client_id'),
  actor: jsonb('actor').$type<Record<string, unknown>>(),
  ...timestamps,
}, (t) => [
  check('commands_id_check', prefixedId(t.id, 'cmd')),
  check('commands_action_check', oneOf(t.action, COMMAND_ACTIONS)),
  check('commands_state_check', oneOf(t.state, COMMAND_STATES)),
  check('commands_verification_level_check', oneOf(t.verificationLevel, VERIFICATION_LEVELS)),
  // The command carries its own idempotency key for as long as it is retained (SPEC §1).
  unique('commands_org_id_client_id_idempotency_key_key').on(t.orgId, t.clientId, t.idempotencyKey),
  sameOrg('commands_site_fk', t.orgId, t.siteId, sites.orgId, sites.id),
  sameOrg('commands_device_fk', t.orgId, t.deviceId, devices.orgId, devices.id),
  sameOrg('commands_subject_fk', t.orgId, t.subjectId, subjects.orgId, subjects.id),
  sameOrg('commands_grant_fk', t.orgId, t.grantId, grants.orgId, grants.id),
  sameOrg('commands_client_fk', t.orgId, t.clientId, clients.orgId, clients.id),
  index('commands_org_id_requested_at_idx').on(t.orgId, t.requestedAt.desc()),
  index('commands_device_id_requested_at_idx').on(t.deviceId, t.requestedAt.desc()),
])
