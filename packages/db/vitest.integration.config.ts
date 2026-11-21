import { defineProject } from 'vitest/config'

// Integration tests against a real Postgres in Docker (Testcontainers; SPEC §11 item 4).
export default defineProject({
  test: {
    name: 'db:integration',
    include: ['src/**/*.int.test.ts'],
    globalSetup: ['src/test/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
})
