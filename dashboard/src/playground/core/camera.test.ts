import { describe, expect, it, vi } from 'vitest';
import { clampZoom, createCameraStore, fitRect, screenToWorld, visibleWorldRect, worldToScreen, zoomAt } from './camera';
import { createFakeFrameSource, createScheduler, MAX_DT } from './raf';
import { goTo } from './goto';

const rect = { left: 30, top: 50 };
describe('coordinate math', () => {
  it('round-trips across the zoom range', () => {
    for (const z of [0.02, 0.1, 1, 7.3, 64, 256]) {
      const cam = { x: -123.4, y: 987.6, z };
      const p = { x: 4321.5, y: -222.25 };
      const q = screenToWorld(worldToScreen(p, cam, rect), cam, rect);
      expect(Math.abs(q.x - p.x)).toBeLessThan(1e-9);
      expect(Math.abs(q.y - p.y)).toBeLessThan(1e-9);
    }
  });
  it('zoomAt keeps the pointer world point fixed', () => {
    const cam = { x: 40, y: -20, z: 0.7 };
    const sp = { x: 300, y: 200 };
    const before = screenToWorld(sp, cam, { left: 0, top: 0 });
    for (const f of [1.1, 0.5, 3, 100]) {
      const n = zoomAt(cam, sp, f);
      const after = screenToWorld(sp, n, { left: 0, top: 0 });
      expect(Math.abs(after.x - before.x)).toBeLessThan(1e-3);
      expect(Math.abs(after.y - before.y)).toBeLessThan(1e-3);
    }
  });
  it('clamps z with no x/y drift at the limit', () => {
    let c = { x: 10, y: 10, z: 200 };
    c = zoomAt(c, { x: 100, y: 100 }, 5);
    expect(c.z).toBe(256);
    const again = zoomAt(c, { x: 100, y: 100 }, 5);
    expect(again).toEqual(c);
    expect(clampZoom(0.0001)).toBe(0.02);
  });
  it('20 ticks in then 20 out returns to the start', () => {
    const start = { x: 80, y: 40, z: 1 };
    let c = start;
    const sp = { x: 250, y: 120 };
    for (let i = 0; i < 20; i++) c = zoomAt(c, sp, 1.1);
    for (let i = 0; i < 20; i++) c = zoomAt(c, sp, 1 / 1.1);
    expect(Math.abs(c.x - start.x)).toBeLessThan(0.01);
    expect(Math.abs(c.z - 1)).toBeLessThan(1e-4);
  });
  it('fitRect of a big rect gives z < 1 and centres it; zero rect is safe', () => {
    const c = fitRect({ x: 0, y: 0, w: 5000, h: 3000 }, { w: 1000, h: 800 });
    expect(c.z).toBeLessThan(1);
    expect(c.x + 2500 * c.z).toBeCloseTo(500, 6);
    expect(fitRect({ x: 5, y: 5, w: 0, h: 0 }, { w: 1000, h: 800 }).z).toBe(1.5);
    expect(fitRect({ x: 0, y: 0, w: 10, h: 10 }, { w: 0, h: 0 }).z).toBe(0.02);
  });
  it('visibleWorldRect', () => {
    expect(visibleWorldRect({ x: -100, y: -200, z: 2 }, { w: 400, h: 200 })).toEqual({ x: 50, y: 100, w: 200, h: 100 });
  });
});

function setup() {
  const src = createFakeFrameSource();
  const sched = createScheduler(src);
  return { src, sched, store: createCameraStore(sched, { x: 0, y: 0, z: 1 }) };
}
describe('camera store + scheduler', () => {
  it('coalesces setCam calls in one frame into one notification', () => {
    const { src, store } = setup();
    const fn = vi.fn();
    store.subscribe(fn);
    store.setCam({ x: 1, y: 1, z: 1 });
    store.setCam({ x: 2, y: 2, z: 1 });
    expect(store.getCam().x).toBe(2);
    expect(fn).not.toHaveBeenCalled();
    src.step();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0][0].x).toBe(2);
  });
  it('stops requesting frames when nothing is dirty', () => {
    const { src, store, sched } = setup();
    store.subscribe(() => {});
    store.setCam({ x: 5, y: 0, z: 1 });
    expect(src.pending()).toBe(1);
    src.step();
    expect(src.pending()).toBe(0);
    expect(sched.running()).toBe(false);
  });
  it('keeps running while a subscriber returns true, then sleeps', () => {
    const { src, sched } = setup();
    let n = 0;
    const sub = sched.register(() => ++n < 3);
    sub.wake();
    src.step(); src.step();
    expect(src.pending()).toBe(1);
    src.step();
    expect(n).toBe(3);
    expect(src.pending()).toBe(0);
  });
  it('same fn subscribed twice is one subscription; unsubscribe works', () => {
    const { src, store } = setup();
    const fn = vi.fn();
    const off = store.subscribe(fn); store.subscribe(fn);
    store.setCam({ x: 1, y: 0, z: 1 }); src.step();
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    store.setCam({ x: 2, y: 0, z: 1 }); src.step();
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it('subscribeSelect fires only when the selected value changes', () => {
    const { src, store } = setup();
    const fn = vi.fn();
    store.subscribeSelect((c) => Math.round(c.z * 100), fn);
    store.setCam({ x: 9, y: 9, z: 1 }); src.step();
    expect(fn).not.toHaveBeenCalled();
    store.setCam({ x: 9, y: 9, z: 2 }); src.step();
    expect(fn).toHaveBeenCalledWith(200, expect.anything());
  });
  it('pauses while hidden and clamps dt on return', () => {
    const { src, sched } = setup();
    const dts: number[] = [];
    const sub = sched.register((dt) => { dts.push(dt); return true; });
    sub.wake(); src.step(16);
    src.setHidden(true);
    src.step(16);                                  // pending frame sees hidden: runs nothing
    expect(dts.length).toBe(1);
    expect(src.pending()).toBe(0);
    src.time += 60_000;
    src.setHidden(false);
    expect(src.pending()).toBe(1);
    src.step(16);
    expect(dts[dts.length - 1]).toBeLessThanOrEqual(MAX_DT);
  });
  it('does not touch rAF when constructed (Node)', () => {
    expect(() => createScheduler()).not.toThrow();
  });
});

describe('view size and goTo', () => {
  it('keeps the view-centre world point on resize, re-fits after a fit', () => {
    const { store } = setup();
    store.setViewRect({ left: 0, top: 0, width: 1000, height: 800 });
    store.setCam({ x: -200, y: 100, z: 2 });
    const c0 = store.toWorld(500, 400);
    store.setViewRect({ left: 0, top: 0, width: 700, height: 800 });
    const c1 = store.toWorld(350, 400);
    expect(c1.x).toBeCloseTo(c0.x, 9);
    store.fitRect({ x: 0, y: 0, w: 2000, h: 1000 });
    const zFit = store.getCam().z;
    store.setViewRect({ left: 0, top: 0, width: 1400, height: 800 });
    expect(store.getCam().z).not.toBe(zFit);
    store.setViewRect({ left: 0, top: 0, width: 0, height: 0 });   // hidden: no change
    expect(Number.isFinite(store.getCam().z)).toBe(true);
  });
  it('goTo jumps for rect, cam and point', () => {
    const { store } = setup();
    store.setViewRect({ left: 0, top: 0, width: 1000, height: 800 });
    goTo({ x: 0, y: 0, w: 4000, h: 4000 }, { store });
    expect(store.getCam().z).toBeLessThan(1);
    goTo({ x: 7, y: 8, z: 2 }, { store });
    expect(store.getCam()).toEqual({ x: 7, y: 8, z: 2 });
    goTo({ x: 100, y: 100 }, { store });
    expect(store.toWorld(500, 400)).toEqual({ x: 100, y: 100 });
  });
});
