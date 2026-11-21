// Drizzle Kit. `pnpm db:generate` needs no database; review every generated file and read
// migrations/README.md before committing one. `pnpm db:migrate:dev` applies migrations to
// $DATABASE_URL: the owner role over a direct connection (not Hyperdrive), for a local database or
// your own Neon dev branch. Copy .env.example; never point it at staging or production.
import { defineConfig } from 'drizzle-kit'

const url = process.env.DATABASE_URL

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  strict: true,
  verbose: true,
  ...(url ? { dbCredentials: { url } } : {}),
})
