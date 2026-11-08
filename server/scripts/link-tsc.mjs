// postinstall: give server/ its own node_modules/.bin/tsc pointing at the root TypeScript, so
// `spacetime build --module-path .` finds tsc. Plain Node instead of `mkdir -p && ln -sf`, which
// fail in Windows cmd (and broke `npm install` there). Never fails the install.
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const bin = join('node_modules', '.bin');
try {
  mkdirSync(bin, { recursive: true });
  if (process.platform === 'win32') {
    // Symlinks need admin or Developer Mode on Windows; a .cmd shim works everywhere.
    writeFileSync(join(bin, 'tsc.cmd'), '@"%~dp0\\..\\..\\..\\node_modules\\.bin\\tsc.cmd" %*\r\n');
  } else {
    rmSync(join(bin, 'tsc'), { force: true });
    symlinkSync('../../../node_modules/.bin/tsc', join(bin, 'tsc'));
  }
} catch (e) {
  console.warn(`[server postinstall] couldn't link tsc (${e.message}); spacetime build may not find it`);
}
