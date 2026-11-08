import { describe, expect, it } from 'vitest';
import type { Actor, AgentContext, Task } from '../core/types';
import { fakeBoard, mkShape } from './fakes.test';
import { commandError, createLlmDriver, probeBridge, validateReply } from './llm';
import { buildPerception } from './perception';
import { createUsageStore, formatChip } from './usage';

const me: Actor = { id: 'agent-1', kind: 'agent', name: 'Iris', color: '#f00', caps: ['read', 'write'], driver: 'llm' };
const task: Task = { id: 't1', agent: me.id, kind: 'note', text: 'make a card', priority: 1, from: 'human-you', state: 'running' };
const json = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status });

function setup(fetchImpl: typeof fetch) {
  const fb = fakeBoard({ shapes: [mkShape('f1', { kind: 'frame', w: 400, h: 300 }), mkShape('r1', { parent: 'f1' })] });
  const said: string[] = [], states: string[] = [];
  const ctx: AgentContext = {
    me, board: fb.board, intent: async () => {}, setState: (s) => { states.push(s); }, say: (t) => { said.push(t); },
    signal: new AbortController().signal, paused: () => false, rng: () => 0.5,
  };
  const usage = createUsageStore();
  const driver = createLlmDriver({ bridgeUrl: 'http://localhost:1', fetch: fetchImpl, usage });
  return { fb, ctx, said, states, usage, driver };
}
const good = { v: 1, say: 'done', commands: [{ t: 'shape.create', kind: 'rect', props: { x: 1, y: 2, w: 3, h: 4 } }], usage: { prompt_tokens: 100, completion_tokens: 20, cost_usd: 0.01 } };

describe('validation', () => {
  it('accepts a good reply and rejects bad ones', () => {
    expect(validateReply(good).ok).toBe(true);
    expect(validateReply({ v: 2 }).ok).toBe(false);
    expect(validateReply({ v: 1, commands: 'x' }).ok).toBe(false);
    expect(commandError({ t: 'status.set', state: 'idle' })).toMatch(/not allowed/);
    expect(commandError({ t: 'chat.say' })).toMatch(/not allowed/);
    expect(commandError({ t: 'shape.update', ids: ['a'], patch: { humanEdited: true } })).toMatch(/not allowed/);
    expect(commandError({ t: 'shape.update', ids: ['a'], patch: { x: NaN } })).toMatch(/invalid/);
    expect(validateReply({ v: 1, commands: Array(201).fill({ t: 'shape.delete', ids: ['a'] }) }).ok).toBe(false);
  });
});

describe('driver with a fake bridge', () => {
  it('executes a valid batch atomically and records usage', async () => {
    const s = setup(json(good) as unknown as typeof fetch);
    await s.driver.start(s.ctx);
    await s.driver.onTask(task);
    expect(s.fb.batches).toHaveLength(1);
    expect(s.fb.batches[0].commands).toEqual(good.commands);
    expect(s.said).toContain('done');
    expect(formatChip(s.usage.get(me.id))).toBe('120 tok · $0.01');
  });
  it('rejects invalid output after one repair retry, with a message', async () => {
    let n = 0;
    const bodies: any[] = [];
    const f = (async (_u: string, init: RequestInit) => { n++; bodies.push(JSON.parse(init.body as string)); return new Response(JSON.stringify({ v: 1, commands: [{ t: 'chat.say' }] })); }) as unknown as typeof fetch;
    const s = setup(f);
    await s.driver.start(s.ctx);
    await s.driver.onTask(task);
    expect(n).toBe(2);
    expect(bodies[1].repair).toMatch(/not allowed/);
    expect(s.fb.batches).toHaveLength(0);
    expect(s.said.join(' ')).toMatch(/could not do that/);
    expect(s.states).toContain('error');
  });
  it('bridge offline falls back to idle', async () => {
    const s = setup((async () => { throw new TypeError('fail'); }) as unknown as typeof fetch);
    await s.driver.start(s.ctx);
    await s.driver.onTask(task);
    expect(s.said.join(' ')).toMatch(/bridge offline/);
    expect(s.states.at(-1)).toBe('idle');
    expect(s.fb.batches).toHaveLength(0);
  });
  it('probeBridge never throws', async () => {
    expect(await probeBridge('http://x', (async () => { throw new Error('no'); }) as unknown as typeof fetch)).toBe(false);
    expect(await probeBridge('', fetch)).toBe(false);
    expect(await probeBridge('http://x', (async () => new Response('{}')) as unknown as typeof fetch)).toBe(true);
  });
});

describe('perception', () => {
  it('is size capped and scoped to the task frame', () => {
    const shapes = [mkShape('f1', { kind: 'frame', w: 5000, h: 5000 })];
    for (let i = 0; i < 300; i++) shapes.push(mkShape('s' + i, { parent: 'f1', x: i, y: i, text: 'hello world '.repeat(10) }));
    shapes.push(mkShape('far', { x: 99999, y: 99999 }));
    const fb = fakeBoard({ shapes });
    const p = buildPerception(fb.board, { me, task: { ...task, shapeId: 's5' }, maxBytes: 4000 });
    expect(JSON.stringify(p).length).toBeLessThanOrEqual(4000);
    expect(p.truncated).toBe(true);
    expect(p.frame?.id).toBe('f1');
    expect(p.shapes.find((s) => s.id === 'far')).toBeUndefined();
    expect(p.shapes[0].id).toBe('s5');
  });
});

describe('usage', () => {
  it('sums, flags estimates, caps the log, tolerates junk', () => {
    const u = createUsageStore();
    u.record('a', { prompt_tokens: 1000, completion_tokens: 500, estimated: true }, { label: 'x', ms: 10, ok: false });
    u.record('b', { prompt_tokens: 'junk' }, { label: 'y', ms: 30, ok: true });
    expect(u.totals().prompt_tokens).toBe(1000);
    expect(formatChip(u.get('a'))).toBe('~1.5k tok');
    for (let i = 0; i < 600; i++) u.record('a', {}, { label: 'z', ms: i, ok: true });
    expect(u.get('a').log).toHaveLength(500);
  });
});
