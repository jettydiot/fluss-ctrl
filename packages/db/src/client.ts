// The Drizzle client over postgres.js. The API passes a postgres.js client built on its Hyperdrive
// binding (query caching off, SPEC §9); tests pass one for a Testcontainers database. The client
// connects as a member of `fluss_app`, never as the table owner (SPEC §5).
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type { Sql } from 'postgres'
import * as schema from './schema/index.ts'

export type Schema = typeof schema
export type Db = PostgresJsDatabase<Schema>

export function createDb (client: Sql): Db {
  return drizzle({ client, schema })
}
