import { defineConfig } from 'vitest/config';

// test/fixtures/ is a repo the tests map (it has its own *.test.ts); never run it.
export default defineConfig({ test: { include: ['test/**/*.test.ts'], exclude: ['test/fixtures/**', 'node_modules/**'] } });
