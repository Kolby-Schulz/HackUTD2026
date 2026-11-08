// `npm run test:integration`: only the end-to-end judge.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/integration.test.ts'] },
});
