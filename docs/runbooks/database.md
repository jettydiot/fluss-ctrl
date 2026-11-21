# Database: roles and partitions

## When to use it

- Provisioning a database (a new Neon branch or project, or the `za` datastore, SPEC §9).
- An alert or query shows rows landing in `events_default` or `webhook_deliveries_default`.
- Before the last monthly partition runs out (0001 creates partitions up to January 2028).

## Impact

Roles wrong: the API cannot connect, or (worse) connects as the table owner. Partitions missing:
rows land in the default partition, which still works but stops pruning, and a monthly partition
for that range can no longer be created until those rows move. Severity per SPEC §21.6.

## Preconditions

Production and staging changes run from CI after a human approval, never from a laptop or an agent
session (CLAUDE.md). Migrations run as the owner role over a direct connection, never through
Hyperdrive (SPEC §5).

## Steps

### Provision the roles

1. The migration role must own the `public` schema objects it creates: on Neon, the project owner
   role; elsewhere, a role with CREATEROLE **and** CREATE on `public` (for example the database
   owner). Check before migrating:
   `SELECT has_schema_privilege(current_user, 'public', 'CREATE'), rolcreaterole FROM pg_roles WHERE rolname = current_user;`
   is `t, t`.
2. Run the migrations as that role. They create `fluss_app` (NOLOGIN, no BYPASSRLS) if missing and
   leave an existing one unchanged, so check it before granting anything:
   `SELECT rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = 'fluss_app';` is
   `f, f, f`, and
   `SELECT r.rolname FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid WHERE m.member = 'fluss_app'::regrole;`
   returns no rows (it is a member of nothing it could `SET ROLE` to).
3. Create the login role Hyperdrive uses and make it a member of `fluss_app` only:
   `CREATE ROLE <login> LOGIN PASSWORD '<from the secret store>' IN ROLE fluss_app;`
   Check: `SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = '<login>';` is `f, f`, and
   the membership query above with `'<login>'::regrole` returns only `fluss_app`.
4. Point the Hyperdrive binding (query caching off, SPEC §9) at that login role.

### Keep partitions ahead

Run these as the migration (owner) role over a direct connection, never through Hyperdrive: the API
role cannot execute `create_month_partitions` or see partitions.

1. Check both default partitions are empty first:
   `SELECT count(*) FROM events_default;` and `SELECT count(*) FROM webhook_deliveries_default;`
   are both 0. If either is not, stop and follow "Rows in a default partition" below.
2. Create the next months: `SELECT create_month_partitions('events', '<first day>', 3);` and
   `SELECT create_month_partitions('webhook_deliveries', '<first day>', 3);`. Months that exist are
   skipped.
3. Check: `SELECT relname FROM pg_class WHERE relname LIKE 'events_y%' AND relkind = 'r' ORDER BY 1 DESC LIMIT 3;`
   shows the new months, and likewise for `webhook_deliveries_y%`.

### Rows in a default partition

Creating a month fails while the default partition holds rows for it. In one transaction, as the
owner, with writes to the table paused (it takes an exclusive lock):

1. `ALTER TABLE events DETACH PARTITION events_default;`
2. `ALTER TABLE events_default RENAME TO events_default_old;`
3. `CREATE TABLE events_default PARTITION OF events DEFAULT;` (out-of-range rows have a home again)
4. `SELECT create_month_partitions('events', '<first affected month>', <months>);`
5. Move the rows one org at a time. RLS is forced on `events`, so the owner can only insert rows for
   the org in `app.org_id`; a plain `INSERT … SELECT` is rejected by `events_org_isolation`:

   ```sql
   DO $$
   DECLARE o text; moved bigint := 0; n bigint;
   BEGIN
     FOR o IN SELECT DISTINCT org_id FROM events_default_old LOOP
       PERFORM set_config('app.org_id', o, true);
       INSERT INTO events SELECT * FROM events_default_old WHERE org_id = o;
       GET DIAGNOSTICS n = ROW_COUNT;
       moved := moved + n;
     END LOOP;
     PERFORM set_config('app.org_id', '', true);
     IF moved <> (SELECT count(*) FROM events_default_old) THEN
       RAISE EXCEPTION 'moved % rows, expected %', moved, (SELECT count(*) FROM events_default_old);
     END IF;
   END $$;
   ```

   Each row lands in its month, or in the new default if still out of range. The block counts what
   it inserted and aborts the transaction if that differs from the old default, so rows already in
   the month partitions never skew the check.
6. `DROP TABLE events_default_old;` and commit.
7. Check the new default directly (partitions have no RLS of their own):
   `SELECT min(recorded_at), max(recorded_at), count(*) FROM events_default;` (for
   `webhook_deliveries`, the partition key is `created_at`:
   `SELECT min(created_at), max(created_at), count(*) FROM webhook_deliveries_default;`). If it still holds
   rows (one call creates at most 36 months), repeat from step 1 for the remaining range. Resume
   routine maintenance only when both `events_default` and `webhook_deliveries_default` are empty.

The same applies to `webhook_deliveries` (its policy is on `org_id` too). Rehearse it on a Neon
branch first; record it in the release issue.

A scheduled job to keep partitions ahead arrives with its own issue; until then this is a calendar
reminder well before January 2028.

## Rollback

Roles: `REVOKE fluss_app FROM <login>;` stops the API. Partitions: an empty partition can be
dropped; never drop one with rows.

## Afterwards

Record provisioning in the release issue.
