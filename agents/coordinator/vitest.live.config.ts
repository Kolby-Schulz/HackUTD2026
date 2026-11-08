// Layer 3: the real coordinator process against a running SpacetimeDB (needs `spacetime start`).
// Loads the repo's .env for NVIDIA_API_KEY; the Nemotron case is skipped without it.
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'vitest/config';

loadEnv({ path: new URL('../../.env', import.meta.url).pathname, quiet: true });

export default defineConfig({
  test: {
    include: ['test-live/**/*.test.ts'],
    globalSetup: ['test-live/setup.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
