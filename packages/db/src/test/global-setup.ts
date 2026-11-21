// Integration test setup (SPEC §11 item 4): one Postgres 17 container per run.
//
// It mirrors production roles: a non-superuser owner with CREATEROLE (as on Neon) owns the
// database and runs the migrations, and the tests' API connection logs in as a role that is only a
// member of `fluss_app`. The superuser is used for nothing but creating the owner.
import { randomUUID } from 'node:crypto'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import postgres from 'postgres'
import type { TestProject } from 'vitest/node'
import { createDb } from '../client.ts'
import { runMigrations } from '../migrate.ts'

declare module 'vitest' {
  export interface ProvidedContext {
    ownerUrl: string
    appUrl: string
  }
}

let container: StartedPostgreSqlContainer | undefined

function urlFor (c: StartedPostgreSqlContainer, user: string, password: string, database: string): string {
  const u = new URL(`postgres://${c.getHost()}:${c.getPort()}/${database}`)
  u.username = user
  u.password = password
  return u.toString()
}

export async function setup (project: TestProject): Promise<void> {
  container = await new PostgreSqlContainer('postgres:17-alpine').start()
  const ownerPassword = randomUUID()
  const appPassword = randomUUID()

  const su = postgres(container.getConnectionUri(), { max: 1, onnotice: () => {} })
  await su.unsafe(`CREATE ROLE fluss_owner LOGIN CREATEROLE PASSWORD '${ownerPassword}'`)
  await su.unsafe('CREATE DATABASE flussctrl OWNER fluss_owner')
  await su.end()

  const ownerUrl = urlFor(container, 'fluss_owner', ownerPassword, 'flussctrl')
  const owner = postgres(ownerUrl, { max: 1, onnotice: () => {} })
  await runMigrations(createDb(owner))
  // The Hyperdrive login role in production is provisioned the same way (docs/runbooks/database.md).
  await owner.unsafe(`CREATE ROLE app_login LOGIN PASSWORD '${appPassword}' IN ROLE fluss_app`)
  await owner.unsafe("INSERT INTO providers (code, name, onboarding_mode) VALUES ('simulator', 'Simulator', 'claim_code')")
  await owner.end()

  project.provide('ownerUrl', ownerUrl)
  project.provide('appUrl', urlFor(container, 'app_login', appPassword, 'flussctrl'))
}

export async function teardown (): Promise<void> {
  await container?.stop()
}
