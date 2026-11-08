import { describe, expect, it } from 'vitest';
import { createCameraStore } from './camera';
import { createFakeFrameSource, createScheduler } from './raf';
import { createFollow, followTarget, trackPoint } from './follow';
import type { Presence } from './types';

function setup() {
  const src = createFakeFrameSource();
  const sched = createScheduler(src);
  const store = createCameraStore(sched, { x: 0, y: 0, z: 1 });
  store.setViewRect({ left: 0, top: 0, width: 1000, height: 800 });
  const rows = new Map<string, Presence>();
  const ends: string[] = [];
  const f = createFollow({ store, presence: { get: (a) => rows.get(a) }, me: 'me', kindOf: (a) => (a.startsWith('human') ? 'human' : 'other'), sched, onEnd: (id, why) => ends.push(`${id}:${why}`) });
  const run = (n: number) => { for (let i = 0; i < n; i++) src.step(16); };
  return { store, rows, f, run, ends };
}
const row = (o: Partial<Presence>): Presence => ({ actor: 'agent-a', lastInputAt: 0, ...o });
const screenOf = (s: ReturnType<typeof setup>['store'], x: number, y: number) => ({ x: x * s.getCam().z + s.getCam().x, y: y * s.getCam().z + s.getCam().y });

describe('followTarget / trackPoint', () => {
  it('prefers cursor, then focus, then viewport; humans use their viewport', () => {
    expect(followTarget(row({ x: 5, y: 6, focus: { x: 0, y: 0, w: 10, h: 10 } }), 'other')?.pt).toEqual({ x: 5, y: 6 });
    expect(followTarget(row({ focus: { x: 0, y: 0, w: 10, h: 10 } }), 'other')?.pt).toEqual({ x: 5, y: 5 });
    expect(followTarget(row({ x: 1, y: 1, viewport: { x: 0, y: 0, w: 100, h: 50, z: 2 } }), 'human')).toEqual({ pt: { x: 50, y: 25 }, z: 2 });
    expect(followTarget(undefined, 'other')).toBeNull();
    expect(followTarget(row({}), 'other')).toBeNull();
  });
  it('leaves the camera alone while the point is inside the inner 60%', () => {
    const cam = { x: 0, y: 0, z: 1 };
    expect(trackPoint(cam, { w: 1000, h: 800 }, { x: 600, y: 400 }, 16, false).cam).toBe(cam);
    expect(trackPoint(cam, { w: 1000, h: 800 }, { x: 900, y: 400 }, 16, false).moving).toBe(true);
  });
});

describe('createFollow', () => {
  it('brings an off-screen agent cursor into the inner area and keeps it there as it moves', () => {
    const { store, rows, f, run } = setup();
    rows.set('agent-a', row({ x: 3000, y: 2000 }));
    expect(f.start('agent-a')).toBe(true);
    run(60);
    const p = screenOf(store, 3000, 2000);
    expect(Math.abs(p.x - 500)).toBeLessThan(100);
    expect(Math.abs(p.y - 400)).toBeLessThan(80);
    expect(store.getCam().z).toBe(1);
    rows.set('agent-a', row({ x: 3800, y: 2000 }));
    run(60);
    const q = screenOf(store, 3800, 2000);
    expect(q.x).toBeGreaterThan(200); expect(q.x).toBeLessThan(800);
    expect(f.current()).toBe('agent-a');
  });
  it('stops when the user moves the camera, and does not fight back', () => {
    const { store, rows, f, run, ends } = setup();
    rows.set('agent-a', row({ x: 3000, y: 0 }));
    f.start('agent-a');
    run(3);
    store.zoomAt({ x: 500, y: 400 }, 1.1);
    const after = store.getCam();
    run(30);
    expect(f.current()).toBeNull();
    expect(store.getCam()).toEqual(after);
    expect(ends).toEqual(['agent-a:user']);
  });
  it('stops when the actor is removed, and on stop()', () => {
    const { rows, f, run, ends } = setup();
    rows.set('agent-a', row({ x: 10, y: 10 }));
    f.start('agent-a'); run(2);
    rows.delete('agent-a'); run(2);
    expect(f.current()).toBeNull();
    rows.set('agent-a', row({ x: 10, y: 10 }));
    f.start('agent-a'); f.stop();
    expect(ends).toEqual(['agent-a:gone', 'agent-a:stopped']);
  });
  it('refuses to follow yourself or an actor with no presence', () => {
    const { rows, f } = setup();
    rows.set('me', row({ actor: 'me', x: 0, y: 0 }));
    expect(f.start('me')).toBe(false);
    expect(f.start('nobody')).toBe(false);
  });
  it('follows a human viewport (pan and zoom)', () => {
    const { store, rows, f, run } = setup();
    rows.set('human-b', row({ actor: 'human-b', viewport: { x: 1000, y: 1000, w: 500, h: 400, z: 2 } }));
    f.start('human-b');
    run(120);
    expect(store.getCam().z).toBeCloseTo(2, 1);
    const c = screenOf(store, 1250, 1200);
    expect(c.x).toBeCloseTo(500, -1); expect(c.y).toBeCloseTo(400, -1);
  });
});
