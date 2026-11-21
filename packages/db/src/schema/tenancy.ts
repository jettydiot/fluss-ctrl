// Tenancy and machine auth (SPEC §1, §2, §3.1, §3.3, §5). Phase 0–1.
//
// Left out on purpose (Thomas, issue #5): the Better Auth tables arrive with console auth in
// Phase 2, and the billing columns on `organisations` (`plan`, `price_per_device_month`,
// `billing_provider`) arrive with metering in Phase 3 (SPEC §0).
import { sql } from 'drizzle-orm'
import { bigint, boolean, check, foreignKey, index, jsonb, pgTable, primaryKey, text, unique, uuid } from 'drizzle-orm/pg-core'
import { jsonObject, oneOf, orgId, prefixedId, sameOrg, timestamps, tstz } from './columns.ts'
import { CLIENT_ENVS, CLIENT_STATUSES, MEMBER_ROLES, ORG_STATUSES, REGIONS } from './enums.ts'

export const organisations = pgTable('organisations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  region: text('region', { enum: REGIONS }).notNull(),
  status: text('status', { enum: ORG_STATUSES }).notNull().default('trial'),
  retentionDays: bigint('retention_days', { mode: 'number' }).notNull().default(365),
  tokenEpoch: bigint('token_epoch', { mode: 'number' }).notNull().default(0),
  settings: jsonObject('settings'),
  // Set on the paired sandbox organisation (SPEC §1); one sandbox per organisation.
  sandboxOf: text('sandbox_of').unique(),
  ...timestamps,
}, (t) => [
  check('organisations_id_check', prefixedId(t.id, 'org')),
  check('organisations_region_check', oneOf(t.region, REGIONS)),
  check('organisations_status_check', oneOf(t.status, ORG_STATUSES)),
  check('organisations_retention_days_check', sql`${t.retentionDays} > 0`),
  check('organisations_sandbox_of_check', sql`${t.sandboxOf} <> ${t.id}`),
  foreignKey({ columns: [t.sandboxOf], foreignColumns: [t.id], name: 'organisations_sandbox_of_fk' }),
])

export const clients = pgTable('clients', {
  id: text('id').primaryKey(),
  orgId: orgId().references(() => organisations.id),
  name: text('name').notNull(),
  env: text('env', { enum: CLIENT_ENVS }).notNull(),
  defaultScopes: text('default_scopes').array().notNull().default(sql`'{}'::text[]`),
  status: text('status', { enum: CLIENT_STATUSES }).notNull().default('active'),
  createdBy: text('created_by'),
  allowAnonymousCommands: boolean('allow_anonymous_commands').notNull().default(false),
  ...timestamps,
}, (t) => [
  check('clients_id_check', prefixedId(t.id, 'cli')),
  check('clients_env_check', oneOf(t.env, CLIENT_ENVS)),
  check('clients_status_check', oneOf(t.status, CLIENT_STATUSES)),
  // Target of same-org foreign keys (columns.ts sameOrg); also serves lookups by org.
  unique('clients_org_id_id_key').on(t.orgId, t.id),
])

// `org_id` is denormalised from the client so the table carries the same RLS policy as the
// rest (Thomas, issue #5; SPEC §5).
export const clientSecrets = pgTable('client_secrets', {
  id: uuid('id').primaryKey(),
  orgId: orgId().references(() => organisations.id),
  clientId: text('client_id').notNull(),
  hash: text('hash').notNull(),
  salt: text('salt').notNull(),
  lastUsedAt: tstz('last_used_at'),
  revokedAt: tstz('revoked_at'),
  expiresAt: tstz('expires_at'),
  ...timestamps,
}, (t) => [
  sameOrg('client_secrets_client_fk', t.orgId, t.clientId, clients.orgId, clients.id),
  index('client_secrets_org_id_client_id_idx').on(t.orgId, t.clientId),
])

// Console membership (SPEC §3.3). `user_id` is the Better Auth user id; its table and foreign key
// arrive with console auth in Phase 2.
export const orgMembers = pgTable('org_members', {
  orgId: orgId().references(() => organisations.id),
  userId: text('user_id').notNull(),
  role: text('role', { enum: MEMBER_ROLES }).notNull(),
  ...timestamps,
}, (t) => [
  primaryKey({ columns: [t.orgId, t.userId], name: 'org_members_pkey' }),
  check('org_members_role_check', oneOf(t.role, MEMBER_ROLES)),
  index('org_members_user_id_idx').on(t.userId),
])

// Idempotency for non-command POSTs (SPEC §1): 24 h. `response` is null while the original
// request is still being accepted (`409 idempotency_in_progress`).
export const idempotencyKeys = pgTable('idempotency_keys', {
  orgId: orgId().references(() => organisations.id),
  clientId: text('client_id').notNull(),
  key: text('key').notNull(),
  requestHash: text('request_hash').notNull(),
  response: jsonb('response').$type<Record<string, unknown>>(),
  expiresAt: tstz('expires_at').notNull(),
  createdAt: tstz('created_at').notNull().defaultNow(),
}, (t) => [
  // org_id leads every key that holds a reference, so a clash cannot reveal another org's row.
  primaryKey({ columns: [t.orgId, t.clientId, t.key], name: 'idempotency_keys_pkey' }),
  sameOrg('idempotency_keys_client_fk', t.orgId, t.clientId, clients.orgId, clients.id),
  index('idempotency_keys_expires_at_idx').on(t.expiresAt),
])
