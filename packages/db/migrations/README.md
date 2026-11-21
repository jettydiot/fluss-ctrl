# Migrations

Forward-only, expand/contract, linted by `squawk` in CI (SPEC §11 items 4 and 12; ADR-0003).
Drizzle's migrator applies every pending migration in **one transaction**, which is why the root
`.squawk.toml` sets `assume_in_transaction`.

## Adding a migration

1. Change the schema in `src/schema/`, then run `pnpm db:generate`. Read the SQL it writes.
2. **A new table** needs, in a hand-written migration (`pnpm --filter @flussctrl/db exec drizzle-kit generate --custom --name <name>`):
   `GRANT` for `fluss_app` (only the verbs the API needs), `ENABLE` and `FORCE ROW LEVEL SECURITY`,
   and the `<table>_org_isolation` policy, copied from `0001_rls_roles_partitions.sql`. The
   catalogue test in `src/rls.int.test.ts` fails until you do, and `ORG_SCOPED_TABLES` in
   `src/test/seed.ts` lists it.
3. Never edit a migration that has reached staging or production. Never rename or drop a column in
   the release that stops writing it.
4. Run `pnpm --filter @flussctrl/db test:integration` (Docker) and
   `npx squawk-cli@2.73.0 packages/db/migrations/*.sql`.

## Hand edits in generated files

Drizzle Kit cannot express partitioning, so `0000_init.sql` has two hand edits, each marked
`hand edit`: `PARTITION BY RANGE` on `events` (`recorded_at`) and `webhook_deliveries`
(`created_at`). The snapshot in `meta/` matches the columns; it simply does not know about
partitioning, so later generated migrations stay correct.

## Partitions

`create_month_partitions(parent, first_month, months)` creates monthly partitions in UTC,
idempotently. 0001 creates November 2026 to January 2028 for both tables, plus a default partition
each. Keeping it ahead is operational: see `docs/runbooks/database.md`.
