// Sites, providers, controllers, devices and device groups (SPEC §2, §4, §5, §10). Phase 0–1.
// The Phase 4 columns `sites.emergency_config` and `devices.egress` are not created (SPEC §0).
import { sql } from 'drizzle-orm'
import { boolean, check, index, jsonb, pgTable, text, unique, uniqueIndex } from 'drizzle-orm/pg-core'
import { jsonObject, oneOf, orgId, prefixedId, sameOrg, timestamps, tstz } from './columns.ts'
import { CHANNEL_ROLES, DEVICE_KINDS } from './enums.ts'
import { organisations } from './tenancy.ts'

export const sites = pgTable('sites', {
  id: text('id').primaryKey(),
  orgId: orgId().references(() => organisations.id),
  name: text('name').notNull(),
  address: text('address'),
  timezone: text('timezone').notNull(),
  metadata: jsonObject('metadata'),
  archivedAt: tstz('archived_at'),
  ...timestamps,
}, (t) => [
  check('sites_id_check', prefixedId(t.id, 'site')),
  unique('sites_org_id_id_key').on(t.orgId, t.id),
])

// The global provider catalogue (SPEC §10.1). Not org-scoped: readable by the API role, written
// only by migrations and Fluss operations.
export const providers = pgTable('providers', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  onboardingMode: text('onboarding_mode').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  configSchema: jsonObject('config_schema'),
  ...timestamps,
}, (t) => [
  check('providers_code_check', sql`${t.code} ~ '^[a-z][a-z0-9_]*$'`),
])

export const deviceGroups = pgTable('device_groups', {
  id: text('id').primaryKey(),
  orgId: orgId().references(() => organisations.id),
  siteId: text('site_id').notNull(),
  name: text('name').notNull(),
  metadata: jsonObject('metadata'),
  archivedAt: tstz('archived_at'),
  ...timestamps,
}, (t) => [
  check('device_groups_id_check', prefixedId(t.id, 'grp')),
  unique('device_groups_org_id_id_key').on(t.orgId, t.id),
  sameOrg('device_groups_site_fk', t.orgId, t.siteId, sites.orgId, sites.id),
  index('device_groups_site_id_idx').on(t.siteId),
])

export const controllers = pgTable('controllers', {
  id: text('id').primaryKey(),
  orgId: orgId().references(() => organisations.id),
  siteId: text('site_id').notNull(),
  provider: text('provider').notNull().references(() => providers.code),
  providerRef: text('provider_ref').notNull(),
  serial: text('serial'),
  firmware: text('firmware'),
  online: boolean('online').notNull().default(false),
  lastSeenAt: tstz('last_seen_at'),
  diagnostics: jsonObject('diagnostics'),
  consent: jsonObject('consent'),
  metadata: jsonObject('metadata'),
  archivedAt: tstz('archived_at'),
  ...timestamps,
}, (t) => [
  check('controllers_id_check', prefixedId(t.id, 'ctl')),
  // Partial, so an archived controller can be claimed again (SPEC §5); a live duplicate is
  // `409 controller_already_claimed`. The index is global, so a claim conflict across orgs
  // surfaces as a unique violation even though RLS hides the other org's row.
  uniqueIndex('controllers_provider_ref_live_key').on(t.provider, t.providerRef).where(sql`${t.archivedAt} IS NULL`),
  unique('controllers_org_id_id_key').on(t.orgId, t.id),
  sameOrg('controllers_site_fk', t.orgId, t.siteId, sites.orgId, sites.id),
  index('controllers_site_id_idx').on(t.siteId),
])

export const devices = pgTable('devices', {
  id: text('id').primaryKey(),
  orgId: orgId().references(() => organisations.id),
  siteId: text('site_id').notNull(),
  controllerId: text('controller_id').notNull(),
  channel: text('channel').notNull(),
  channelRole: text('channel_role', { enum: CHANNEL_ROLES }),
  groupId: text('group_id'),
  name: text('name').notNull(),
  kind: text('kind', { enum: DEVICE_KINDS }).notNull().default('other'),
  controls: jsonObject('controls'),
  capabilities: jsonObject('capabilities'),
  lastStatus: jsonb('last_status').$type<Record<string, unknown>>(),
  metadata: jsonObject('metadata'),
  archivedAt: tstz('archived_at'),
  ...timestamps,
}, (t) => [
  check('devices_id_check', prefixedId(t.id, 'dev')),
  check('devices_channel_role_check', oneOf(t.channelRole, CHANNEL_ROLES)),
  check('devices_kind_check', oneOf(t.kind, DEVICE_KINDS)),
  unique('devices_org_id_controller_id_channel_key').on(t.orgId, t.controllerId, t.channel),
  unique('devices_org_id_id_key').on(t.orgId, t.id),
  sameOrg('devices_site_fk', t.orgId, t.siteId, sites.orgId, sites.id),
  sameOrg('devices_controller_fk', t.orgId, t.controllerId, controllers.orgId, controllers.id),
  sameOrg('devices_group_fk', t.orgId, t.groupId, deviceGroups.orgId, deviceGroups.id),
  index('devices_site_id_idx').on(t.siteId),
  index('devices_group_id_idx').on(t.groupId),
])
