// Publishes the module to a throwaway database (wiping it) before the live tests run.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LIVE_DB, LIVE_HTTP } from './env';

export default function setup() {
  const serverDir = fileURLToPath(new URL('..', import.meta.url));
  execFileSync(
    'spacetime',
    ['publish', '--server', LIVE_HTTP, '--module-path', '.', LIVE_DB, '--delete-data=always', '--yes'],
    { cwd: serverDir, stdio: 'inherit' },
  );
}
