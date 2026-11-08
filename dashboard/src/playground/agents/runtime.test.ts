import { describe, expect, it } from 'vitest';
import type { Command } from '../core/types';
import { createBoard } from '../core/commands';
import { createRuntime, startAgents } from './runtime';
import { COLS, CELL_H, CELL_W, createSlots, slotOrigin } from './scripted';
import { TEMPLATES } from './templates';
import { fakeBoard, fakeClock, mkShape, until } from './fakes.test';

const creates = (cmds: Command[]) => cmds.filter((c): c is Extract<Command, { t: 'shape.create' }> => c.t === 'shape.create');
function rig(frameMs = 50) {
  const fb = fakeBoard();
  const lines: string[] = [];
  const rt = createRuntime({ board: fb.board, clock: fakeClock(), seed: 3, frameMs, onSay: (_a, t) => lines.push(t) });
  return { ...fb, rt, lines };
}

describe('slot grid', () => {
  it('claims the lowest free cell and reports full', () => {
    const s = createSlots(2);
    expect([s.claim(), s.claim(), s.claim()]).toEqual([0, 1, -1]);
    s.clear();
    expect(s.claim()).toBe(0);
  });
  it('centres a template in its 500x620 cell, 5 columns', () => {
    expect(COLS).toBe(5); expect(CELL_W).toBe(500); expect(CELL_H).toBe(620);
    expect(slotOrigin(0, TEMPLATES[0])).toEqual({ x: 90, y: 40 });
    expect(slotOrigin(6, TEMPLATES[0])).toEqual({ x: 500 + 90, y: 620 + 40 });
  });
});

describe('runtime with scripted agents (fake board)', () => {
  it('spawns 3 agents; each builds a frame with children parented to it, one gesture per build', async () => {
    const { rt, gestures, batches, actors, lines } = rig();
    const ids = [rt.spawn(), rt.spawn(), rt.spawn()];
    expect(ids.every((id) => id.startsWith('agent-'))).toBe(true);
    expect(actors.size).toBe(3);
    await until(() => gestures.filter((g) => g.committed).length >= 3);
    rt.reset();
    for (const g of gestures.filter((g) => g.committed)) {
      expect(g.actor).toMatch(/^agent-/);
      const cs = creates(g.cmds);
      const frame = cs[0];
      expect(frame.kind).toBe('frame');
      expect(frame.parent).toBeUndefined();
      const tpl = TEMPLATES.find((t) => t.name === frame.props.name)!;
      expect(cs.length).toBe(tpl.children.length + 1);
      for (const c of cs.slice(1)) {
        expect(c.parent).toBe(frame.id);
        expect(c.props.x).toBeLessThan(tpl.w);          // frame-relative, not world
      }
      expect(frame.props).toMatchObject({ w: tpl.w, h: tpl.h });
      // typed text finished
      const t = cs.find((c) => c.kind === 'text')!;
      expect(t.props.text).toBeTruthy();
    }
    expect(batches.every((b) => b.actor.startsWith('agent-'))).toBe(true);
    expect(lines.some((s) => s.startsWith('Starting a '))).toBe(true);
    expect(lines.some((s) => s.startsWith('Finished the '))).toBe(true);
  });

  it('each agent gets its own slot', async () => {
    const { rt, gestures } = rig();
    rt.spawn(); rt.spawn(); rt.spawn();
    await until(() => gestures.filter((g) => g.committed).length >= 3);
    rt.reset();
    const origins = gestures.filter((g) => g.committed).slice(0, 3).map((g) => { const f = creates(g.cmds)[0]; return `${f.props.x},${Math.floor(f.props.y! / 620)}`; });
    expect(new Set(origins).size).toBe(3);
  });

  it('updates the gesture many times while building (animation) but commits once', async () => {
    const { rt, gestures } = rig();
    rt.spawn();
    await until(() => gestures.some((g) => g.committed));
    rt.reset();
    const g = gestures.find((g) => g.committed)!;
    expect(g.updates).toBeGreaterThan(50);
    expect(g.aborted).toBe(false);
  });

  it('answers a layer note: moves, applies one batch as the agent, says On it / Done', async () => {
    const fb = fakeBoard({ shapes: [mkShape('r1', { name: 'Box' })] });
    const lines: string[] = [];
    const rt = createRuntime({ board: fb.board, clock: fakeClock(), seed: 1, frameMs: 50, onSay: (_a, t) => lines.push(t) });
    const id = rt.spawn();
    const done = rt.request(id, { text: 'make it blue', shapeId: 'r1' });
    await done;
    rt.reset();
    const upd = fb.batches.find((b) => b.commands[0].t === 'shape.update')!;
    expect(upd.actor).toBe(id);
    expect(upd.commands).toEqual([{ t: 'shape.update', ids: ['r1'], patch: { fills: [{ type: 'solid', color: '#3b82f6' }] } }]);
    expect(lines).toContain('On it: Box.');
    expect(lines).toContain('Done: fill is now blue.');
  });

  it('missing layer, unknown note, and a template request choose the next build', async () => {
    const { rt, gestures, lines } = rig();
    const id = rt.spawn();
    await Promise.all([
      rt.request(id, { text: 'make it blue', shapeId: 'gone' }),
      rt.request(id, { text: 'dance' }),
      rt.request(id, { text: 'build a stat widget' }),
    ]);
    await until(() => gestures.filter((g) => g.committed).length >= 2);   // the build in flight, then the requested one
    rt.reset();
    expect(lines).toContain('That layer is gone now, so there is nothing to change.');
    expect(lines.some((l) => l.startsWith("I'm a scripted demo agent"))).toBe(true);
    expect(lines).toContain("Sure, I'll build a Stat widget next.");
    expect(creates(gestures.filter((g) => g.committed)[1].cmds)[0].props.name).toBe('Stat widget');
  });

  it('priority 3 jumps ahead of queued notes', async () => {
    const fb = fakeBoard({ shapes: [mkShape('r1', { name: 'Box' })] });
    const rt = createRuntime({ board: fb.board, clock: fakeClock(), seed: 1, frameMs: 50 });
    const id = rt.spawn();
    const first = rt.request(id, { text: 'bigger', shapeId: 'r1' });        // starts at once
    const a = rt.request(id, { text: 'bigger', shapeId: 'r1', priority: 0 });
    const b = rt.request(id, { text: 'make it blue', shapeId: 'r1', priority: 3 });
    await Promise.all([first, a, b]);
    rt.reset();
    const updates = fb.batches.filter((x) => x.commands[0].t === 'shape.update');
    expect(updates[1].commands[0]).toMatchObject({ patch: { fills: expect.anything() } });
  });

  it('stop mid-build commits what was drawn (one valid step) and marks the actor stopped; actor stays', async () => {
    const { rt, gestures, presence, actors } = rig();
    const id = rt.spawn();
    await until(() => gestures.length > 0 && gestures[0].updates > 20);
    rt.stop(id);
    await until(() => gestures[0].committed);
    expect(gestures[0].aborted).toBe(false);
    expect(presence.state.get(id)?.state).toBe('stopped');
    expect(actors.has(id)).toBe(true);
    const n = gestures[0].updates;
    await new Promise((r) => setTimeout(r, 20));
    expect(gestures[0].updates).toBe(n);
    rt.remove(id);
    expect(actors.has(id)).toBe(false);
  });

  it('pause freezes drawing, resume continues', async () => {
    const { rt, gestures, presence } = rig();
    const id = rt.spawn();
    await until(() => gestures.length > 0 && gestures[0].updates > 20);
    rt.setPaused(id, true);
    await new Promise((r) => setTimeout(r, 30));
    const frozen = gestures[0].updates;
    await new Promise((r) => setTimeout(r, 30));
    expect(gestures[0].updates).toBe(frozen);
    expect(presence.state.get(id)?.state).toBe('paused');
    rt.setPaused(id, false);
    await until(() => gestures[0].updates > frozen);
    rt.reset();
  });

  it('speed is global and readable', () => {
    const { rt } = rig();
    rt.setSpeed(2);
    expect(rt.getSpeed()).toBe(2);
  });
});

describe('with the real board', () => {
  function real() {
    const board = createBoard();
    const lines: string[] = [];
    const rt = startAgents(board, { clock: fakeClock(), seed: 5, frameMs: 50, onSay: (_a, t) => lines.push(t) });
    const finished = () => lines.filter((l) => l.startsWith('Finished the ')).length;
    return { board, rt, finished };
  }
  const live = (board: ReturnType<typeof createBoard>) => [...board.doc.getState().shapes.values()].filter((s) => !s.deleted);

  it('spawn 3 scripted agents against a fresh board; each frame has children with parent = frameId and every op has actor = agent-*', async () => {
    const { board, rt, finished } = real();
    const ids = [rt.spawn(), rt.spawn(), rt.spawn()];
    await until(() => finished() >= 3);
    rt.reset();
    expect(ids).toHaveLength(3);
    const shapes = live(board);
    const frames = shapes.filter((s) => s.kind === 'frame');
    expect(frames.length).toBeGreaterThanOrEqual(3);
    for (const f of frames) {
      expect(f.parent).toBeNull();
      const kids = shapes.filter((s) => s.parent === f.id);
      expect(kids.length).toBeGreaterThan(0);
      for (const k of kids) { expect(k.x).toBeLessThan(f.w); expect(k.createdBy).toMatch(/^agent-/); }
    }
    expect(shapes.filter((s) => s.parent !== null).every((s) => frames.some((f) => f.id === s.parent))).toBe(true);
    for (const e of board.doc.log()) expect(e.actor).toMatch(/^agent-/);
  });

  it("board.undo('agent-x') removes that agent's last template build in one step", async () => {
    const { board, rt, finished } = real();
    const id = rt.spawn();
    await until(() => finished() >= 1);
    rt.stop(id);
    await new Promise((r) => setTimeout(r, 20));
    expect(live(board).length).toBeGreaterThan(1);
    expect(board.undo(id)).toBe(true);
    expect(live(board)).toHaveLength(0);
    expect(board.undo(id)).toBe(false);
    rt.reset();
  });
});

// ---- WP-41: lifecycle, state machine, queue, pause, speed, takeover ----
import type { AgentContext, AgentDriver, BoardEvent, Task } from '../core/types';
import { canTransition } from './runtime';

/** A fake board whose subscribe really delivers, so tests can emit lock.revoked / claim events. */
function evRig() {
  const fb = fakeBoard();
  const subs: Array<{ kinds?: string[]; cb: (e: BoardEvent) => void }> = [];
  (fb.board as unknown as { subscribe: unknown }).subscribe = (f: { kinds?: string[] }, cb: (e: BoardEvent) => void) => {
    const s = { kinds: f.kinds, cb }; subs.push(s);
    return () => { subs.splice(subs.indexOf(s), 1); };
  };
  const emit = (e: object) => subs.filter((s) => !s.kinds || s.kinds.includes((e as BoardEvent).t)).forEach((s) => s.cb({ seq: 1, at: 0, ...e } as BoardEvent));
  return { ...fb, emit };
}

/** A driver that records the tasks it sees and holds each one until released. */
function holdDriver() {
  const seen: string[] = [];
  const releases: Array<() => void> = [];
  const ctxs: AgentContext[] = [];
  const drivers: AgentDriver[] = [];
  const make = (): AgentDriver => {
    const d: AgentDriver = {
      kind: 'scripted',
      start(c) { ctxs.push(c); },
      onTask(task: Task) { seen.push(task.text); return new Promise<void>((r) => releases.push(r)); },
      stop() {},
    };
    drivers.push(d);
    return d;
  };
  return { make, seen, releases, ctxs, drivers };
}

describe('state machine', () => {
  it('only a restart leaves stopped', () => {
    expect(canTransition('stopped', 'drawing')).toBe(false);
    expect(canTransition('stopped', 'idle')).toBe(true);
    expect(canTransition('drawing', 'paused')).toBe(true);
  });
  it('emits status.changed on every state change and keeps the driver state across pause', () => {
    const fb = evRig();
    const h = holdDriver();
    const rt = createRuntime({ board: fb.board, clock: fakeClock(), makeDriver: h.make });
    const seen: string[] = [];
    rt.onStatus((e) => seen.push(`${e.who}:${e.state}`));
    const id = rt.spawn();
    h.ctxs[0].setState('drawing', 'framing');
    rt.setPaused(id, true);
    h.ctxs[0].setState('thinking', 'while paused');   // held, not shown
    expect(fb.presence.state.get(id)!.state).toBe('paused');
    rt.setPaused(id, false);
    expect(fb.presence.state.get(id)!.state).toBe('thinking');
    rt.stop(id);
    h.ctxs[0].setState('drawing');                   // ignored once stopped
    expect(fb.presence.state.get(id)!.state).toBe('stopped');
    expect(seen).toEqual([`${id}:idle`, `${id}:drawing`, `${id}:paused`, `${id}:thinking`, `${id}:stopped`]);
  });
  it('agents spawned during global pause start paused', () => {
    const fb = evRig();
    const rt = createRuntime({ board: fb.board, clock: fakeClock(), makeDriver: holdDriver().make });
    rt.setAllPaused(true);
    const id = rt.spawn();
    expect(fb.presence.state.get(id)!.state).toBe('paused');
    rt.setAllPaused(false);
    expect(fb.presence.state.get(id)!.state).toBe('idle');
  });
});

describe('task queue in the runtime', () => {
  it('runs one task at a time per agent in priority order; cancel removes a queued task', async () => {
    const fb = evRig();
    const h = holdDriver();
    const rt = createRuntime({ board: fb.board, clock: fakeClock(), makeDriver: h.make });
    const id = rt.spawn();
    const done: string[] = [];
    const ask = (text: string, priority?: 0 | 1 | 2 | 3) => rt.request(id, { text, priority }).then(() => done.push(text));
    ask('first'); ask('low', 0); ask('mid'); ask('urgent', 3);
    expect(h.seen).toEqual(['first']);                       // others wait their turn
    const lowId = rt.tasks(id).find((t) => t.text === 'low')!.id;
    expect(rt.cancelTask(lowId)).toBe(true);
    h.releases.shift()!();
    await Promise.resolve(); await Promise.resolve();
    expect(h.seen).toEqual(['first', 'urgent']);
    h.releases.shift()!();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.seen).toEqual(['first', 'urgent', 'mid']);
    h.releases.shift()!();
    await new Promise((r) => setTimeout(r, 0));
    expect(done.sort()).toEqual(['first', 'low', 'mid', 'urgent']);
    expect(rt.tasks(id)).toEqual([]);
  });
  it('stop cancels queued and running tasks and restart gives a fresh queue', async () => {
    const fb = evRig();
    const h = holdDriver();
    const rt = createRuntime({ board: fb.board, clock: fakeClock(), makeDriver: h.make });
    const id = rt.spawn();
    const p = Promise.all([rt.request(id, { text: 'a' }), rt.request(id, { text: 'b' })]);
    rt.stop(id, 'Bryan');
    await p;
    expect(rt.tasks(id)).toEqual([]);
    rt.restart(id);
    expect(fb.presence.state.get(id)!.state).toBe('idle');
    rt.request(id, { text: 'c' });
    expect(h.seen).toEqual(['a', 'c']);
  });
});

describe('abort, takeover, speed', () => {
  it('a human taking over aborts the run, says so, releases claims and re-plans with a fresh driver', () => {
    const fb = evRig();
    const h = holdDriver();
    const lines: string[] = [];
    const rt = createRuntime({ board: fb.board, clock: fakeClock(), makeDriver: h.make, onSay: (_a, t) => lines.push(t) });
    const id = rt.spawn();
    const first = h.ctxs[0];
    fb.emit({ t: 'claim.granted', actor: id, claimId: 'c1', holder: id });
    fb.emit({ t: 'lock.revoked', actor: id, ids: ['s1'], by: 'human-you' });
    expect(first.signal.aborted).toBe(true);
    expect(lines).toEqual(["You took that over, I'll work elsewhere."]);
    expect(fb.batches.some((b) => b.actor === id && b.commands.some((c) => c.t === 'claim.release' && c.claimId === 'c1'))).toBe(true);
    expect(h.ctxs.length).toBe(2);                                 // re-planned: new driver, new signal
    expect(h.ctxs[1].signal.aborted).toBe(false);
    expect(rt.isStopped(id)).toBe(false);
    first.say('stale');                                           // the replaced driver can no longer talk
    expect(lines.length).toBe(1);
  });
  it('a takeover by someone else leaves unrelated agents alone', () => {
    const fb = evRig();
    const h = holdDriver();
    const rt = createRuntime({ board: fb.board, clock: fakeClock(), makeDriver: h.make });
    rt.spawn(); const b = rt.spawn();
    fb.emit({ t: 'lock.revoked', actor: b, ids: ['s1'], by: 'human-you' });
    expect(h.ctxs[0].signal.aborted).toBe(false);
    expect(h.ctxs[1].signal.aborted).toBe(true);
  });
  it('stop aborts the in-flight scripted gesture and every agent halts', async () => {
    const { rt, gestures, presence } = rig();
    const ids = [rt.spawn(), rt.spawn()];
    await until(() => gestures.some((g) => g.updates > 5));
    rt.stopAll('Bryan');
    await until(() => gestures.every((g) => g.committed || g.aborted));
    for (const id of ids) expect(presence.state.get(id)!.state).toBe('stopped');
    const after = gestures.reduce((n, g) => n + g.updates, 0);
    await new Promise((r) => setTimeout(r, 20));
    expect(gestures.reduce((n, g) => n + g.updates, 0)).toBe(after);   // nothing keeps drawing
  });
  it('speed multiplies the choreographer speed; speed 0 is step mode', () => {
    const fb = evRig();
    const rt = createRuntime({ board: fb.board, clock: fakeClock(), makeDriver: holdDriver().make });
    const id = rt.spawn();
    rt.setSpeed(2); rt.setAgentSpeed(id, 2);
    expect(rt.getSpeed()).toBe(2);
    expect(rt.getAgentSpeed(id)).toBe(2);
    rt.setSpeed(0);
    expect(rt.getSpeed()).toBe(0);
  });
});

describe('llm driver (WP-83)', () => {
  it('with no bridge URL the llm driver fails closed: it says bridge offline instead of throwing', async () => {
    const board = createBoard();
    const said: string[] = [];
    const rt = createRuntime({ board, clock: fakeClock(), seed: 3, frameMs: 50, onSay: (_a, t) => said.push(t) });
    const id = rt.spawn({ driver: 'llm' });
    await rt.request(id, { text: 'draw a button' });
    await until(() => said.some((t) => /bridge offline/i.test(t)));
    expect(said.some((t) => /bridge offline/i.test(t))).toBe(true);
    rt.reset();
  });
  it('slot seams: pickSlot claims a cell and freeSlot gives it back', () => {
    const rt = createRuntime({ board: createBoard(), clock: fakeClock() });
    const a = rt.pickSlot(), b = rt.pickSlot();
    expect(b).toBe(a + 1);
    rt.freeSlot(a);
    expect(rt.pickSlot()).toBe(a);
  });
});
