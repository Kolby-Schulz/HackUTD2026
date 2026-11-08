import { describe, expect, it } from 'vitest';
import { createBoard } from '../core/commands';
import { CANONICAL, createDemoRunner, demoHooks } from './demo';
import type { DemoClock, DemoEnv, DemoScript } from './demo';
import { createRuntime } from './runtime';
import type { ActionInfo } from './runtime';
import { fakeClock } from './fakes.test';

/** Demo time: sleeping advances a virtual clock and yields once so the agents (their own clock) can run. */
function demoClock(): DemoClock & { t: number } {
  const c = {
    t: 0,
    now: () => c.t,
    async sleep(ms: number, signal?: AbortSignal) { if (signal?.aborted) return; c.t += ms; await new Promise((r) => setTimeout(r, 0)); },
  };
  return c;
}

function rig() {
  const clock = demoClock();
  const board = createBoard({ me: 'human-1', now: () => clock.t });
  const cards: ActionInfo[] = [];
  const rt = createRuntime({ board, clock: fakeClock(), seed: 1, frameMs: 20, animate: false, onAction: (_a, c) => cards.push(c) });
  const moves: unknown[] = [];
  const env: DemoEnv = { board, rt, clock, goTo: (t) => moves.push(t), cards: () => cards.length };
  return { board, rt, env, cards, moves, clock };
}

/** Board output without ids, stamps and times: what a viewer would see. */
function snap(board: ReturnType<typeof createBoard>) {
  const st = board.doc.getState();
  const name = (id: string) => st.shapes.get(id)?.name ?? id;
  const rows = [...st.shapes.values()].filter((s) => !s.deleted).map((s) => {
    const { x, y, w, h, text, fills } = s as unknown as Record<string, unknown>;
    return JSON.stringify({ n: s.name, k: s.kind, p: s.parent ? name(s.parent) : null, x, y, w, h, text, fills });
  });
  return rows.sort();
}

async function runAll(script: DemoScript) {
  const r = rig();
  const runner = createDemoRunner(r.env, script);
  runner.play();
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('script did not finish')), 60000);
    runner.subscribe(() => { if (runner.getState().status === 'done') { clearTimeout(t); resolve(); } });
  });
  return { ...r, runner };
}

describe('canonical demo script', () => {
  it('is deterministic: two runs yield the same board', async () => {
    const a = await runAll(CANONICAL);
    const sa = snap(a.board);
    a.rt.reset();
    const b = await runAll(CANONICAL);
    const sb = snap(b.board);
    b.rt.reset();
    expect(sa.length).toBeGreaterThan(20);
    expect(sb).toEqual(sa);
    expect(a.cards.some((c) => c.summary === 'Changed fill to purple')).toBe(true);
    expect(a.runner.getState().index).toBe(CANONICAL.steps.length);
  }, 120000);

  it('opens a conflict, gets a coordinator line, and the purple edit lands', async () => {
    const r = await runAll(CANONICAL);
    r.rt.reset();
    expect(r.board.claims.list().some((c) => c.target.kind === 'frame')).toBe(true);
    expect(r.board.claims.conflicts().length).toBe(1);
    expect(r.board.actors.get('system-coordinator')).toBeTruthy();
    expect(r.moves.length).toBeGreaterThan(2);
  }, 120000);
});

describe('runner control', () => {
  const small: DemoScript = {
    id: 't', title: 't', seed: 1,
    steps: [
      { id: 'a', beat: 'A', t: 'caption', text: 'one' },
      { id: 'b', beat: 'B', t: 'wait', ms: 1e9 },
      { id: 'c', beat: 'C', t: 'caption', text: 'three' },
    ],
  };
  it('next runs one step when idle and skips a long wait while playing', async () => {
    const r = rig();
    // a clock that only wakes on abort, so the long wait really blocks
    r.env.clock = { now: () => 0, sleep: (_ms, signal) => new Promise<void>((res) => { if (signal?.aborted) res(); signal?.addEventListener('abort', () => res()); }) };
    const runner = createDemoRunner(r.env, small);
    runner.next();
    await new Promise((x) => setTimeout(x, 5));
    expect(runner.getState()).toMatchObject({ index: 1, status: 'paused', caption: 'one' });
    runner.play();
    await new Promise((x) => setTimeout(x, 5));
    expect(runner.getState().running).toBe(true);        // stuck in the huge wait
    runner.next();                                        // skip it
    await new Promise((x) => setTimeout(x, 10));
    expect(runner.getState()).toMatchObject({ index: 3, status: 'done', caption: 'three' });
    runner.dispose();
  });
  it('reset returns to step 0, clears agents and calls the WP-67 hooks', async () => {
    const r = rig();
    let hook = 0;
    demoHooks.reset = () => { hook++; };
    const runner = createDemoRunner(r.env, CANONICAL);
    runner.next(); runner.next();
    await new Promise((x) => setTimeout(x, 5));
    runner.reset();
    expect(runner.getState()).toMatchObject({ index: 0, status: 'idle', caption: null });
    expect(hook).toBe(1);
    demoHooks.reset = undefined;
    runner.dispose();
  });
  it('a missing agent reports a note instead of throwing', async () => {
    const r = rig();
    const toasts: string[] = [];
    r.env.toast = (t) => toasts.push(t);
    const runner = createDemoRunner(r.env, { id: 'x', title: 'x', seed: 1, steps: [{ id: 'a', beat: 'A', t: 'agent-task', agent: 'Nobody', text: 'hi', timeoutMs: 100 }] });
    runner.next();
    await new Promise((x) => setTimeout(x, 5));
    expect(toasts[0]).toMatch(/not on the board/);
    expect(runner.getState().status).toBe('done');
  });
});
