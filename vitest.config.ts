// Root test run (`npx vitest run` / `npm test` from the repo root). Each project uses its
// own vitest.config.ts, so the server suites get the SpacetimeDB module plugin. Live tests
// (test-live/) need a running server and are not included; run them per package with
// `npm run test:live -w <package>`.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['server', 'packages/client', 'packages/mcp', 'agents/worker'],
  },
});
