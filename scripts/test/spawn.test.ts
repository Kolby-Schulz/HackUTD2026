// The control daemon's real process handling, with no fakes: tsx starts a TypeScript file, and Stop
// ends the process and the processes it started. CI runs this on Windows, macOS and Linux
// (.github/workflows/scripts-cross-platform.yml), since spawning tsx and stopping a process tree
// differ on Windows.
import { describe, expect, it } from 'vitest';
import { Registry, type Proc } from '../control.ts';

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const until = async (ok: () => boolean, ms = 15_000) => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) return false;
    await new Promise((r) => setTimeout(r, 100));
  }
  return true;
};

describe('Registry with real processes', () => {
  it('starts a TypeScript file through tsx and captures its output', async () => {
    const reg = new Registry();
    const exited = new Promise<Proc>((res) => reg.start({ key: 'coordinator', label: 'hello', args: ['scripts/test/fixtures/hello.ts'], long: false }, res));
    const p = await exited;
    expect(p.log.join('\n')).toContain('hello from tsx 42');
    expect(p.code).toBe(0);
  }, 30_000);

  it('stop ends the process and the process it started', async () => {
    const reg = new Registry();
    let done: Proc | undefined;
    const p = reg.start({ key: 'coordinator', label: 'tree', args: ['scripts/test/fixtures/tree.ts'], long: true }, (x) => { done = x; });
    expect(await until(() => p.log.some((l) => l.startsWith('grandchild ')))).toBe(true);
    const grandchild = Number(p.log.find((l) => l.startsWith('grandchild '))!.split(' ')[1]);
    expect(alive(grandchild)).toBe(true);

    reg.stop('coordinator');
    expect(await until(() => done !== undefined)).toBe(true);
    expect(p.status).toBe('stopped');
    expect(await until(() => !alive(grandchild))).toBe(true);
  }, 30_000);
});
