import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { defineProject } from 'vitest/config'

// Tests run inside workerd (Miniflare) with the bindings from wrangler.jsonc, so Durable Objects,
// KV and Queues are the real local implementations (SPEC §11 item 4). Nothing here reaches
// Cloudflare: remote bindings are off.
export default defineProject({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      remoteBindings: false,
      miniflare: {
        // A queue for the adapter tests only. Real queues arrive with the work that uses them.
        queueProducers: { TEST_QUEUE: { queueName: 'fluss-ctrl-test' } },
      },
    }),
  ],
  test: {
    name: 'api',
    include: ['src/**/*.test.ts'],
  },
})
