import { describe, expect, it } from 'vitest';
import type { Command } from '../core/types';
import { createRuntime } from './runtime';
import { COLS, CELL_H, CELL_W, createSlots, slotOrigin } from './scripted';
import { TEMPLATES } from './templates';
import { fakeBoard, fakeClock, mkShape, until } from './fakes.test';

const creates = (cmds: Command[]) => cmds.filter((c): c is Extract<Command, { t: 'shape.create' }> => c.t === 'shape.create');
const says = (batches: ReturnType<typeof fakeBoard>['batches']) =>
  batches.flatMap((b) => b.commands).filter((c) => c.t === 'chat.say').map((c) => (c as Extract<Command, { t: 'chat.say' }>).body).map((b) => (b.kind === 'text' ? b.text : ''));

function rig(frameMs = 50) {
  const fb = fakeBoard();
  const rt = createRuntime({ board: fb.board, clock: fakeClock(), seed: 3, frameMs });
  return { ...fb, rt };
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
    const { rt, gestures, batches, actors } = rig();
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
    expect(says(batches).some((s) => s.startsWith('Starting a '))).toBe(true);
    expect(says(batches).some((s) => s.startsWith('Finished the '))).toBe(true);
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
    const rt = createRuntime({ board: fb.board, clock: fakeClock(), seed: 1, frameMs: 50 });
    const id = rt.spawn();
    const done = rt.request(id, { text: 'make it blue', shapeId: 'r1' });
    await done;
    rt.reset();
    const upd = fb.batches.find((b) => b.commands[0].t === 'shape.update')!;
    expect(upd.actor).toBe(id);
    expect(upd.commands).toEqual([{ t: 'shape.update', ids: ['r1'], patch: { fills: [{ type: 'solid', color: '#3b82f6' }] } }]);
    const lines = says(fb.batches);
    expect(lines).toContain('On it: Box.');
    expect(lines).toContain('Done: fill is now blue.');
  });

  it('missing layer, unknown note, and a template request choose the next build', async () => {
    const { rt, batches, gestures } = rig();
    const id = rt.spawn();
    await Promise.all([
      rt.request(id, { text: 'make it blue', shapeId: 'gone' }),
      rt.request(id, { text: 'dance' }),
      rt.request(id, { text: 'build a stat widget' }),
    ]);
    await until(() => gestures.some((g) => g.committed));
    rt.reset();
    const lines = says(batches);
    expect(lines).toContain('That layer is gone now, so there is nothing to change.');
    expect(lines.some((l) => l.startsWith("I'm a scripted demo agent"))).toBe(true);
    expect(lines).toContain("Sure, I'll build a Stat widget next.");
    expect(creates(gestures.find((g) => g.committed)!.cmds)[0].props.name).toBe('Stat widget');
  });

  it('priority 3 jumps ahead of queued notes', async () => {
    const fb = fakeBoard({ shapes: [mkShape('r1', { name: 'Box' })] });
    const rt = createRuntime({ board: fb.board, clock: fakeClock(), seed: 1, frameMs: 50 });
    const id = rt.spawn();
    const a = rt.request(id, { text: 'bigger', shapeId: 'r1' });
    const b = rt.request(id, { text: 'make it blue', shapeId: 'r1', priority: 3 });
    await Promise.all([a, b]);
    rt.reset();
    const updates = fb.batches.filter((x) => x.commands[0].t === 'shape.update');
    expect(updates[0].commands[0]).toMatchObject({ patch: { fills: expect.anything() } });
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
  // enable after WP-08 merges
  it.skip('spawn 3 scripted agents against a fresh board; each frame has children with parent = frameId and every op has actor = agent-*', () => {});
  // enable after WP-08 merges
  it.skip("board.undo('agent-x') removes that agent's last template build in one step", () => {});
});
