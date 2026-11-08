// Live tests: the real MCP server process over stdio against a running SpacetimeDB.
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
