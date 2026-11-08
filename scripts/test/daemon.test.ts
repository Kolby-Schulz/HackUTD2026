// Control daemon (scripts/daemon.ts): runs queued machine_command rows once, fails stale or bad
// ones, and pushes only what changed (machine state, processes, chat) back to the database.
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { Registry } from '../control.ts';
import { browserCommand, Daemon, MAX_PAIR_FAILURES, PAIR_CODE_TTL_MS, Pairer, pairProof, STALE_COMMAND_MS, type MachineCommand, type MachinePort } from '../daemon.ts';

function fakeSpawn() {
  const calls: string[][] = [];
  const fn = ((_bin: string, args: string[]) => {
    calls.push(args);
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; pid: number; kill: () => void };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.pid = 999_999_999;
    child.kill = () => child.emit('exit', null);
    return child;
  }) as never;
  return { fn, calls };
}

function setup(now = 1_000_000) {
  const { fn, calls } = fakeSpawn();
  const reg = new Registry(fn, 'tsx', '/tmp');
  const log: { finished: [bigint, boolean, string][]; procs: string[]; updates: number; deleted: string[] } = { finished: [], procs: [], updates: 0, deleted: [] };
  const port: MachinePort = {
    update: async () => void log.updates++,
    finish: async (id, ok, error) => void log.finished.push([id, ok, error]),
    putProcess: async (p) => void log.procs.push(`${p.procKey}:${p.status}`),
    deleteProcess: async (k) => void log.deleted.push(k),
    postChat: async () => undefined,
  };
  return { daemon: new Daemon(reg, port, undefined, () => now), reg, calls, log, now };
}

const cmd = (id: number, action: string, args: object = {}, createdAtMs = 1_000_000): MachineCommand => ({
  id: BigInt(id), action, argsJson: JSON.stringify(args), status: 'pending', createdAtMs,
});

describe('Daemon', () => {
  it('runs an allowed command once and reports the process', async () => {
    const { daemon, calls, log } = setup();
    await daemon.handle(cmd(1, 'worker', { id: 'agent-b' }));
    await daemon.handle(cmd(1, 'worker', { id: 'agent-b' })); // same row again (initial rows + onInsert)
    expect(calls).toEqual([['agents/worker/src/index.ts', '--id', 'agent-b', '--wait']]);
    expect(log.finished).toEqual([[1n, true, '']]);
    expect(log.procs).toEqual(['worker:agent-b:running']);
  });

  it('fails bad, unknown and stale commands without running anything', async () => {
    const { daemon, calls, log } = setup();
    await daemon.handle(cmd(1, 'worker', { id: '--evil' }));
    await daemon.handle(cmd(2, 'shell', { cmd: 'ls' }));
    await daemon.handle(cmd(3, 'reset', {}, 1_000_000 - STALE_COMMAND_MS - 1));
    await daemon.handle({ ...cmd(4, 'reset'), argsJson: '[1]' });
    expect(calls).toEqual([]);
    expect(log.finished.map(([id, ok, e]) => [id, ok, e.split(':')[0]])).toEqual([
      [1n, false, 'agent id'], [2n, false, 'unknown action "shell"'], [3n, false, 'expired'], [4n, false, 'command arguments must be a JSON object'],
    ]);
  });

  it('stops and forgets processes, and only resends what changed', async () => {
    const { daemon, reg, log } = setup();
    await daemon.handle(cmd(1, 'judge'));
    const updates = log.updates;
    await daemon.sync();
    expect(log.updates).toBe(updates); // nothing changed
    reg.procs.get('judge')!.child!.emit('exit', 0);
    await daemon.sync(); // the 1 s tick
    await daemon.handle(cmd(2, 'forget', { key: 'judge' }));
    expect(log.procs).toEqual(['judge:running', 'judge:exited']);
    expect(log.deleted).toEqual(['judge']);
    daemon.touch();
    await daemon.sync();
    expect(log.updates).toBe(updates + 1); // heartbeat
  });

  it('refuses chat when the assistant is off', async () => {
    const { daemon, log } = setup();
    await daemon.handle(cmd(1, 'chat', { text: 'hi' }));
    expect(log.finished).toEqual([[1n, false, 'chat is off on this laptop']]);
  });
});

describe('Pairer', () => {
  const ID = 'c200' + 'ab'.repeat(30);
  it('accepts the right proof once, and only for that identity', () => {
    const p = new Pairer(() => 0);
    const shown = p.fresh();
    expect(shown).toMatch(/^[A-Z2-9]{3}-[A-Z2-9]{3}$/);
    expect(p.check('c200' + 'cd'.repeat(30), pairProof(shown, ID))).toBe(false); // proof made for another identity
    expect(p.check(ID, pairProof(shown.toLowerCase().replace('-', ' '), ID.toUpperCase()))).toBe(true);
    expect(p.check(ID, pairProof(shown, ID))).toBe(false); // used up
  });
  it('expires, and gives up after too many wrong guesses', () => {
    let now = 0;
    const p = new Pairer(() => now);
    const shown = p.fresh();
    now = PAIR_CODE_TTL_MS + 1;
    expect(p.check(ID, pairProof(shown, ID))).toBe(false);
    now = 0;
    const again = p.fresh();
    for (let i = 0; i < MAX_PAIR_FAILURES; i++) p.check(ID, 'f'.repeat(64));
    expect(p.check(ID, pairProof(again, ID))).toBe(false);
  });
  it('builds a link with the code after the #', () => {
    expect(new Pairer().link('https://insync.vercel.app/', 'ethan-mbp', 'K7Q-4XM')).toBe('https://insync.vercel.app/#/pair?machine=ethan-mbp&code=K7Q-4XM');
  });
});

describe('browserCommand', () => {
  it('opens a URL without a shell on each platform', () => {
    const url = 'http://localhost:5173/#/pair?machine=a&code=K7Q-4XM';
    expect(browserCommand('darwin', url)).toEqual(['open', [url]]);
    expect(browserCommand('linux', url)).toEqual(['xdg-open', [url]]);
    expect(browserCommand('win32', url)).toEqual(['rundll32', ['url.dll,FileProtocolHandler', url]]);
  });
});
