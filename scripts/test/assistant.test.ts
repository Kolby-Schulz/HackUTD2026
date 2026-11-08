// Dashboard chat (scripts/assistant.ts): plan cleaning and what each action starts.
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { Assistant, buildPrompt, cleanPlan, type Plan, type Snapshot } from '../assistant.ts';
import { Registry } from '../control.ts';

type FakeChild = EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; pid: number; kill: () => void; args: string[] };

/** Fake processes: the test decides when each one exits. */
function fakeProcs() {
  const children: FakeChild[] = [];
  const spawn = ((_bin: string, args: string[]) => {
    const c = new EventEmitter() as FakeChild;
    c.stdout = new EventEmitter();
    c.stderr = new EventEmitter();
    c.pid = 999_999_999;
    c.args = args;
    c.kill = () => c.emit('exit', null);
    children.push(c);
    return c;
  }) as never;
  const find = (script: string, arg?: string) => children.find((c) => c.args[0] === script && (!arg || c.args.includes(arg)));
  const exit = (c: FakeChild | undefined, code: number, line = '') => {
    if (line) c!.stdout.emit('data', Buffer.from(line + '\n'));
    c!.emit('exit', code);
  };
  return { reg: new Registry(spawn, 'tsx', '/tmp'), children, find, exit };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const EMPTY: Snapshot = { coordinatorOnline: false, agents: [] };

function setup(plan: Partial<Plan>, snap: Snapshot = EMPTY) {
  const procs = fakeProcs();
  const sent: [string, string][] = [];
  const a = new Assistant({
    reg: procs.reg,
    decide: async () => ({ output: { reply: 'On it.', action: 'none', tasks: [], messages: [], ...plan } as Plan, usage: { prompt_tokens: 0, completion_tokens: 0, cache_read_tokens: 0, cost_usd: 0 } }),
    snapshot: async () => snap,
    sendInstruction: async (agent, text) => { sent.push([agent, text]); },
  });
  return { a, sent, ...procs };
}

describe('cleanPlan', () => {
  it('keeps a good plan and clamps a bad one', () => {
    expect(cleanPlan({ reply: 'ok', action: 'build', tasks: [{ title: 'Fees', task: 'Add late fees' }], messages: [] }))
      .toEqual({ reply: 'ok', action: 'build', tasks: [{ title: 'Fees', task: 'Add late fees' }], messages: [] });
    const bad = cleanPlan({ action: 'rm -rf', tasks: [{ task: '' }, { task: 'a' }, { task: 'b' }, { task: 'c' }, { task: 'd' }], messages: [{ agent: '', text: 'x' }] });
    expect(bad.action).toBe('none');
    expect(bad.tasks.map((t) => t.task)).toEqual(['a', 'b', 'c']);
    expect(bad.tasks[0].title).toBe('a');
    expect(bad.messages).toEqual([]);
    expect(cleanPlan(null).reply).toBe('OK.');
  });
});

describe('buildPrompt', () => {
  it('names the target repository', () => {
    const snap = { coordinatorOnline: false, agents: [] };
    expect(buildPrompt('hi', snap, [], [])).toContain('Repository the agents work on: demo-repo (the built-in demo');
    expect(buildPrompt('hi', snap, [], [], 'acme/shop')).toMatch(/Repository the agents work on: acme\/shop\n/);
  });

  it('tells the model the state and the recent chat', () => {
    const p = buildPrompt('add late fees', { openRun: { id: '9', mode: 'with_contract' }, coordinatorOnline: true, agents: [{ id: 'agent-a', status: 'working', task: 'Fees' }] },
      [{ id: 1, role: 'user', text: 'hi', at: 0 }], []);
    expect(p).toContain('#9 (with_contract)');
    expect(p).toContain('agent-a: working on "Fees"');
    expect(p).toContain('user: hi');
    expect(p).toMatch(/User: add late fees$/);
  });
});

describe('Assistant', () => {
  it('build: starts coordinator, session, one worker per task, then merges when all finish', async () => {
    const t = setup({ action: 'build', tasks: [{ title: 'Late fees', task: 'Add late fees' }, { title: 'Dates', task: 'Format dates' }] });
    const chat = t.a.chat('add late fees and format dates');
    await tick();
    expect(t.find('agents/coordinator/src/index.ts')).toBeDefined();
    t.exit(t.find('scripts/session.ts', 'start'), 0);
    await chat;
    expect(t.find('agents/worker/src/index.ts', 'agent-a')!.args).toEqual(['agents/worker/src/index.ts', '--id', 'agent-a', '--prompt', 'Add late fees']);
    expect(t.find('agents/worker/src/index.ts', 'agent-b')!.args).toContain('Format dates');

    t.exit(t.find('agents/worker/src/index.ts', 'agent-a'), 0);
    expect(t.find('scripts/session.ts', 'merge')).toBeUndefined(); // agent-b still working
    t.exit(t.find('agents/worker/src/index.ts', 'agent-b'), 0);
    await tick();
    t.exit(t.find('scripts/session.ts', 'merge'), 0, '[session] 12 passed');
    await tick();
    const texts = t.a.messages.map((m) => m.text);
    expect(texts).toContain('agent-a is working on: Late fees');
    expect(texts.at(-1)).toMatch(/^Done\..*12 passed/);
    expect(t.a.busy).toBe(false);
  });

  it('build: reuses an open run and coordinator, skips busy agent ids', async () => {
    const t = setup({ action: 'build', tasks: [{ title: 'X', task: 'Do X' }] },
      { openRun: { id: '9', mode: 'with_contract' }, coordinatorOnline: true, agents: [{ id: 'agent-a', status: 'working' }] });
    await t.a.chat('do x');
    expect(t.children.map((c) => c.args[0])).toEqual(['agents/worker/src/index.ts']);
    expect(t.children[0].args).toContain('agent-b');
  });

  it('build: reports a failed session and starts no workers', async () => {
    const t = setup({ action: 'build', tasks: [{ title: 'X', task: 'Do X' }] }, { coordinatorOnline: true, agents: [] });
    const chat = t.a.chat('do x');
    await tick();
    t.exit(t.find('scripts/session.ts', 'start'), 1, 'no response from maincloud');
    await chat;
    expect(t.a.messages.at(-1)!.text).toMatch(/Couldn't start a session: no response/);
    expect(t.find('agents/worker/src/index.ts')).toBeUndefined();
  });

  it('message: steers running agents', async () => {
    const t = setup({ action: 'message', messages: [{ agent: '*', text: 'Round half up' }] });
    await t.a.chat('make it round half up');
    expect(t.sent).toEqual([['*', 'Round half up']]);
    expect(t.a.messages.at(-1)!.text).toMatch(/every working agent/);
  });

  it('none: just answers; rejects empty and overlapping messages', async () => {
    const t = setup({ action: 'none', reply: 'Hi! What should I build?' });
    await expect(t.a.chat('  ')).rejects.toThrow(/empty/);
    const first = t.a.chat('hello');
    await expect(t.a.chat('again')).rejects.toThrow(/still working/);
    await first;
    expect(t.a.view().messages.map((m) => [m.role, m.text])).toEqual([['user', 'hello'], ['assistant', 'Hi! What should I build?']]);
    expect(t.a.view(1).messages).toHaveLength(1);
    expect(t.children).toEqual([]);
  });

  it('a model error shows up in the chat instead of crashing', async () => {
    const procs = fakeProcs();
    const a = new Assistant({ reg: procs.reg, decide: async () => { throw new Error('not logged in'); }, snapshot: async () => EMPTY, sendInstruction: async () => {} });
    await a.chat('build it');
    expect(a.messages.at(-1)).toMatchObject({ role: 'event', text: expect.stringMatching(/not logged in/) });
  });
});
