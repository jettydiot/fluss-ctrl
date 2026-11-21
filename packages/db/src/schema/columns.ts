// Shared column builders and helpers for the schema (SPEC §5). Plain Postgres only (SPEC §9):
// text ids, timestamptz, jsonb, and text + CHECK instead of enum types so that adding a value
// later is an ordinary expand-only migration.
import { sql, type SQL } from 'drizzle-orm'
import { foreignKey, jsonb, text, timestamp, type AnyPgColumn } from 'drizzle-orm/pg-core'

/** `timestamptz`, read and written as a `Date`. */
export const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })

/** `created_at` and `updated_at`, both defaulting to now(). Repositories set `updated_at` on write. */
export const timestamps = {
  createdAt: tstz('created_at').notNull().defaultNow(),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
}

/** `org_id`, the tenancy column every org-scoped table carries and its RLS policy reads. */
export const orgId = () => text('org_id').notNull()

/** A jsonb column that defaults to an empty object. */
export const jsonObject = (name: string) => jsonb(name).$type<Record<string, unknown>>().notNull().default({})

/** `<column> IN ('a', 'b', …)` for a CHECK constraint. Values are compile-time constants. */
export function oneOf (column: AnyPgColumn, values: readonly string[]): SQL {
  for (const v of values) {
    if (!/^[a-z_]+$/.test(v)) throw new TypeError(`Unsafe CHECK value: ${v}`)
  }
  return sql`${column} IN (${sql.raw(values.map((v) => `'${v}'`).join(', '))})`
}

/** `<column>` holds a SPEC §1 id with the given prefix: `<prefix>_<UUIDv7>`. */
export function prefixedId (column: AnyPgColumn, prefix: string): SQL {
  if (!/^[a-z]+$/.test(prefix)) throw new TypeError(`Unsafe id prefix: ${prefix}`)
  return sql`${column} ~ ${sql.raw(`'^${prefix}_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`)}`
}

/**
 * A foreign key on `(org_id, <column>)` to `(org_id, id)` of the parent, so a row can only reference
 * a parent in its own organisation. RLS does not apply to foreign-key checks, so a single-column
 * reference would let org A point at org B's row (ADR-0003). A null `<column>` is not checked.
 */
export function sameOrg (name: string, orgCol: AnyPgColumn, col: AnyPgColumn, parentOrgCol: AnyPgColumn, parentCol: AnyPgColumn) {
  return foreignKey({ name, columns: [orgCol, col], foreignColumns: [parentOrgCol, parentCol] })
}
