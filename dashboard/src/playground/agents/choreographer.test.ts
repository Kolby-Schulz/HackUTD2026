import { describe, expect, it } from 'vitest';
import type { Rect } from '../core/types';
import { CANCEL, createChoreographer, seededRng } from './choreographer';
import { fakeClock, fakePresence } from './fakes.test';

function setup(seed = 7, extra: Partial<Parameters<typeof createChoreographer>[0]> = {}) {
  const clock = fakeClock(1e9);
  const pres = fakePresence();
  const c = createChoreographer({ actor: 'agent-a', presence: pres.bus, rng: seededRng(seed), clock, ...extra });
  return { clock, pres, c };
}
const path = (log: ReturnType<typeof fakePresence>['log']) => log.map((p) => [p.x, p.y, p.down]);

async function drawLayers(c: ReturnType<typeof setup>['c'], n: number) {
  for (let i = 0; i < n; i++) {
    const to: Rect = { x: 100 + (i % 5) * 90, y: 60 + Math.floor(i / 5) * 70, w: 80, h: 40 };
    await c.moveTo(to.x, to.y);
    if (i % 4 === 0) await c.intent({ t: 'type', shapeId: `s${i}`, text: 'Hello there' }, { rect: to });
    else await c.intent({ t: 'drag', shapeId: `s${i}`, to });
  }
}

describe('choreographer', () => {
  it('identical cursor paths for the same seed, different for another', async () => {
    const a = setup(), b = setup(), d = setup(8);
    for (const s of [a, b, d]) await drawLayers(s.c, 8);
    expect(path(a.pres.log)).toEqual(path(b.pres.log));
    expect(path(a.pres.log)).not.toEqual(path(d.pres.log));
    expect(a.clock.t).toBe(b.clock.t);
  });

  it('starts at the last known position on the bus', async () => {
    const pres = fakePresence();
    pres.bus.publish({ actor: 'agent-a', x: 300, y: 200, lastInputAt: 0 });
    const c = createChoreographer({ actor: 'agent-a', presence: pres.bus, rng: seededRng(1), clock: fakeClock() });
    expect(c.pos()).toEqual({ x: 300, y: 200 });
    await c.moveTo(500, 200);
    const first = pres.log[1];
    expect(first.x).toBeGreaterThan(300);
    expect(first.x).toBeLessThan(320);
  });

  it('a 40-layer plan finishes within 20 s simulated at 1x', async () => {
    const { c, clock } = setup();
    c.beginPlan(40);
    await drawLayers(c, 40);
    c.endPlan();
    expect(clock.t).toBeLessThanOrEqual(20000);
    expect(clock.t).toBeGreaterThan(3000);   // still visibly animated
  });

  it('without a plan the same layers take longer than 20 s (the budget is what speeds it up)', async () => {
    const { c, clock } = setup();
    await drawLayers(c, 40);
    expect(clock.t).toBeGreaterThan(20000);
  });

  it('speed 2 halves the time', async () => {
    const one = setup(), two = setup(7, { speed: () => 2 });
    await one.c.moveTo(800, 600);
    await two.c.moveTo(800, 600);
    expect(two.clock.t).toBeCloseTo(one.clock.t / 2, -1);
  });

  it('drag grows the layer with the cursor and ends at the full box with the button up', async () => {
    const { c, pres } = setup();
    const seen: Rect[] = [];
    await c.intent({ t: 'drag', shapeId: 's', to: { x: 10, y: 10, w: 100, h: 60 } }, { onDrag: (r) => seen.push(r) });
    expect(seen.length).toBeGreaterThan(5);
    expect(seen[0].w).toBeLessThan(seen[seen.length - 1].w);
    expect(seen[seen.length - 1]).toEqual({ x: 10, y: 10, w: 100, h: 60 });
    expect(pres.state.get('agent-a')?.down).toBe(false);
    expect(pres.log.some((p) => p.down === true)).toBe(true);
  });

  it('types one character at a time', async () => {
    const { c, pres } = setup();
    const typed: string[] = [];
    await c.intent({ t: 'type', shapeId: 't', text: 'Hey' }, { rect: { x: 0, y: 0, w: 100, h: 20 }, onType: (s) => typed.push(s) });
    expect(typed).toEqual(['H', 'He', 'Hey']);
    expect(pres.log.filter((p) => p.typing).map((p) => p.typing)).toEqual(['H', 'He', 'Hey']);
  });

  it('animate:false jumps without waiting', async () => {
    const { c, clock } = setup(1, { animate: false });
    await c.moveTo(900, 900);
    expect(c.pos()).toEqual({ x: 900, y: 900 });
    expect(clock.t).toBe(0);
  });

  it('holds while paused and resumes', async () => {
    let paused = true;
    const clock = fakeClock(20);
    const c = createChoreographer({ actor: 'agent-a', presence: fakePresence().bus, rng: seededRng(1), clock, paused: () => paused });
    let done = false;
    const p = c.wait(100).then(() => { done = true; });
    await new Promise((r) => setTimeout(r, 5));
    expect(done).toBe(false);
    expect(clock.t).toBeGreaterThan(0);          // it is polling, not progressing
    paused = false;
    await p;
    expect(done).toBe(true);
  });

  it('aborting throws CANCEL', async () => {
    const ctrl = new AbortController();
    const { c } = setup(1, { signal: ctrl.signal });
    const p = c.moveTo(1000, 1000);
    ctrl.abort();
    await expect(p).rejects.toBe(CANCEL);
  });
});
