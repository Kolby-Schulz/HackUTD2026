// Live integration tests: real WebSocket clients against a running SpacetimeDB server.
// Run with `npm run test:live -w @contract/server` (needs `spacetime start`; see test-live/README).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test-live/**/*.test.ts'],
    globalSetup: ['test-live/setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
