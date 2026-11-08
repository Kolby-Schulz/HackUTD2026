import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// The dashboard reads tables through packages/client's generated bindings (spec section 18:
// shared types come only from there). The client's own index.ts uses node:fs, so we alias the
// browser-safe bindings module directly instead of importing @contract/client.
const bindings = fileURLToPath(new URL('../packages/client/src/bindings', import.meta.url));
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig(({ mode }) => {
  // Same server as every other process: SPACETIME_HOST / SPACETIME_DB_NAME from the root .env
  // (maincloud for the two-laptop demo). A localhost host is left to the page, which then uses its
  // own hostname so a second laptop opening http://<demo-laptop>:5173 still finds port 3000.
  const env = loadEnv(mode, repoRoot, '');
  const host = env.VITE_SPACETIME_HOST || env.SPACETIME_HOST || '';
  const local = !host || /\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(host);
  return {
    plugins: [react()],
    resolve: { alias: { '@bindings': bindings } },
    define: {
      __SPACETIME_HOST__: JSON.stringify(local ? '' : host),
      __SPACETIME_DB_NAME__: JSON.stringify(env.VITE_SPACETIME_DB_NAME || env.SPACETIME_DB_NAME || 'contract'),
    },
    server: { host: true }, // reachable from the second demo laptop
    // Vendor code in its own cacheable chunks so no chunk passes Vite's 500 kB warning
    // (one 630 kB bundle before). Rolldown's codeSplitting groups; first match wins.
    build: {
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
              { name: 'flow', test: /node_modules[\\/](@xyflow|d3-[a-z-]+|classcat|zustand)[\\/]/ },
              { name: 'spacetimedb', test: /node_modules[\\/]spacetimedb[\\/]/ },
              { name: 'vendor', test: /node_modules[\\/]/ },
            ],
          },
        },
      },
    },
  };
});
