// One row in every org-scoped table for an organisation, written through the API role with the
// org context set, as the API would.
import { sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import type { Db } from '../client.ts'
import { recordedAtFromId } from '../repositories/events.ts'
import * as s from '../schema/index.ts'
import { withOrg } from '../scope.ts'
import { testId } from './ids.ts'

export interface SeededOrg {
  orgId: string
  clientId: string
  siteId: string
  controllerId: string
  deviceId: string
  eventId: string
  endpointId: string
}

/** Every table that carries `org_id`, i.e. every Phase 0–1 table except the two below. */
export const ORG_SCOPED_TABLES = [
  'clients', 'client_secrets', 'org_members', 'idempotency_keys', 'sites', 'device_groups',
  'controllers', 'devices', 'subjects', 'grants', 'commands', 'events', 'ingested_refs',
  'audit_log', 'webhook_endpoints', 'webhook_deliveries',
] as const

export async function seedOrg (db: Db): Promise<SeededOrg> {
  const orgId = testId('org')
  const ids = {
    orgId,
    clientId: testId('cli'),
    siteId: testId('site'),
    controllerId: testId('ctl'),
    deviceId: testId('dev'),
    eventId: testId('evt'),
    endpointId: testId('whk'),
  }
  const groupId = testId('grp')
  const subjectId = testId('sub')
  const grantId = testId('grt')
  const commandId = testId('cmd')
  const now = new Date()
  const eventRecordedAt = recordedAtFromId(ids.eventId)

  await withOrg(db, orgId, async ({ tx }) => {
    await tx.insert(s.organisations).values({ id: orgId, name: 'Test org', region: 'za' })
    await tx.insert(s.clients).values({ id: ids.clientId, orgId, name: 'Test client', env: 'live' })
    await tx.insert(s.clientSecrets).values({ id: randomUUID(), orgId, clientId: ids.clientId, hash: 'h', salt: 's' })
    await tx.insert(s.orgMembers).values({ orgId, userId: `user_${orgId}`, role: 'owner' })
    await tx.insert(s.idempotencyKeys).values({ orgId, clientId: ids.clientId, key: randomUUID(), requestHash: 'r', expiresAt: now })
    await tx.insert(s.sites).values({ id: ids.siteId, orgId, name: 'Site', timezone: 'Africa/Johannesburg' })
    await tx.insert(s.deviceGroups).values({ id: groupId, orgId, siteId: ids.siteId, name: 'Main entrance' })
    await tx.insert(s.controllers).values({ id: ids.controllerId, orgId, siteId: ids.siteId, provider: 'simulator', providerRef: ids.controllerId })
    await tx.insert(s.devices).values({ id: ids.deviceId, orgId, siteId: ids.siteId, controllerId: ids.controllerId, channel: 'main', name: 'Gate', kind: 'gate' })
    await tx.insert(s.subjects).values({ id: subjectId, orgId, externalId: 'resident-1' })
    await tx.insert(s.grants).values({ id: grantId, orgId, siteId: ids.siteId, subjectId, deviceId: ids.deviceId, type: 'permanent', status: 'active' })
    await tx.insert(s.commands).values({
      id: commandId,
      orgId,
      siteId: ids.siteId,
      deviceId: ids.deviceId,
      subjectId,
      grantId,
      clientId: ids.clientId,
      action: 'trigger',
      state: 'queued',
      verificationLevel: 'status',
      requestedAt: now,
      idempotencyKey: randomUUID(),
    })
    await tx.insert(s.events).values({ id: ids.eventId, orgId, type: 'command.requested', occurredAt: now, recordedAt: eventRecordedAt, commandId })
    await tx.insert(s.ingestedRefs).values({ orgId, controllerId: ids.controllerId, providerEventRef: 'ref-1', eventId: ids.eventId, recordedAt: now })
    await tx.insert(s.auditLog).values({ id: randomUUID(), orgId, actorType: 'client', actorId: ids.clientId, action: 'test.seed' })
    await tx.insert(s.webhookEndpoints).values({ id: ids.endpointId, orgId, url: 'https://hooks.example.com/x', secretHash: 'h', eventTypes: ['command.requested'] })
    await tx.insert(s.webhookDeliveries).values({ id: randomUUID(), orgId, endpointId: ids.endpointId, eventId: ids.eventId, eventRecordedAt })
  })
  return ids
}

/** Row counts per table, as the given transaction sees them. */
export async function countRows (tx: { execute: Db['execute'] }, table: string): Promise<number> {
  const rows = await tx.execute<{ n: number }>(sql.raw(`SELECT count(*)::int AS n FROM "${table}"`))
  return rows[0]!.n
}

/** The Postgres error behind a rejected query (Drizzle wraps it), as `message (constraint)`. */
export async function dbError (work: Promise<unknown>): Promise<string> {
  try {
    await work
  } catch (err) {
    const cause = (err as { cause?: { message?: string, constraint_name?: string } }).cause
    if (!cause?.message) throw err
    return `${cause.message} (${cause.constraint_name ?? ''})`
  }
  throw new Error('expected the query to fail')
}
