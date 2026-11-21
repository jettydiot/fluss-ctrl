---
status: accepted
date: 2026-11-21
decision-makers: Thomas
consulted: Claude (issue #6)
informed: —
---

# One SQLite-backed coordinator Durable Object per device; rate limits in their own objects

## Context and Problem Statement

Issue #6 builds the platform ports (SPEC §21.3) and the `DeviceCoordinator` Durable Object
skeleton (SPEC §7.2). A Durable Object's class name, the scheme that derives its id and its storage
backend cannot change once objects exist in production, so SPEC §18 item 12 (per device or per
controller) has to be settled before the first deploy, along with how rate limits are kept and where
the coordinator's logic lives.

## Decision Drivers

* A command must never reach a device twice, and never wait behind an unrelated output's command.
* Nothing held in memory may be needed after a deploy or an eviction (CLAUDE.md).
* The Postgres-backed adapters arrive post-launch (§21.3); the logic must not need rewriting then.
* Per-client `429`s should be exact, not approximate.

## Considered Options

* Coordinator per device (`idFromName("dev_…")`) or per controller (`ctl_…`)
* Rate limiter as a token bucket in a Durable Object, or Cloudflare's Rate Limiting binding
* SQLite-backed or KV-backed Durable Object storage
* Coordinator logic in the Durable Object class, or in `packages/core` on a host interface

## Decision Outcome

* **Per device.** A controller-level coordinator would serialise all of a unit's outputs, so a
  pedestrian-gate command would wait out the main gate's close confirm window (45 s by default).
  Pacing on a link shared by a unit's outputs, if a provider needs it, is a `RateLimiter` key per
  controller and does not touch the coordinator's identity.
* **Token bucket per `(policy, key)` in a `TokenBucketLimiter` Durable Object.** One object owns a
  bucket, so decisions are exact and serialised. The arithmetic (`takeTokens`) is pure, lives in
  `packages/core` and has property tests. Cloudflare's Rate Limiting binding counts per location,
  approximately, in fixed windows, which suits abuse protection but not a documented `429`.
* **SQLite-backed storage** (`new_sqlite_classes`) for both classes: Cloudflare's default for new
  classes, and the only backend that gets new storage features.
* **Logic in `DeviceCoordinatorCore` (`packages/core`)** over a `CoordinatorHost` (durable get, put,
  delete, one alarm). The Durable Object adapts `ctx.storage` and `alarm()` and holds nothing else.
  Phase 1's state machine is written and unit-tested there; a Postgres host can follow post-launch.

### Consequences

* Good, because outputs of one unit never block each other, and a restart resumes from storage.
* Good, because the Phase 1 command logic is testable in plain Vitest with an in-memory host.
* Bad, because two outputs of one unit can reach the vendor at the same moment; if a provider cannot
  take that, its adapter must add per-controller pacing through `RateLimiter`.
* Bad, because every rate-limited request pays one Durable Object round trip (beside the DB, with
  the `DO_LOCATION_HINT` configured for `us-east-1`).

### Confirmation

`apps/api/src/platform/*.test.ts` run in workerd and include an eviction (restart) test;
`packages/core/src/platform/*.test.ts` cover the core and the token bucket; dependency-cruiser
(`cloudflare-only-in-platform`) and an ESLint rule keep Cloudflare out of everything but
`apps/api/src/platform`.
