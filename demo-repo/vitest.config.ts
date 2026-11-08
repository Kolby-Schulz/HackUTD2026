// `npm test`: unit tests only. tests/integration.test.ts is the end-to-end judge that
// scripts/run-demo.ts runs after merging both agents' work; it is red at baseline by design.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/integration.test.ts', '**/node_modules/**'],
  },
});
