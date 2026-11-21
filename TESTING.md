# Testing

The layers come from SPEC §11. CI blocks a merge on any failure. Rules that apply to every layer
are in `CLAUDE.md` ("Testing"): bug fix means a failing test first; parsers and grant logic get
fast-check property tests; time-dependent code uses the injected clock; no `.skip` or `.only`.

| # | Layer | Tool | Command | Status |
|---|-------|------|---------|--------|
| 1 | Unit | Vitest | `pnpm test:unit` | ✅ runs every workspace's `src/**/*.test.ts` (and `scripts/*.test.mjs`) with coverage; CI `unit` job |
| 1a | Property-based | fast-check in Vitest | `pnpm test:unit` | arrives with the first parser or grant logic |
| 2 | Contract (routes vs committed `openapi.json`) | Vitest, oasdiff, Spectral | `pnpm test:unit`; oasdiff and Spectral in CI | needs OpenAPI generation (#7); oasdiff and Spectral jobs arrive with #7 |
| 3 | Provider conformance (simulator) | Vitest (`packages/conformance`) | `pnpm test:unit` | skeleton in #8 |
| 4 | Integration (real Postgres) | Vitest + Testcontainers | `pnpm test:integration` (Docker) | ✅ runs in CI (`integration` job); no suites until #5 |
| 4 | Integration (Cloudflare bindings: Durable Objects, KV, Queues) | Vitest + `@cloudflare/vitest-plugin` (Miniflare/workerd) | `pnpm test:unit` (no Docker) | ✅ every `apps/api` test runs inside workerd with the bindings from `apps/api/wrangler.jsonc`; remote bindings are off |
| 5 | E2E against the PR preview | Playwright | `pnpm test:e2e` (`$PREVIEW_URL`) | not yet implemented (#9) |
| 6 | Smoke (end of every deploy) | the Playwright suite | run by the deploy workflow | #9, #10 |
| 7 | Synthetic monitoring | OpenStatus, scheduled GitHub Action | none locally | later phase |
| 8 | Load | k6 | before each phase gate | later phase |
| 9 | Chaos | scripted scenarios | none locally | later phase |
| 10 | Security | Semgrep CE, gitleaks, dependency review, ZAP | gitleaks runs in the pre-commit hook; the rest in CI | ✅ Semgrep CE + gitleaks (`security.yml`), dependency review (`dependency-review.yml`); ZAP needs the preview (#9) |
| 11 | Regression | any layer above | — | every bug fix |
| 12 | Migrations | squawk, previous release's suite | CI | ✅ `squawk` job lints changed `packages/db/**.sql` (no-op until #5); previous-release suite later |
| 13 | Docs as tests | quickstart snippets | `pnpm test:docs` (`$PREVIEW_URL`) | not yet implemented (#9) |
| 15 | Architecture | dependency-cruiser | `pnpm lint` (runs `pnpm lint:deps`) | ✅ routes → core → db; providers never import db; only `apps/api/src/platform` imports `cloudflare:*` (plus an ESLint rule on the ambient binding types) |

Items 14 (restore drill), 16 (portability), 17 (DR drills), 18 (hardware canary) and 19 (vendor
contract drift) are scheduled jobs or later-phase work and have no local command.

## CI

Workflows live in `.github/workflows/` and use no secret other than the automatic `GITHUB_TOKEN`.

| Workflow | Runs on | Jobs |
|---|---|---|
| `ci.yml` | PRs, pushes to `main` | `lint` (ESLint + dependency-cruiser), `typecheck`, `unit` (`pnpm test:unit`, coverage floor, changed-lines comment), `integration` (`pnpm test:integration`, Docker on the runner), `squawk` (changed migrations), and `ci`, which passes only if all of them did |
| `security.yml` | PRs, pushes to `main` | `semgrep` (Semgrep CE, fails on ERROR severity), `gitleaks` (full history, any finding fails) |
| `dependency-review.yml` | PRs | GitHub dependency review, fails on high or critical |
| `release-please.yml` | pushes to `main` | opens or updates the release PR (manifest mode; no publish step) |

Every job installs with `pnpm install --frozen-lockfile` through `.github/actions/setup`, which also
restores the pnpm store and the Turborepo cache (`.turbo/cache`). Actions are pinned by commit SHA
with the version in a comment; Renovate keeps them current. The `ci` job is the one to require in
the `main` ruleset, alongside `Semgrep CE`, `gitleaks` and `Dependency review`.

## Running a subset

```sh
pnpm test:unit                                     # all unit tests, with coverage
pnpm --filter @flussctrl/api test                  # one workspace
pnpm --filter @flussctrl/api test src/env.test.ts  # one file
pnpm --filter @flussctrl/api test -t "refuses"     # one test by name
```

## Coverage

Coverage is reported for every workspace and treated as a guide, except for `packages/core`,
which has a hard floor (90% lines, branches, functions and statements, set in `vitest.config.ts`).
A missed branch there can open or lock a gate. The floor is never lowered to make a PR pass.

On every PR, CI posts (and then updates) one comment with coverage on the lines the PR adds,
computed by `scripts/coverage-changed-lines.mjs` from `coverage/lcov.info` and the diff against the
base. It is a guide, not a gate. To see it locally:

```sh
pnpm test:unit && node scripts/coverage-changed-lines.mjs --lcov coverage/lcov.info --base origin/main
```

## Writing tests

- Put unit tests next to the code: `src/thing.ts` and `src/thing.test.ts`.
- Each workspace has a `vitest.config.ts` (`defineProject`); the root config runs them all.
- Integration tests use a real Postgres via Testcontainers, never a mocked database.
- `apps/api` tests run inside workerd. Use `env` from `cloudflare:test` for bindings, and
  `evictDurableObject` to prove a Durable Object continues from storage alone after a restart.
- Tests never call a vendor cloud, the live Fluss backend or a real device.
