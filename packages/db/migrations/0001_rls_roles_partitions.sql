-- Roles, privileges, row-level security and partitions (SPEC §5; issue #5). Written by hand
-- (`drizzle-kit generate --custom`); Drizzle Kit tracks none of this. See migrations/README.md.
--
-- Roles. The migration role owns every table and is never used by the API. `fluss_app` is the
-- role the API uses: no login of its own (the Hyperdrive login role is granted membership when it
-- is provisioned, issue #9/#16), no BYPASSRLS, and DML only where the API needs it.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '5min';--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fluss_app') THEN
    CREATE ROLE fluss_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO fluss_app;--> statement-breakpoint

-- Privileges. Tables the API only appends to (`events`, `audit_log`, `ingested_refs`) get no
-- UPDATE or DELETE, except the three pseudonymisation columns on `events` (SPEC §14). Nothing is
-- deleted through this role except memberships and expired idempotency keys: retention and
-- erasure jobs arrive with their own issues.
GRANT SELECT ON "providers" TO fluss_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "organisations" TO fluss_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "clients" TO fluss_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "client_secrets" TO fluss_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "org_members" TO fluss_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "idempotency_keys" TO fluss_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "sites" TO fluss_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "device_groups" TO fluss_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "controllers" TO fluss_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "devices" TO fluss_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "subjects" TO fluss_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "grants" TO fluss_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "commands" TO fluss_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "events" TO fluss_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "ingested_refs" TO fluss_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "audit_log" TO fluss_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "webhook_endpoints" TO fluss_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "webhook_deliveries" TO fluss_app;--> statement-breakpoint
GRANT UPDATE ("subject_id", "data", "pseudonymised_at") ON "events" TO fluss_app;--> statement-breakpoint

-- Row-level security, the second line of defence behind the org-scoped repositories. The API sets
-- the context with set_config('app.org_id', …, true) inside each transaction (SPEC §5). With no
-- context, current_setting(…, true) is NULL (or '' after an earlier transaction on the same
-- connection), which matches no row. FORCE makes the table owner subject to the policy too.
-- `providers` is the only table without one: it is a global catalogue the API can only read.
ALTER TABLE "organisations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organisations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "organisations_org_isolation" ON "organisations"
  USING ("id" = current_setting('app.org_id', true))
  WITH CHECK ("id" = current_setting('app.org_id', true));--> statement-breakpoint
ALTER TABLE "clients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "clients" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "clients_org_isolation" ON "clients"
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
ALTER TABLE "client_secrets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "client_secrets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "client_secrets_org_isolation" ON "client_secrets"
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
ALTER TABLE "org_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "org_members" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_members_org_isolation" ON "org_members"
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
ALTER TABLE "idempotency_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "idempotency_keys" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "idempotency_keys_org_isolation" ON "idempotency_keys"
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
ALTER TABLE "sites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sites" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "sites_org_isolation" ON "sites"
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
ALTER TABLE "device_groups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "device_groups" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "device_groups_org_isolation" ON "device_groups"
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
ALTER TABLE "controllers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "controllers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "controllers_org_isolation" ON "controllers"
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
ALTER TABLE "devices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "devices" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "devices_org_isolation" ON "devices"
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
ALTER TABLE "subjects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "subjects" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "subjects_org_isolation" ON "subjects"
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
ALTER TABLE "grants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "grants" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "grants_org_isolation" ON "grants"
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
ALTER TABLE "commands" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commands" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "commands_org_isolation" ON "commands"
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
ALTER TABLE "events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "events_org_isolation" ON "events"
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
ALTER TABLE "ingested_refs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ingested_refs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "ingested_refs_org_isolation" ON "ingested_refs"
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "audit_log_org_isolation" ON "audit_log"
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "webhook_endpoints_org_isolation" ON "webhook_endpoints"
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "webhook_deliveries_org_isolation" ON "webhook_deliveries"
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint

-- Partitions (SPEC §5). Monthly ranges in UTC plus a default partition for anything outside them. The
-- API role has no privilege on any partition, so it can reach rows only through the parent, where
-- the policy applies. create_month_partitions() is idempotent; a scheduled job that keeps it a few
-- months ahead arrives with its own issue (docs/runbooks/partitions.md). A month must be created
-- before rows for it land in the default partition, or creating it later fails.
CREATE FUNCTION create_month_partitions(parent regclass, first_month date, months integer)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  m date := date_trunc('month', first_month)::date;
  part text;
BEGIN
  IF months < 1 OR months > 36 THEN
    RAISE EXCEPTION 'months must be between 1 and 36, got %', months;
  END IF;
  FOR i IN 1..months LOOP
    part := format('%s_y%sm%s', parent::text, to_char(m, 'YYYY'), to_char(m, 'MM'));
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF %s FOR VALUES FROM (%L) TO (%L)',
      part, parent, m::timestamp AT TIME ZONE 'UTC', (m + interval '1 month')::timestamp AT TIME ZONE 'UTC'
    );
    m := (m + interval '1 month')::date;
  END LOOP;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION create_month_partitions(regclass, date, integer) FROM PUBLIC;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "events_default" PARTITION OF "events" DEFAULT;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhook_deliveries_default" PARTITION OF "webhook_deliveries" DEFAULT;--> statement-breakpoint
SELECT create_month_partitions('events', '2026-11-01', 15);--> statement-breakpoint
SELECT create_month_partitions('webhook_deliveries', '2026-11-01', 15);
