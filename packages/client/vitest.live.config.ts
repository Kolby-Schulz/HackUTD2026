// Live tests: the real client against a running SpacetimeDB (see test-live/README.md).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test-live/**/*.test.ts'],
    globalSetup: ['test-live/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
