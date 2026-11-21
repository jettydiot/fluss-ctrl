---
status: proposed
date: 2026-11-21
decision-makers: Thomas
consulted: Claude (issue #5)
informed: —
---

# Tenancy in Postgres: org_id on every table, one forced RLS policy, no bypass role

## Context and Problem Statement

SPEC §5 makes the org-scoped repositories the first line of tenant isolation and Postgres
row-level security the second, with the org context set per transaction because Hyperdrive resets
session state. Issue #5 builds the Phase 0–1 schema and has to decide how the policies are shaped,
which roles exist, and how a few columns are typed, before any endpoint depends on them.

## Decision Drivers

* A missing or wrong policy must be caught by a test, not found in production.
* One policy shape is easier to review than one per table.
* Vanilla Postgres only (SPEC §9); expand-only migrations (SPEC §11 item 12).
* No standing way around RLS for the API.

## Considered Options

* Denormalised `org_id` on every tenant table, one identical policy each (chosen)
* Policies on child tables that join through their parent (`client_secrets` → `clients`, …)
* A second database role with `BYPASSRLS` for cross-org jobs

## Decision Outcome

Chosen: **denormalised `org_id` and one policy shape.** Every table except `organisations` (policy
on `id`) and the global `providers` catalogue has `org_id` and the policy
`org_id = current_setting('app.org_id', true)` for USING and WITH CHECK, with RLS enabled and
forced. The API connects as a member of `fluss_app`: no BYPASSRLS, DML only where needed,
append-only on `events` and `audit_log`, no privilege on partitions. A catalogue test fails if a
table without the policy, or a partition the API can reach, ever appears.

Foreign-key checks run without row security, so every reference between org-scoped tables is a
composite key `(org_id, <column>)` → `(org_id, id)`: org A cannot point a row at org B's client,
device or endpoint, and the error does not reveal whether B's row exists. Unique checks also run
before foreign-key checks and without row security, so `org_id` leads every unique key that holds
such a reference (devices' channel, commands' idempotency key, `idempotency_keys`,
`ingested_refs`); a duplicate-key error cannot reveal B's row either. Catalogue tests fail on any
foreign key between org-scoped tables, or any unique key over one of its columns, that leaves
`org_id` out.

Cross-org work (token lookup before the org is known, the outbox sweep, retention and
reconciliation crons) gets narrow `SECURITY DEFINER` functions, added by the issue that needs each
one, rather than a bypass role.

Also decided here: status-like columns are `text` + `CHECK` rather than enum types (adding a value
is then an ordinary migration), and Drizzle Kit generates the tables while roles, privileges, RLS
and partitions live in hand-written migrations (Drizzle Kit cannot express FORCE or partitioning).

### Consequences

* Good: every policy is the same line; the catalogue test makes forgetting one a red build.
* Good: no credential exists that reads across organisations.
* Bad: `org_id` is duplicated on four child tables; repositories must write the parent's org id
  (RLS WITH CHECK refuses anything else, so a mismatch fails loudly).
* Bad: each cross-org job needs its own reviewed function.
* Neutral: Drizzle Kit does not track the RLS migration, so a new table's policy is written by
  hand; the catalogue test catches an omission.

## More Information

SPEC §5 ("How this is built"); `packages/db/migrations/README.md`; `docs/runbooks/database.md`.
