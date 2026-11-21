// Drizzle schema, migrations and org-scoped repositories (SPEC §5). Nothing outside this package
// imports drizzle-orm or the driver (dependency-cruiser), and every repository takes an OrgScope.
export const packageName = '@flussctrl/db'

export { createDb } from './client.ts'
export type { Db, Schema } from './client.ts'
export { decodeEventCursor, encodeEventCursor, InvalidCursorError } from './cursor.ts'
export type { EventCursor } from './cursor.ts'
export { DEFAULT_LIMIT, insertEvent, listEvents, MAX_LIMIT, recordedAtFromId } from './repositories/events.ts'
export type { EventRow, ListEventsQuery, NewEvent, Page } from './repositories/events.ts'
export { OrgScope, withOrg } from './scope.ts'
export type { Tx } from './scope.ts'
export * as schema from './schema/index.ts'
