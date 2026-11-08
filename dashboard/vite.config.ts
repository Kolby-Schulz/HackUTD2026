import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// The dashboard reads tables through packages/client's generated bindings (spec section 18:
// shared types come only from there). The client's own index.ts uses node:fs, so we alias the
// browser-safe bindings module directly instead of importing @contract/client.
const bindings = fileURLToPath(new URL('../packages/client/src/bindings', import.meta.url));
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const CONTROL = 'http://127.0.0.1:5199';
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * Repository picking and the Control tab need this laptop's control server (scripts/control.ts).
 * So `npm run dashboard` starts it too when it isn't running yet (INSYNC_CONTROL=off to skip), and
 * the page can ask for it again through POST /__insync/control/start: only from this machine and
 * only with the control header, so a second laptop viewing the dashboard can't start processes here.
 * It stops when the dev server stops. Dev server only; a production build has no such endpoint.
 */
function controlServer(): Plugin {
  let child: ChildProcess | undefined;
  const up = () => fetch(`${CONTROL}/status?tail=0`).then((r) => r.ok, () => false);
  async function start(): Promise<'running' | 'starting' | 'started'> {
    if (await up()) return 'running';
    if (child && child.exitCode === null) return 'starting';
    child = spawn(process.execPath, [join(repoRoot, 'node_modules/tsx/dist/cli.mjs'), 'scripts/control.ts'], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    child.stdout?.on('data', (d) => process.stdout.write(d));
    child.stderr?.on('data', (d) => process.stderr.write(d));
    child.on('exit', () => { child = undefined; });
    return 'started';
  }
  const stop = () => { child?.kill(); child = undefined; };
  return {
    name: 'insync-control-server',
    apply: 'serve',
    configureServer(server) {
      if (process.env.INSYNC_CONTROL !== 'off') void start().then((r) => server.config.logger.info(`  InSync control server: ${r === 'running' ? 'already running' : 'starting on 127.0.0.1:5199'}`));
      server.middlewares.use('/__insync/control/start', (req, res) => {
        const local = LOOPBACK.has(req.socket.remoteAddress ?? '');
        if (req.method !== 'POST' || !local || req.headers['x-contract-control'] !== '1') {
          res.statusCode = local ? 400 : 403;
          res.end(JSON.stringify({ error: local ? 'POST with the control header only' : 'only from this laptop' }));
          return;
        }
        void start().then((status) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ status })); });
      });
      server.httpServer?.on('close', stop);
      process.once('exit', stop);
      process.once('SIGINT', () => { stop(); process.exit(0); });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Same server as every other process: SPACETIME_HOST / SPACETIME_DB_NAME from the root .env
  // (maincloud for the two-laptop demo). A localhost host is left to the page, which then uses its
  // own hostname so a second laptop opening http://<demo-laptop>:5173 still finds port 3000.
  const env = loadEnv(mode, repoRoot, '');
  const host = env.VITE_SPACETIME_HOST || env.SPACETIME_HOST || '';
  const local = !host || /\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(host);
  return {
    plugins: [react(), controlServer()],
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
