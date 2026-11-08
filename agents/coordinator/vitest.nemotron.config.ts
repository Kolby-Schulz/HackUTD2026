// Layer 2: real Nemotron calls, no database. Loads the repo's .env for NVIDIA_API_KEY.
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'vitest/config';

loadEnv({ path: new URL('../../.env', import.meta.url).pathname, quiet: true });

export default defineConfig({
  test: { include: ['test-nemotron/**/*.test.ts'], testTimeout: 180_000, fileParallelism: false },
});
