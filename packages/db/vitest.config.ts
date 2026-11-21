import { defineProject } from 'vitest/config'

// Unit tests only: no database. Integration tests (*.int.test.ts) run with
// `pnpm test:integration`, which needs Docker (vitest.integration.config.ts).
export default defineProject({
  test: {
    name: 'db',
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.int.test.ts'],
  },
})
