// Architecture rules (SPEC §11 item 15, CLAUDE.md "Data and tenancy"). These are law: change them
// only through a reviewed PR that says why.
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies hide layering mistakes.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'routes-not-to-db',
      severity: 'error',
      comment: 'routes -> core -> db: routes (the entrypoint and routes/) reach the database only through packages/core.',
      from: { path: '^apps/api/src/(routes/|index\\.ts$)' },
      to: { path: '^packages/db/' },
    },
    {
      name: 'apps-other-than-api-not-to-db',
      severity: 'error',
      comment: 'Only the API Worker talks to the database (through packages/core).',
      from: { path: '^apps/(?!api/)' },
      to: { path: '^packages/db/' },
    },
    {
      name: 'db-not-to-core',
      severity: 'error',
      comment: 'routes -> core -> db: db is the bottom layer and never imports core.',
      from: { path: '^packages/db/' },
      to: { path: '^packages/core/' },
    },
    {
      name: 'providers-not-to-db',
      severity: 'error',
      comment: 'Providers never import db (SPEC §10).',
      from: { path: '^packages/providers/' },
      to: { path: '^packages/db/' },
    },
    {
      name: 'packages-not-to-apps',
      severity: 'error',
      comment: 'Libraries never import an app.',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
    {
      name: 'cloudflare-only-in-platform',
      severity: 'error',
      comment: 'SPEC §11 item 16, §21.3: only apps/api/src/platform touches Cloudflare (the cloudflare:* runtime modules and the Workers types). Everything else uses the Queue, Coordinator, Cache and RateLimiter ports in packages/core. Test files are covered by the next rule.',
      from: { path: '^(apps|packages)/', pathNot: ['^apps/api/src/platform/', '\\.test\\.ts$'] },
      to: { path: ['^cloudflare:', '^@cloudflare/workers-types'] },
    },
    {
      name: 'cloudflare-tests-only-test-module',
      severity: 'error',
      comment: 'Tests outside apps/api/src/platform may use the Workers test pool (cloudflare:test) and nothing else from Cloudflare.',
      from: { path: '\\.test\\.ts$', pathNot: '^apps/api/src/platform/' },
      to: { path: ['^cloudflare:', '^@cloudflare/workers-types'], pathNot: '^cloudflare:test$' },
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      comment: 'Every import must resolve.',
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(node_modules|dist|coverage|\\.wrangler|\\.turbo)/' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    combinedDependencies: true,
    preserveSymlinks: false,
    // The Workers runtime's own modules, resolved by workerd, not from node_modules.
    builtInModules: { add: ['cloudflare:workers', 'cloudflare:sockets', 'cloudflare:email', 'cloudflare:test'] },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'types', 'default'],
      extensions: ['.ts', '.js', '.mjs', '.cjs', '.json'],
      mainFields: ['module', 'main', 'types'],
    },
  },
}
