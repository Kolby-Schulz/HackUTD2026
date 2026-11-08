// Publishes the server module to a throwaway database (wiping it) before the coordinator live tests.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LIVE_DB, LIVE_HTTP } from './env.ts';

export default function setup() {
  const serverDir = fileURLToPath(new URL('../../../server', import.meta.url));
  execFileSync('spacetime', ['publish', '--server', LIVE_HTTP, '--module-path', '.', LIVE_DB, '--delete-data=always', '--yes'], {
    cwd: serverDir,
    stdio: 'inherit',
  });
}
