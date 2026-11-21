// neostandard (TypeScript) with its bundled ESLint Stylistic rules. No Prettier: style is lint.
import neostandard, { resolveIgnoresFromGitignore } from 'neostandard'

export default [
  // Global ignores: everything in .gitignore (build output, coverage, caches).
  { ignores: resolveIgnoresFromGitignore() },
  ...neostandard({ ts: true }),
  // Only apps/api/src/platform may use Cloudflare binding types (SPEC §11 item 16). Workers types
  // are ambient, so dependency-cruiser cannot see them; this rule does. Elsewhere, use the ports in
  // packages/core and `c.get('platform')`.
  {
    files: ['apps/api/src/**/*.ts'],
    ignores: ['apps/api/src/platform/**', 'apps/api/src/test-env.d.ts'],
    rules: {
      '@typescript-eslint/no-restricted-types': ['error', {
        types: Object.fromEntries([
          'DurableObjectNamespace', 'DurableObjectState', 'DurableObjectStorage', 'DurableObjectStub', 'DurableObjectId',
          'KVNamespace', 'MessageBatch', 'Message', 'R2Bucket', 'D1Database', 'Hyperdrive', 'Fetcher',
          'AnalyticsEngineDataset', 'RateLimit', 'Workflow',
        ].map((name) => [name, { message: 'Cloudflare bindings live in apps/api/src/platform; use the ports from @flussctrl/core.' }])),
      }],
    },
  },
]
