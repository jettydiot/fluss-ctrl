// Applies the migrations in ../migrations with Drizzle's migrator (one transaction for all pending
// migrations). Run as the owner role over a direct connection, never through Hyperdrive (SPEC §5).
// `pnpm db:migrate:dev` uses drizzle-kit, which runs the same migrator against $DATABASE_URL.
import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import type { Db } from './client.ts'

export const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url))

export async function runMigrations (db: Db): Promise<void> {
  await migrate(db, { migrationsFolder })
}
