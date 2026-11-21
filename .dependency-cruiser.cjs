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
      name: 'only-db-to-drizzle',
      severity: 'error',
      comment: 'Every query goes through the org-scoped repositories in packages/db (SPEC §5, issue #5): nothing else imports Drizzle or the Postgres driver.',
      from: { pathNot: '^packages/db/' },
      to: { path: 'node_modules/(drizzle-orm|drizzle-kit|postgres)/' },
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
      name: 'not-to-unresolvable',
      severity: 'error',
      comment: 'Every import must resolve.',
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // node_modules is not followed but stays visible, so rules can name packages (only-db-to-drizzle).
    exclude: { path: '(^|/)(dist|coverage|\\.wrangler|\\.turbo)/' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    combinedDependencies: true,
    preserveSymlinks: false,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'types', 'default'],
      extensions: ['.ts', '.js', '.mjs', '.cjs', '.json'],
      mainFields: ['module', 'main', 'types'],
    },
  },
}
