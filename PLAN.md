# Fluss Ctrl — Planning Document

> Name: Fluss Ctrl. Domain: flussctrl.com. Owned by Fluss Inc.
> Brand line: "Fluss Ctrl, powered by Fluss".
> Companion files: `SPEC.md` (what to build), `CLAUDE.md` (how to work in the repo).
> Status: v0.11 — 10 Nov 2026 (review pass: gate semantics, command-path correctness, scope and sequencing)

## 1. What this is

A hardware-agnostic access-control API. Customer platforms (estate apps, visitor
management, security control rooms, property and storage platforms, logistics)
integrate once and can see status, trigger, share access, revoke access and read
access logs on any gate, boom or door — regardless of who made the hardware — plus
site-wide emergency modes (evacuate, lockdown) for control rooms.

Devices are reached through **providers**: adapters for the existing Fluss backend
(Fluss+ and intercom), OEM clouds (Gemini, Nice), the consumer-app clouds behind
Accentronix and Centurion's MyCentsys Remote (unofficial, reverse-engineered), Comb,
and on-premise panels (Impro, Gallagher, Paxton) via a site connector.

Fluss Ctrl does **not** own device connectivity. Firmware, MQTT and device
sessions stay in the existing Fluss backend (and in OEM clouds). This system is a
stateless broker with its own tenancy, identity, grants, command verification,
event log and webhooks.

## 2. Goals and non-goals

Goals (Phase 1, South Africa)
- A developer can open a sandbox gate within an hour of signing up, without talking to us.
- Every existing partner on the old API (MEL, WeconnectU, Storeapp) is migrated to v1.
- Every command reports what was actually verified (ack vs observed effect), from day one.
- Best-in-class automated testing; no manual release gates except a one-click promote.
- Region is first-class so a US deployment is configuration, not a rewrite.

Non-goals (for now)
- Owning device connectivity, firmware, or an MQTT broker.
- A resident-facing app. Platforms own their users.
- Estate-level logins (platforms administer on behalf of estates).
- Tenant Access (delegated grants with owner-set limits) — modelled, not exposed, in v1.
- US billing and US providers (KISI, Brivo).
- On-premise panel connectors (Gallagher, Impro, Paxton): post-launch, Q2 2027. The Wiegand bridge covers panel triggering at launch.
- A SOC 2 audit before US beta (being audit-ready is in scope; the audit itself is not).
- A second compute path before launch: the Postgres-backed platform adapters and the break-glass container are post-launch (interfaces only until then; SPEC §21.3).
- An admin web UI before Phase 4 (endpoints and `fctl admin` run the beta), and automated dunning and reconciliation before there is self-serve volume.
- Anything in SPEC §20 unless explicitly pulled forward.

## 3. Decisions (with reasons)

| # | Decision | Choice | Why |
|---|----------|--------|-----|
| 1 | Relationship to existing Fluss | Thin broker; existing Fluss is a provider | Keeps new system stateless; connectivity can move later |
| 2 | Compatibility | Clean v1, migrate partners | Old API is device-centric with account keys; v1 needs tenancy, grants, verification |
| 3 | Brand/entity | New name + domain, Fluss Inc owns code and billing | US raise and US billing live in Fluss Inc |
| 4 | Language | TypeScript only (Node-compatible, runs on Workers) | I/O-bound workload; one language across API, console, SDK; best Claude Code leverage. Rust stays in firmware |
| 5 | Compute | Cloudflare Workers (Hono) | No servers, no uptime to own, global edge, already in use at Fluss |
| 6 | Database | Managed Postgres, US-first: Neon in `us-east-1` via Cloudflare Hyperdrive for build, beta and US launch. Worker pinned beside the DB with an explicit placement hint (`placement.region = "aws:us-east-1"`), not Smart Placement; Hyperdrive query caching off on the API's binding | The US is the real market. Managed is cheaper than self-hosting until managed spend passes roughly $2k/month, so owning uptime buys nothing yet. Schema stays vanilla Postgres (no proprietary features, logical-replication friendly) so the exit to self-hosted or RDS is a `pg_dump`. Smart Placement decides from traffic at several locations, which an SA-only beta does not give it, and Hyperdrive's default read cache is not invalidated by writes, so it is off (SPEC §9). SA lag with a US DB is ~220–250 ms per call, measured by a Phase 0 spike rather than assumed; if it exceeds the SPEC §9 budget, add a `za` datastore in AWS Cape Town (Aurora Serverless v2, ~20 ms) and move ZA orgs by runbook |
| 7 | Async | Cloudflare Queues (webhooks, exports), Durable Objects with alarms (per-device command serialisation and the verification window), Cron Triggers (retention, metering, partitions) | Managed, retries and DLQ built in. Workflows dropped from v1: DO alarms cover the confirm window, one fewer primitive |
| 8 | Machine auth | OAuth2 client credentials → JWT (EdDSA, 1h, scopes), JWKS published | Standard with longevity; enables user-delegated flows later |
| 9 | Console auth | Better Auth (self-hosted on Workers, Postgres, passkeys + org plugin) | Open source, standards-based, no vendor |
| 10 | Billing | Own metering (device-months) in Postgres; payment provider behind an adapter (Paystack or Stripe). Metering and hand-raised invoices for the first partners in Phase 3, self-serve payment in Phase 4, dunning and reconciliation after launch | Payment provider is swappable. Which one comes first depends on the merchant of record for SA customers (open decision below): Paystack needs an SA-registered business and bank account, so it cannot be Fluss Inc's own account |
| 11 | Webhooks | Standard Webhooks spec (HMAC, `webhook-id/timestamp/signature` headers) | Libraries exist in every language |
| 12 | Docs | Astro Starlight (guides) + Scalar (reference, generated from OpenAPI), static on Cloudflare | Free, open source, fast |
| 13 | Console / www | React + Vite SPA on Workers static assets; Astro for marketing | No SSR complexity needed |
| 14 | ORM / validation | Drizzle + Zod; OpenAPI generated from route schemas with `@hono/zod-openapi`; `openapi.json` committed; `oasdiff` in CI blocks breaking changes | Single source of truth in code |
| 15 | Observability | Sentry (errors, performance, uptime monitors, metric alerts) with source maps and release tags, and the source of every page; PostHog (events, trend alerts on command success rate and latency, rollout flags); structured JSON logs with request IDs via Workers Logs + Logpush to R2, short retention; OpenStatus for the public status page and the external per-minute checks | Follows the company standard (Sentry + PostHog, no new tools). PostHog insight alerts are evaluated hourly on the standard plan, too slow to page against a 22-minute monthly budget, so Sentry pages and PostHog shows trends. OpenStatus is the one addition: a public status page must live outside Cloudflare (SPEC §21) and the standard has nothing for it. Budget its Starter plan (about $30/month): the free plan is one monitor at ten-minute intervals with three components |
| 16 | Testing | Vitest (unit, coverage posted on changed lines); Vitest + Testcontainers (integration, real Postgres in Docker); `@cloudflare/vitest-plugin` (formerly `@cloudflare/vitest-pool-workers`) for bindings; fast-check property tests on parsers and grant logic; Playwright (e2e and smoke); k6; provider conformance kit; hardware canary bench; Neon branch per PR for preview deploys | Company standard, plus the conformance kit and bench this product needs. See §8 |
| 17 | Repo | pnpm + Turborepo monorepo from the Fluss project template: TypeScript `strict`, neostandard + ESLint Stylistic (no Prettier), Lefthook pre-commit (lint, gitleaks, commitlint), Conventional Commits with GitHub issue numbers, release-please (manifest mode for the published packages), Renovate weekly, Dev Containers, MADR ADRs, GitHub Actions, Wrangler, Terraform for DNS/zones applied from CI | One repo for Claude Code; same tooling as every other Fluss repo |
| 24 | Work tracking | GitHub Issues + GitHub Projects for this repo (issue templates for tasks, releases and postmortem actions; milestones = phases; labels for risk and tech debt). Production deploy approval via a GitHub Environment required reviewer | Fluss Ctrl is a Fluss Inc project outside Zoho Projects. GitHub is free, already holds the code, and the standard's traceability rule maps one-to-one (issue number in branch, commit and PR) |
| 25 | Review during the solo phase | Claude Code review action on every PR as a **required status check**; the ruleset still requires one human approval, which a sole author cannot give (GitHub does not let an author approve their own PR), so every solo-phase merge is a logged admin bypass; the bypass log is reviewed monthly by a named second person, not the author | Decided 4 Nov 2026, tightened 10 Nov; revisit when the team joins. A log only its author reads is not a control |
| 23 | Engineering standard | `fluss-engineering-decisions.md` (web/API profile) applies in full. Deliberate exceptions, each with a reason, are listed in §13 | One way of working across Fluss; exceptions are written down, not improvised |
| 18 | Retention | Org-configurable, default 12 months live then pseudonymised; data-subject export/delete endpoints | POPIA s14 / GDPR Art 5(1)(e): "no longer than necessary" — no fixed number; legal review before GA |
| 19 | Agent readiness | API designed for agents from day one (idempotency, `?wait=`, stable codes, examples, `llms.txt`); an MCP server with OAuth 2.1 in April 2027 (post-launch, §7), submitted to the Claude directory | AI control rooms and agent-driven integrations are a real channel; the same properties make the API better for humans |
| 21 | Resilience | Tiered DR (SPEC §21): PITR + off-provider dumps now; cross-provider warm standby by beta (RPO ≤ 30 s, RTO ≤ 15 min); automated failover at US launch. Cloudflare bindings behind interfaces from Phase 0; the Postgres adapters and the break-glass container that runs on them are built after launch; registrar and secondary DNS outside Cloudflare; keys escrowed offline | 99.95% is not credible on a single region with no failover plan. The broker architecture limits any outage to API-originated commands, so this is about credibility and recovery time, not life safety. The second compute path waits until after launch: two implementations of the per-device coordinator, kept green on every PR, is the wrong cost while the command path is still changing |
| 22 | Unofficial providers | Accentronix and Centurion (MyCentsys Remote / G-Ultra) are built from the reverse-engineered app APIs as `stability: unofficial` providers: per-org flag, written disclosure, excluded from SLA, hardware canary nightly, kill switch, counsel review of both vendors' terms **before anything is built or run against a vendor cloud**, responsible disclosure of the weaknesses found (December, so that a 90-day fix window closes before launch), and both vendors **informed in writing before go-live** with an invitation to make it official | The two largest installed bases at SA complexes and estates become reachable without waiting for the vendors; adoption data is the lever for official partnerships. The risk is a vendor blocking it, which is why the Fluss+ retrofit stays the official route onto Centurion motors |
| 20 | Compliance posture | Audit-ready from day one (controls in §11); SOC 2 Type I targeted around US beta, Type II a year later; ISO 27001 only when an SA/EU tender demands it | US buyers ask for SOC 2; SA corporates ask for ISO 27001; both are cheap to prepare for now and expensive to retrofit |

Open decisions (need Tom). Technical open questions are in SPEC §18.

| Decision | Needed by | Why it cannot wait |
|----------|-----------|--------------------|
| Brief counsel on the unofficial providers: both vendors' terms, the reverse-engineering position and the disclosure plan (SPEC §22.3) | November 2026 | Nothing in SPEC §22 is built or run against a vendor cloud before counsel's view, and disclosure has to go out in December for a 90-day fix window to close before launch |
| Schedule the existing-backend work in SPEC §12.3 with that team: items 1–3 are needed by 12 January for Phase 2 (delivery by 18 December, or the first week of January at the latest), item 1b by 30 January for the Phase 3 migrations | before the December break | SA partners and the backend team are largely away 19 Dec – 4 Jan |
| Internal contract the existing backend will expose for the Fluss+ provider (SPEC §12), and where that backend is hosted | Phase 0 | Inputs to the latency spike and the Fluss+ provider |
| How Fluss+ channels are addressed: units expose several outputs (main, pedestrian, switch) under one device ID and the current public API can only command "main" (SPEC §12.3) | Phase 1 | Fixes the controller/device model |
| Second person who reviews the bypass log monthly and, where possible, approves production deploys (decision 25) | Phase 0 | The solo-phase control is only a control if someone else looks |
| Gemini and Nice: separate OEM-cloud providers, or reached through the existing backend; who writes the mappings (SPEC §23) | before Phase 2 | There is no spec to build from |
| Wiegand bridge: owner, electrical definition and firmware dates (SPEC §23) | end of Phase 1 | Otherwise it leaves the launch set |
| Which partner is the first beta (recommend Storeapp: smallest blast radius) | end of Phase 1 | Phase 2 ends with an internal beta |
| Paging channel for SEV1: Sentry to something that wakes a person (a pager integration or phone), not only Slack | before Phase 2 | First real devices |
| Merchant of record for SA customers: the SA company invoices and collects locally (Paystack needs an SA-registered business and bank account), or Fluss Inc bills them through Stripe. One for the accountant and counsel: contracts, VAT, exchange control | before Phase 3 | Decides which payment provider is integrated and who signs the partner contracts |
| Billing unit: per controller or per active device (a three-output Fluss+ unit is three devices) | before Phase 3 | Metering records both until this is decided (SPEC §15) |
| Legal review of retention defaults, the DPA template, and the inter-company data agreement for Fluss+ user data moving from the SA company to Fluss Inc (SPEC §14) | before beta | Provider-originated events carry Fluss+ users' data |

## 4. Architecture (one page)

```
 Customer platforms ──OAuth2 CC──▶  api.flussctrl.com  (Workers, Hono)
                                       │
            ┌──────────────────────────┼──────────────────────────┐
            ▼                          ▼                          ▼
      Postgres (Neon,            DeviceCoordinator DO        Queues
      per region via             (1 per device: serialise    (webhook delivery,
      Hyperdrive)                 commands, verify, rate)     retries, DLQ)
            │                          │
            │                          ▼  provider interface
            │        ┌────────────┬────────────┬────────────┬──────────────┐
            │     simulator    fluss-plus    gemini/nice   comb/accentronix  connector
            │     (sandbox)   (existing      (OEM cloud)   (intercom cloud)  (on-prem:
            │                  backend)                                       Impro/Gallagher/Paxton)
            ▼
   Events (partitioned) ──▶ Webhooks ──▶ platforms
```

Request path for a trigger: validate token + scope → load device → enqueue to the
device's Durable Object → DO calls provider → DO tracks ack → DO polls/awaits status
to a terminal state → event and its pending webhook deliveries written in one
transaction (outbox, SPEC §8.2) → dispatcher queues the webhooks → client sees the
result via `GET /commands/{id}` or `?wait=`.

Regions: every org has `region` (`za`, `us`). Region → datastore is configuration:
at build and beta both map to one Neon project in `us-east-1` (one DB, one Queue set,
and a placement hint pins the Worker beside it). The `za` region gets its own datastore
(AWS Cape Town) only if SA latency, measured by the Phase 0 spike and again at beta,
breaks the budget; moving ZA orgs is a documented runbook, not a rewrite. US launch
needs nothing new.

## 5. Websites and surfaces

| Surface | Host | Stack | Phase |
|---------|------|-------|-------|
| `api.flussctrl.com` | Workers | Hono | 1 |
| `docs.flussctrl.com` | Workers static | Astro Starlight + Scalar | 1 |
| `console.flussctrl.com` | Workers static | React + Vite | 2 (customer console), 4 (`/admin` UI for Fluss staff) |
| `status.flussctrl.com` | OpenStatus | — | 2 |
| `flussctrl.com` | Workers static | Astro | 4 |
| `mcp.flussctrl.com` | Workers | MCP server over the public API | Post-launch (April 2027) |
| `fctl` CLI | npm (`@flussctrl/cli`) | login, devices, commands; `fctl listen` webhook relay; `fctl admin` for Fluss staff | 1 (basics), 2 (`listen`, `admin`) |
| Sandbox | inside console + API (`sandbox` clients) | simulator provider | 1 |

## 6. Provider roadmap (reach × ease)

Reach = installed base at SA estate/complex perimeters. Ease = effort to a working,
conformance-passing provider. Centurion has two routes: the Fluss+ retrofit (official,
any motor, record `controls.brand = "centurion"`) and the MyCentsys Remote cloud for
motors already fitted with a G-Ultra (unofficial, SPEC §22).

| Order | Provider | Reach | Ease | Route | Onboarding mode |
|------:|----------|-------|------|-------|-----------------|
| 0 | Simulator | — | High | in-process | n/a (sandbox) |
| 1 | Fluss+ (incl. Centurion retrofit, intercom) | High | High | existing backend | `claim_code` |
| 2 | Gemini | Med | High | OEM cloud, already integrated | `account_link` |
| 3 | Nice | Med | High | OEM cloud, already integrated | `account_link` |
| 4 | Accentronix (unofficial) | High (complexes) | Med (API mapped; GSM delivery is slow; Fluss Ctrl OTP needed for proof of control) | app cloud | `account_link` (OTP) |
| 5 | Centurion MyCentsys Remote (unofficial) | High (G-Ultra base) | Med (API mapped; quirky encodings; native Keep Open / Lock holds) | app cloud | `account_link` (OTP) |
| 6 | Wiegand/dry-contact bridge | High (covers every panel for trigger) | Med (firmware, parallel track) | Fluss+ hardware | `claim_code` |
| 7 | Comb | High (complexes) | Med (partner API needed, or the same reverse-engineering exercise) | intercom cloud | `account_link` |
| 8 | Gallagher | Med (high-end estates) | High (documented REST API) | site connector | `connector` (Q2 2027) |
| 9 | Impro | High (estates) | Med | site connector | `connector` (Q2 2027) |
| 10 | Paxton | Med | Med | site connector | `connector` (Q2 2027) |
| — | KISI, Brivo | US | — | cloud | US phase |

Launch set: 0–6 (4 and 5 ship as beta/unofficial behind a per-org flag, and only once counsel has cleared them). Comb (7) is April at the earliest (§7). The connector providers need their own architecture (SPEC §20 item 5) and are post-launch.

Rule: a provider ships only when it passes the conformance kit (SPEC §11).

Rule: a provider is built only from a written mapping. Fluss+ (SPEC §12) and the two unofficial clouds (SPEC §22) have one. Gemini, Nice and the Wiegand bridge do not yet (SPEC §23), and the Wiegand bridge leaves the launch set if it has no owner and firmware dates by the end of Phase 1.

## 7. Phases and timeline

Re-baselined 4 Nov 2026 (nothing started before this date). Target: beta through
February, launch 31 March 2027 (Q1 holds). The three-week slip plus the December break is
absorbed by moving the MCP server, directory submission and Comb to April; everything
else keeps its scope. SA partners and the Fluss backend team are largely unavailable
19 Dec – 4 Jan, so partner-facing work sits in February and the backend ask is placed now.

v0.11 (10 Nov) takes three more things off the critical path so that Phase 2 fits one
person: the admin web UI (Phase 4; endpoints and `fctl admin` run the beta), billing
automation (metering and hand-raised invoices first) and the Postgres-backed adapters
with the break-glass container (post-launch).

| Phase | Dates | Weeks |
|-------|-------|------:|
| 0 Foundations | 4 – 17 Nov 2026 | 2 |
| 1 Core API + sandbox + docs | 18 Nov – 18 Dec 2026 | 4.5 |
| Break (no dependencies scheduled; optional solo items listed below) | 19 Dec – 4 Jan | 2.5 |
| 2 Real devices + console | 5 – 30 Jan 2027 | 4 |
| 3 Beta | 2 – 27 Feb 2027 | 4 |
| 4 Launch | 2 – 31 Mar 2027 | 4.5 |
| Post-launch | April 2027 onward | |

### Phase 0 — Foundations (4 – 17 Nov 2026)
- Name, domain, GitHub org under Fluss Inc; accounts: Cloudflare, Neon, Sentry, PostHog, OpenStatus.
- GitHub Issues and a GitHub Project set up: issue templates (task with Given/When/Then and the definition-of-done checklist; release; postmortem action), milestones for the phases, labels for risk and tech debt; branch, commit and PR naming carry the issue number. GitHub Environments for staging and production, with production requiring a reviewer approval.
- Monorepo from the Fluss project template: README, CONTRIBUTING, TESTING.md, `docs/adr` (MADR), `docs/runbooks`, postmortem template, PR template, CODEOWNERS, Dev Container, Lefthook, commitlint, Renovate, release-please, `.git-blame-ignore-revs`; CI (lint, typecheck, unit, integration via Testcontainers, contract), Semgrep CE + gitleaks, dependency review, Claude Code review action with a spend limit; preview deploys per PR with a Neon branch; Terraform for Cloudflare DNS/zones and the Route 53 secondary zone, applied only from CI.
- Organisation ruleset on `main`: PR required, CI passing, one approval, code-owner review, no force-push, up to date before merge. Solo phase: the Claude Code review is a required check on every PR; merges go through the logged admin bypass (a sole author cannot approve their own PR), and a named second person reviews the bypass log monthly.
- Data model and migrations for the Phase 0–1 tables only (SPEC §0, §5); later tables arrive with the phase that uses them. OpenAPI v1 generated and committed.
- Simulator provider + conformance kit skeleton.
- Platform interfaces (`Queue`, `Coordinator`, `Cache`, `RateLimiter`) with the Cloudflare implementations (the Postgres ones are post-launch); nightly off-provider encrypted dumps; key escrow and break-glass accounts (SPEC §21).
- Latency spike (one day): a Worker with the placement hint, Hyperdrive (caching off) and Neon `us-east-1`, one coordinator Durable Object and one call to the existing Fluss API, measured from Johannesburg and US East against the SPEC §9 budget. Decides now, not at beta, whether the `za` datastore is launch work.
- Counsel briefed on the unofficial providers, and the backend ask for SPEC §12.3 placed (open decisions, §3).
- Done when: `pnpm test` is green in CI and a PR gets a preview URL with its own DB branch.

### Phase 1 — Core API + sandbox + docs (18 Nov – 18 Dec 2026)
- OAuth2 token endpoint, JWKS, scopes, sandbox vs live clients.
- Orgs, sites, devices, device groups, subjects, grants (all v1 access types), commands with verification, events, webhooks (Standard Webhooks, Queues, retries, DLQ).
- Rate limits, idempotency keys, pagination, error format.
- Docs site live with three quickstarts (open a gate, share access, read logs); `llms.txt` and Markdown docs for agents.
- CLI (`fctl`) basics: login, list devices, trigger, tail events (thin wrappers over the API).
- Pen test booked now for a window in the second half of February, with a re-test slot in late March for emergency modes (firms need the lead time).
- Done when: a new developer opens a sandbox gate in under an hour using only the docs.

### Break (19 Dec – 4 Jan) — optional, no dependencies
- Hardware canary bench built and wired; `fctl listen` relay; docs polish; Wiegand bridge firmware track continues if the hardware team is working.

### Phase 2 — Real devices + console (5 – 30 Jan 2027)
- Fluss+ provider against the existing backend (SPEC §12) with `claim_code` onboarding. Depends on §12.3 items 1–3 landing by 12 January; otherwise the beta fallback (owner account per org, log polling) is used and the debt is tracked as an issue. Item 1b (migrate by existing key) is needed by 30 January for the Phase 3 migrations.
- Gemini and Nice providers with `account_link`, once their mappings exist (SPEC §23).
- Accentronix and Centurion (MyCentsys Remote) providers (SPEC §22) behind a per-org flag, **only once counsel has reviewed** (SPEC §22.3; nothing runs against a vendor cloud before that, the bench included); Fluss Ctrl OTP via Twilio for proof of control; conformance runs against the hardware canary bench (one cellswitch, one G-Ultra, one Fluss+).
- Console v1: login (passkeys), org, clients and secrets, webhooks config + replay, event viewer, sandbox devices. Usage and billing UI moves to Phase 3.
- Admin v1 as endpoints plus `fctl admin` (SPEC §13.2): org list and detail, entitlements, provider health and kill switch, link health, DLQ view and replay, command trace, read-only impersonation. The parts needed to run a beta, without a month of UI.
- `fctl listen` (if not done over the break): a relay (Durable Object + WebSocket) that forwards sandbox webhooks to localhost. The fastest way for a partner developer to get a working integration.
- Status page + synthetic checks: per-minute HTTP checks from ZA, EU and US (OpenStatus Starter); the scripted journey (open a sandbox gate, receive its webhook) every five minutes from a runner outside Cloudflare. Both record the SPEC §9 latency numbers.
- Internal beta with one small partner on real devices.
- Done when: a real Fluss+ gate opens via v1 with `verification: confirmed` and the partner has no manual steps.

### Phase 3 — Beta (2 – 27 Feb 2027)
- Migrate MEL and WeconnectU (migration guide + side-by-side period), using migrate-by-existing-key (SPEC §12.3 item 1b) so nobody collects a claim code per gate.
- Billing: metering and a monthly usage statement per org; the first partners are invoiced by hand from it. Merchant of record decided before this phase starts (§3).
- Wiegand bridge provider (firmware track started in Phase 1).
- Pen test run in the second half of the month (booked in Phase 1): auth, tenancy isolation, the command path, webhooks, console and admin endpoints. POPIA/data-retention legal review; DPA template; inter-company data agreement for Fluss+ user data (SPEC §14).
- Vendor notices: the written go-live notice to Accentronix and Centurion in the first week of February, so an objection only parks the provider rather than the launch. It follows counsel's review (November) and the responsible disclosure sent in December, whose 90-day fix window closes before launch (SPEC §22.3).
- Warm standby database in another provider and region, replication-lag alerting, failover/failback runbook, first failover drill in staging (SPEC §21 Tier 1).
- Per-provider circuit breakers; providers as components on the status page; partner-facing "Reliability" docs page.
- Load test to 10× expected launch traffic; game day (provider outage, DB failover, DLQ drain, key rotation).
- Done when: two large partners are fully on v1, a month of metering matches a hand count, pen-test critical and high findings closed (the rest tracked with dates).

### Phase 4 — Launch (2 – 31 Mar 2027)
- Emergency modes per site, evacuate and lockdown (SPEC §4): the control-room feature. Lockdown ships with the egress review gate and the honest per-device outcome (`unsupported`, `not_controlled`). Both modes act on each motor's recorded pulse mode: a gate that a pulse cannot close is never pulsed in a lockdown (`relies_on_autoclose`).
- Accentronix and Centurion providers promoted from flag to "beta / unofficial" with written disclosure to each platform.
- Admin web UI (overview, customers, operations, support) and the `GET /v1/admin/metrics` feed for the KPI Machine / Business Brain. Reporting pages follow launch.
- Self-serve payment: payment method on file and an automatic monthly charge, through the provider the merchant-of-record decision selects.
- TypeScript SDK published; Python/C# only on request.
- Marketing site, case studies, changelog, public roadmap.
- Secondary DNS zone live; incident severities and comms templates published; insurance and liability terms in place.
- Pen re-test covering emergency modes; lockdown is not enabled for any customer before it and the fire-code review (§11) are done.
- Done when: self-serve signups are producing paying device-months without founder involvement.

### Post-launch — April 2027 onward
- April: MCP server (`mcp.flussctrl.com`) with OAuth 2.1 (SPEC §19) and the Claude connector directory submission with a plugin bundle and skill; Comb (partner API, or reverse-engineered the same way if the vendor is slow).
- Connector architecture spec, then Gallagher → Impro → Paxton.
- Official API or partnership conversations with Accentronix and Centurion, armed with adoption numbers.
- Device sharing between orgs, pass links, tamper-evident log, tenant access (SPEC §20), in whatever order customers pull them.
- `za` datastore if the beta latency numbers or a customer require it; compliance-platform onboarding ahead of US beta; automated database failover (SPEC §21 Tier 2).
- Postgres-backed platform adapters and the break-glass container deploy (SPEC §21.3), exercised once against staging; billing automation (dunning, reconciliation, admin billing pages) and admin reporting.

## 8. Quality bar (summary; detail in SPEC §11 and CLAUDE.md)

- Unit tests on all domain logic. Coverage is posted as a PR comment on changed lines and treated as a guide, per the company standard; the one hard floor is on `packages/core` (grant evaluation, command state machine and, from Phase 4, emergency holds), where a missed branch can open or lock a gate.
- Property-based tests (fast-check) on grant and schedule evaluation, idempotency handling, webhook signature parsing and every vendor response parser.
- Contract tests: every endpoint validated against the committed OpenAPI in CI; breaking changes fail CI.
- Provider conformance kit: identical suite run against every provider; simulator is the reference; unofficial providers run against the hardware canary bench.
- Integration tests with Testcontainers (real Postgres in Docker) locally and in CI; Neon branches serve the preview deployments and e2e.
- E2E (Playwright): console flows and API journeys against the PR preview.
- Smoke tests (the same Playwright suite) as the last deploy step, with alert and rollback on failure; synthetic monitoring in production; paging from Sentry to a channel that wakes a person (§3 open decisions), Slack as the record, PostHog for trend alerts.
- Review: PR template (summary, issue link, how tested, risk level); one approval, two for auth, billing, the command and emergency path, and unofficial providers, enforced by CODEOWNERS; Claude Code review as the first pass. Solo phase: Claude review as a required check, merge by logged admin bypass, bypass log reviewed monthly by a second person.
- Release: a release issue per production deploy, and the production GitHub Environment requires a reviewer approval before Wrangler runs (in the solo phase the founder approves his own deploy, so it is a deliberate pause and an audit record, not a second pair of eyes); an internal ring (Fluss's own org) receives every production deploy first. Automated tests on the ring actuate the bench devices only, never the office gates.
- `oasdiff` blocks breaking API changes unless the version is bumped.
- Load tests (k6) before each phase gate.

### Operational hygiene

- Threat model (STRIDE) for the command path, webhooks and connector enrolment, kept in `docs/security/threat-model.md`; abuse cases become tests.
- Token revocation: 1-hour JWTs plus a `jti`/client denylist in KV checked at the edge, and an org-level "revoke everything" button.
- Webhook SSRF guard: destination URLs resolved and checked against private, loopback and cloud-metadata ranges at creation and at delivery.
- Backups: Neon point-in-time recovery, plus an automated monthly restore drill (restore to a branch, run the smoke suite, record RTO/RPO).
- SLOs with error budgets (command success, `acked` latency, webhook delivery); alerts page a human only when a budget burns fast. Everything else is a dashboard.
- Zero-downtime migrations: expand/contract pattern, `squawk` lint in CI, no migration may hold a lock across a large table.
- Renovate weekly grouped PRs (automerge dev-only deps), Dependabot alerts and dependency review, lockfile enforced, licence check, SBOM per release (cyclonedx-npm), Semgrep CE and gitleaks in CI failing on high severity.
- Architecture boundary lint (`dependency-cruiser`): routes → core → db; providers never import db.
- Docs as tests: every quickstart snippet runs in CI against the preview deployment.
- One game day before GA: provider outage, DB failover, DLQ drain, key rotation, with the runbooks open.

## 9. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Existing-backend work (SPEC §12.3) lands late, or there is no clean internal contract in time | Define SPEC §12 now and place the ask in November, before the December break (§3 open decisions); beta fallback is one owner account per org on the current public API with log polling |
| US-hosted DB adds ~250 ms per call for SA callers, and each provider call from US East to an SA-hosted vendor is another round trip | Measure in the Phase 0 spike and continuously from the Phase 2 synthetic checks, from Johannesburg; if p95 > budget (SPEC §9), stand up the `za` datastore in AWS Cape Town and move ZA orgs by runbook |
| Managed DB cost grows with scale | Vanilla Postgres only; revisit self-hosting (Hetzner US) or RDS when managed spend passes ~$2k/month |
| Verification semantics confuse partners | Every command response carries `verification_level`; docs explain the three levels with device examples |
| Partner migration drags | Migrate by existing API key so no claim code is collected per gate (SPEC §12.3 item 1b); side-by-side period, migration guide, we do the first integration with them |
| Scope creep from OEM requests | Everything goes through the provider interface; no bespoke endpoints |
| Single-founder bus factor during build | Everything in repo: ADRs, runbooks, CLAUDE.md; nothing in heads |
| Scope creep from the ideas backlog | SPEC §20 is explicitly not built without instruction; phase "done when" tests are the only gates |
| Neon region or Neon itself unavailable | Tier 1 warm standby on a different provider, drilled quarterly; off-provider dumps; RTO ≤ 15 min |
| Cloudflare outage or account lockout | Accepted at launch (SPEC §21.3): an outage stops API-originated commands only. From Phase 0: registrar and secondary DNS outside Cloudflare, keys escrowed offline, break-glass admin accounts, platform interfaces in place. After launch: Postgres-backed adapters kept green in CI and a break-glass container with its runbook |
| A vendor objects after being informed, or blocks or changes an unofficial integration | Vendors informed in Phase 3, before go-live, so an objection parks the provider behind its flag and nothing else moves; per-org flag, SLA exclusion and disclosure up front; nightly hardware canary and contract-drift alerts; kill switch within 24 h; Fluss+ retrofit offered as the official route |
| Counsel advises against an unofficial provider, or disclosure leads a vendor to change the login flow the provider uses | Counsel's review comes before any build (November), so the cost of a no is zero code; the link flow is isolated behind `beginLink`/`completeLink`, drift is caught by the canary, and a provider that cannot link with the owner's consent stays parked |
| Linking someone else's gates | Proof of control on every link (vendor OTP, or Fluss Ctrl OTP where the vendor's login proves nothing); link identity in every command's audit record |
| Lockdown traps someone or secures less than the control room believes | `egress` flag with a mandatory review before lockdown can be started, cleared whenever the device set or an egress flag changes; egress devices never held closed; each motor's pulse mode recorded, and a gate that a pulse cannot close is never pulsed (it would hold the gate open); per-device outcomes expose `unsupported`, `relies_on_autoclose` and `not_controlled`; fire-code and legal review (SANS 10400-T in SA, NFPA 101 in the US) before GA |
| Fluss+ app users' names and numbers reach a platform, or a US database, without a basis | Masked by default in provider-originated events; shared only if the unit's owner chose to at claim; inter-company data agreement between the SA company and Fluss Inc (SPEC §14) |

## 10. Success metrics

- Time-to-first-sandbox-open for a new developer (target < 60 min).
- Devices under management (live), and device-months billed.
- Trigger p95 latency to `acked` and to `confirmed`, by provider.
- Webhook delivery success within 60 s (target ≥ 99.9%).
- API uptime (target 99.95% measured externally).
- Percentage of SA partner platforms live on v1.

## 11. Compliance roadmap

Controls to bake in from Phase 0 (nearly free while the system is small): SSO/MFA with hardware keys on GitHub, Cloudflare, Neon and the registrar; least-privilege roles; branch protection with CI as a required check and a written change-management policy (solo-founder compensating control until there is a second reviewer: Claude review as a required check, merges by logged bypass, the log reviewed monthly by a second person); audit log of console/ops actions; encryption at rest and in transit; backup and restore evidence; vendor inventory with each subprocessor's SOC 2 report (Cloudflare, Neon, Sentry, PostHog, Paystack, Stripe); incident response plan and runbooks; quarterly access reviews; vulnerability management (Renovate, pen test); a `security.txt` and responsible-disclosure page; a simple public trust page.

Sequence: audit-ready by beta → compliance-automation platform (Vanta, Drata or Secureframe; startup pricing) about three months before US launch → SOC 2 Type I around US beta → Type II after a 6–12 month observation window → ISO 27001 when a South African or EU tender requires it (it shares most controls with SOC 2).

Unofficial integrations: counsel reviews both vendors' terms and the reverse-engineering position before either provider is built or run against a vendor cloud (briefed November 2026); Fluss Ctrl stores only the account owner's phone number as vendor identity; every linked account has recorded proof of control and consent; disclosure to platforms is written, not implied. Both vendors are informed in writing before go-live: security weaknesses disclosed first (December, so that a 90-day fix window closes before launch), then the notice of intended use in the first week of February with an invitation to make the integration official. The weaknesses are described only in the disclosure file kept with counsel's correspondence, not in the repository. An objection parks that provider; it does not move the launch.

Life safety: the emergency modes touch fire and egress regulations (SANS 10400-T in South Africa, NFPA 101 and local codes in the US). The product rule is that Fluss Ctrl never holds an egress route closed and never shortens a motor's own safety timing; the legal review before GA must cover lockdown explicitly, and the DPA/terms must state that the platform is responsible for marking egress devices correctly.

Privacy: Fluss Ctrl acts as processor for platforms (DPA template with POPIA s72 cross-border clause, since data is hosted in the US); Information Officer and PAIA manual obligations sit with the SA entity and should be confirmed; CCPA disclosures in the privacy policy once US users exist; GDPR only if an EU customer appears. Provider-originated events also carry data about Fluss+ app users who are not the platform's subjects: their names and numbers are masked unless the unit's owner chose to share them at claim, and the flow of that data from the SA company to Fluss Inc needs its own inter-company data agreement (SPEC §14). Hardware going to the US has its own track (UL 294, FCC) outside this plan.

## 12. Ideas backlog (parked, not scoped)

1. **Pass links**: a grant returns a hosted `pass_url` and QR; the visitor opens the gate from a browser, no app. Works across every platform and every brand, white-labelled, and every pass is a small advert to the next estate manager. The organic start of a cross-platform identity.
2. **Emergency modes**: one call evacuates (opens and holds) or locks down (closes, holds, refuses ordinary access, protects egress routes) a whole site; integrates with fire panels and armed-response control rooms. Control rooms will buy for this alone. (Scoped into v1, Phase 4; SPEC §4.)
3. **Tamper-evident log**: hash-chained events with periodic anchors, so an estate can prove who opened what in a dispute or insurance claim. Cheap to build, strong enterprise and insurer story, and chaining can start from any date, so it waits for a customer who wants it.
4. **Open provider SDK and conformance kit**: publish them under MIT so OEMs and integrators write their own providers, the way Home Assistant integrations and Terraform providers get written. Integration cost trends to zero.
5. **AI control room**: the MCP server lets a guard ask "who came in after 22:00 at Gate 2?" or "let the plumber in for two hours"; the audit log records the human who authorised the agent.
6. **Offline-tolerant connectors**: connectors cache grants locally so an API or internet outage never locks residents out.
7. **Estate health dashboards** for managing agents: busiest hours, offline rates, visitor volumes, from data you already hold.
8. **Keep the community Home Assistant integration working** on the existing API; goodwill with exactly the people who build on APIs.
9. **Device sharing between orgs**: the same gate reachable by the estate app and by a delivery platform, with the owner deciding what each may do. The schema already allows it (SPEC §2); it unlocks the cross-platform market.

## 13. Alignment with the Fluss engineering decisions

Adopted as written: task IDs in branch names, commits and PR titles, Given/When/Then acceptance criteria, STRIDE checklist on security-sensitive tasks, `TESTING.md`, GitHub Flow, Lefthook + commitlint, neostandard, TypeScript `strict`, Zod at every boundary with env validation at startup, Vitest + Testcontainers, Playwright for e2e and smoke, k6, fast-check, PR template and CODEOWNERS, Claude Code review action, organisation ruleset on `main`, Dependabot + dependency review, Semgrep CE + gitleaks, Renovate, release-please, preview → staging → production with an internal ring, Wrangler and Terraform from CI, Drizzle Kit migrations (staging first, backwards compatible), Sentry with release tags, PostHog flags and insight alerts, Workers Logs + Logpush to R2, blameless postmortems and retros with actions as tracked issues, DORA metrics into the KPI Machine, tech debt as labelled issues at about 20% of each cycle, MADR ADRs, Dev Containers.

Answers to the standard's open questions for this service: Postgres with Drizzle, so Drizzle Kit is the migration tool.

Deliberate exceptions:
1. **OpenStatus** for the public status page and external checks. The standard's alerting is used with one adjustment (Sentry does the paging; PostHog insight alerts are hourly and serve trends). A customer-facing status page is a separate need and must live outside Cloudflare (SPEC §21); OpenStatus is open source, and its hosted Starter plan is about $30/month (the free plan, one monitor at ten-minute intervals with three components, is too small).
2. **Coverage floor on `packages/core`.** The standard treats coverage as a guide, not a target; this repo keeps that rule everywhere except the safety-critical domain package, where the floor is an explicit exception.
3. **Hardware keys** rather than plain 2FA on GitHub, Cloudflare and Neon admin accounts, and offline key escrow with two holders (SPEC §21.4), mirroring the firmware signing-key rule.
4. **Feature flags split.** PostHog holds rollout flags for new code paths (name, owner, removal date per flag, evaluated off the command hot path and cached). Org entitlements, such as which organisation may enable an unofficial provider, live in the database, because they are product configuration, not rollout.
5. **Solo-phase review.** No second human approver until the team joins: the Claude Code review action is a required check on every PR, the ruleset still requires one approval (which a sole author cannot give, so every merge is a logged admin bypass), and a named second person reviews the bypass log monthly (decided 4 Nov 2026, tightened 10 Nov).
6. **GitHub Issues and Projects instead of Zoho Projects.** Fluss Ctrl is a Fluss Inc project outside the Zoho estate. The standard prefers Zoho because it is the company-wide backlog; where Zoho is not in play, GitHub is the natural home, costs nothing, and keeps the traceability rule intact (issue number in branch, commit and PR). The release sign-off becomes a GitHub Environment required reviewer instead of a Zoho API check. If the company later wants Fluss Ctrl visible in Zoho, mirror milestones rather than move the backlog.
