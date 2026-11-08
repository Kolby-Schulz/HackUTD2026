// Control daemon (scripts/control.ts): request validation, the process registry and repo switching.
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { childEnv, cloneCommand, gitAccessHint, heldByAnotherDaemon, machineId, normalizeRepo, Registry, suffixedId, toCommand } from '../control.ts';

describe('toCommand', () => {
  it('maps each action to its script', () => {
    expect(toCommand({ action: 'coordinator' })).toMatchObject({ key: 'coordinator', args: ['agents/coordinator/src/index.ts'], long: true });
    expect(toCommand({ action: 'session-start' }).args).toEqual(['scripts/session.ts', 'start']);
    expect(toCommand({ action: 'session-merge', integration: true }).args).toEqual(['scripts/session.ts', 'merge', '--integration']);
    expect(toCommand({ action: 'session-merge', land: true }).args).toEqual(['scripts/session.ts', 'merge', '--land']);
    expect(toCommand({ action: 'session-merge', land: 'yes' }).args).toEqual(['scripts/session.ts', 'merge']);
    expect(toCommand({ action: 'reset' })).toMatchObject({ long: false });
  });
  it('starts a worker with --wait, or with the prompt as one argv entry', () => {
    expect(toCommand({ action: 'worker', id: 'agent-b' }).args).toEqual(['agents/worker/src/index.ts', '--id', 'agent-b', '--wait']);
    const prompt = 'Add late fees; rm -rf / && echo "$HOME"';
    expect(toCommand({ action: 'worker', id: 'agent-a', prompt }).args).toEqual(['agents/worker/src/index.ts', '--id', 'agent-a', '--prompt', prompt]);
  });
  it('rejects bad ids, long prompts and unknown actions', () => {
    expect(() => toCommand({ action: 'worker', id: '--evil' })).toThrow(/agent id/);
    expect(() => toCommand({ action: 'worker', id: 'Agent A' })).toThrow(/agent id/);
    expect(() => toCommand({ action: 'worker', id: 'a', prompt: 'x'.repeat(5000) })).toThrow(/longer/);
    expect(() => toCommand({ action: 'shell', cmd: 'ls' })).toThrow(/unknown action/);
    expect(() => toCommand(null)).toThrow();
  });
});

describe('machineId', () => {
  it('turns a hostname into a machine id', () => {
    expect(machineId('Ethans-MacBook-Pro.local')).toBe('ethans-macbook-pro');
    expect(machineId('my laptop (2)')).toBe('my-laptop-2-');
    expect(machineId('---')).toBe('laptop');
  });
});

describe('two laptops with the same hostname', () => {
  it('adds a 4-char suffix and stays within 64 chars', () => {
    expect(suffixedId('macbook-pro')).toMatch(/^macbook-pro-[a-z2-9]{4}$/);
    expect(suffixedId('macbook-pro', () => 0)).toBe('macbook-pro-aaaa');
    const long = suffixedId('x'.repeat(64));
    expect(long).toHaveLength(64);
    expect(long).toMatch(/^x{59}-[a-z2-9]{4}$/);
  });

  it('recognizes the server refusing an id another live daemon holds', () => {
    expect(heldByAnotherDaemon(new Error("machine 'mbp' is online with another daemon; stop it first (or wait 30 s)"))).toBe(true);
    expect(heldByAnotherDaemon(new Error('machine id is empty'))).toBe(false);
    expect(heldByAnotherDaemon('is online with another daemon')).toBe(false);
    expect(heldByAnotherDaemon(undefined)).toBe(false);
  });
});

/** A child process stand-in: emits output, exits when killed. */
function fakeSpawn() {
  const calls: string[][] = [];
  const envs: NodeJS.ProcessEnv[] = [];
  const fn = ((_bin: string, args: string[], opts: { env: NodeJS.ProcessEnv }) => {
    calls.push(args);
    envs.push(opts.env);
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; pid: number; kill: () => void };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.pid = 999_999_999; // no such process group, so stop() falls back to child.kill()
    child.kill = () => child.emit('exit', null);
    setTimeout(() => child.stdout.emit('data', Buffer.from('hello\nworld\n')), 0);
    return child;
  }) as never;
  return { fn, calls, envs };
}

describe('Registry', () => {
  it('starts, refuses a duplicate, keeps output and stops', async () => {
    const { fn } = fakeSpawn();
    const reg = new Registry(fn, 'tsx', '/tmp');
    reg.start(toCommand({ action: 'coordinator' }));
    expect(() => reg.start(toCommand({ action: 'coordinator' }))).toThrow(/already running/);
    await new Promise((r) => setTimeout(r, 5));
    expect(reg.view()[0]).toMatchObject({ key: 'coordinator', status: 'running', log: ['hello', 'world'] });
    expect(() => reg.forget('coordinator')).toThrow(/still running/);
    reg.stop('coordinator');
    expect(reg.view()[0].status).toBe('stopped');
    expect(() => reg.stop('coordinator')).toThrow(/not running/);
    reg.forget('coordinator');
    expect(reg.view()).toEqual([]);
  });

  it('passes its machine id to every child, and only when it has one', () => {
    const { fn, envs } = fakeSpawn();
    const reg = new Registry(fn, 'tsx', '/tmp');
    reg.start(toCommand({ action: 'coordinator' }));
    expect(envs[0].CONTRACT_MACHINE).toBe(process.env.CONTRACT_MACHINE);
    reg.machine = 'ethans-macbook-pro-k7q2';
    reg.start(toCommand({ action: 'judge' }));
    expect(envs[1]).toMatchObject({ CONTRACT_MACHINE: 'ethans-macbook-pro-k7q2', CONTRACT_TARGET: '' });
  });

  it('saves and reloads the machine id with the repo', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-'));
    const a = new Registry(fakeSpawn().fn, 'tsx', root);
    a.stateFile = join(root, '.contract', 'control.json');
    a.setMachine('mbp-ab34');
    a.setRepo('acme/app');
    const b = new Registry(fakeSpawn().fn, 'tsx', root);
    b.stateFile = a.stateFile;
    expect(b.load()).toBe('https://github.com/acme/app.git');
    expect(b.machine).toBe('mbp-ab34');
    const c = new Registry(fakeSpawn().fn, 'tsx', root);
    c.stateFile = join(root, 'missing.json');
    expect(c.load()).toBeUndefined();
    expect(c.machine).toBe('');
  });
});

describe('any repo', () => {
  const root = mkdtempSync(join(tmpdir(), 'control-'));
  mkdirSync(join(root, 'my', 'app'), { recursive: true });

  it('normalizes what people type', () => {
    expect(normalizeRepo('', root)).toBe('');
    expect(normalizeRepo('demo-repo', root)).toBe('');
    expect(normalizeRepo('acme/shop', root)).toBe('https://github.com/acme/shop.git');
    expect(normalizeRepo('https://github.com/acme/shop', root)).toBe('https://github.com/acme/shop.git');
    expect(normalizeRepo('github.com/acme/shop.git/', root)).toBe('https://github.com/acme/shop.git');
    expect(normalizeRepo('git@github.com:acme/shop.git', root)).toBe('git@github.com:acme/shop.git');
    expect(normalizeRepo('https://gitlab.com/a/b.git', root)).toBe('https://gitlab.com/a/b.git');
    expect(normalizeRepo('my/app', root)).toBe(join(root, 'my', 'app')); // an existing folder wins over owner/name
    expect(() => normalizeRepo('nope/missing/dir', root)).toThrow(/no such folder/);
    expect(() => normalizeRepo('--upload-pack=x', root)).toThrow(/can't start/);
  });

  it('clones a URL once, passes CONTRACT_TARGET, and refuses to switch mid-run', async () => {
    const env: (string | undefined)[] = [];
    const bins: string[] = [];
    const { fn } = fakeSpawn();
    const spy = ((bin: string, args: string[], o: { env: Record<string, string> }) => { bins.push(bin); env.push(o.env.CONTRACT_TARGET); return (fn as unknown as (...a: unknown[]) => unknown)(bin, args, o); }) as never;
    const reg = new Registry(spy, 'tsx', root);
    expect(cloneCommand('https://github.com/acme/shop.git', root)?.args).toEqual(['clone', 'https://github.com/acme/shop.git', join(root, '.contract', 'repos', 'acme', 'shop')]);
    const { clone } = reg.setRepo('acme/shop');
    expect(clone?.key).toBe('clone');
    expect(bins[0]).toBe('git');
    expect(reg.repoLabel()).toBe('acme/shop');
    expect(() => reg.start(toCommand({ action: 'coordinator' }))).toThrow(/still cloning/);
    expect(() => reg.setRepo('other/repo')).toThrow(/before switching/);
    reg.procs.get('clone')!.child!.emit('exit', 0);
    reg.start(toCommand({ action: 'coordinator' }));
    expect(env[1]).toBe('https://github.com/acme/shop.git');
    expect(() => reg.setRepo('')).toThrow(/before switching/);
    reg.stop('coordinator');
    reg.setRepo('');
    reg.start(toCommand({ action: 'session-start' }));
    expect(env[2]).toBe(''); // set even for the demo, so .env's CONTRACT_TARGET can't win
  });
});

describe('switching repos safely', () => {
  it('pulls an existing clone instead of cloning again', () => {
    const root = mkdtempSync(join(tmpdir(), 'control-'));
    mkdirSync(join(root, '.contract', 'repos', 'acme', 'shop', '.git'), { recursive: true });
    expect(cloneCommand('https://github.com/acme/shop.git', root)).toMatchObject({ label: 'Update repository', args: ['-C', join(root, '.contract', 'repos', 'acme', 'shop'), 'pull', '--ff-only'] });
  });

  it('needs a new session only when the open run mapped another repo', async () => {
    const root = mkdtempSync(join(tmpdir(), 'control-'));
    mkdirSync(join(root, 'app'));
    const { fn } = fakeSpawn();
    const reg = new Registry(fn, 'tsx', root);
    expect(reg.needsSession()).toBe(false); // demo, nothing started here: the open run is assumed to be the demo
    reg.setRepo('app');
    expect(reg.needsSession()).toBe(true);
    const p = reg.start(toCommand({ action: 'session-start' }));
    p.child!.emit('exit', 0);
    await p.exited;
    expect(reg.needsSession()).toBe(false);
    reg.setRepo('');
    expect(reg.needsSession()).toBe(true);
  });

});

describe('private repos', () => {
  it('never lets git prompt, and keeps a GIT_SSH_COMMAND the user set', () => {
    expect(childEnv({}, 'x')).toMatchObject({ CONTRACT_TARGET: 'x', GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' });
    expect(childEnv({ GIT_SSH_COMMAND: 'ssh -i key' }, '').GIT_SSH_COMMAND).toBe('ssh -i key');
  });

  it('explains an auth failure with a fix for that kind of URL', () => {
    const https = 'https://github.com/acme/secret.git';
    expect(gitAccessHint(["fatal: could not read Username for 'https://github.com': terminal prompts disabled"], https)).toMatch(/can't access .*gh auth setup-git/);
    expect(gitAccessHint(['git@github.com: Permission denied (publickey).'], 'git@github.com:acme/secret.git')).toMatch(/SSH key/);
    expect(gitAccessHint(['fatal: destination path exists and is not empty'], https)).toBeUndefined();
  });

  it('adds the hint as the last line when the clone fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'control-'));
    const { fn } = fakeSpawn();
    const reg = new Registry(fn, 'tsx', root);
    const { clone } = reg.setRepo('acme/secret');
    clone!.log.push('remote: Repository not found.');
    clone!.child!.emit('exit', 128);
    await clone!.exited;
    expect(clone!.log.at(-1)).toMatch(/can't access https:\/\/github.com\/acme\/secret.git/);
    expect(() => reg.start(toCommand({ action: 'coordinator' }))).toThrow(/gh auth setup-git/);
  });
});
