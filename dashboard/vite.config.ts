import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The dashboard reads tables through packages/client's generated bindings (spec section 18:
// shared types come only from there). The client's own index.ts uses node:fs, so we alias the
// browser-safe bindings module directly instead of importing @contract/client.
const bindings = fileURLToPath(new URL('../packages/client/src/bindings', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@bindings': bindings } },
  server: { host: true }, // reachable from the second demo laptop
});
