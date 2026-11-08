import { describe, expect, it } from 'vitest';
import { createCameraStore } from './camera';
import { createFakeFrameSource, createScheduler } from './raf';
import { planPath, tweenCam } from './tween';
import { goTo, onPulse, planGoTo } from './goto';
import { stepZoom } from '../actions/view';

function setup(cam = { x: 0, y: 0, z: 1 }) {
  const src = createFakeFrameSource();
  const sched = createScheduler(src);
  const store = createCameraStore(sched, cam);
  store.setViewRect({ left: 0, top: 0, width: 1000, height: 800 });
  return { src, sched, store };
}
const run = (src: ReturnType<typeof setup>['src'], frames: number) => { for (let i = 0; i < frames; i++) src.step(16); };

describe('tweenCam', () => {
  it('moves over several frames on the shared scheduler and lands exactly', () => {
    const { src, sched, store } = setup();
    const target = { x: -2000, y: -500, z: 0.25 };
    let done: boolean | null = null;
    tweenCam(store, target, { sched, reduced: false, onDone: (ok) => (done = ok) });
    src.step(16);
    const mid = store.getCam();
    expect(mid).not.toEqual(target);
    run(src, 40);
    expect(store.getCam()).toEqual(target);
    expect(done).toBe(true);
  });
  it('is instant under reduced motion and for zero distance', () => {
    const { sched, store } = setup();
    tweenCam(store, { x: 5, y: 6, z: 2 }, { sched, reduced: true });
    expect(store.getCam()).toEqual({ x: 5, y: 6, z: 2 });
    let ok: boolean | null = null;
    tweenCam(store, store.getCam(), { sched, reduced: false, onDone: (v) => (ok = v) });
    expect(ok).toBe(true);
  });
  it('stops when someone else moves the camera and does not snap back', () => {
    const { src, sched, store } = setup();
    let done: boolean | null = null;
    tweenCam(store, { x: -3000, y: 0, z: 1 }, { sched, reduced: false, onDone: (ok) => (done = ok) });
    run(src, 3);
    store.zoomAt({ x: 500, y: 400 }, 1.1);          // a wheel tick
    const after = store.getCam();
    run(src, 40);
    expect(store.getCam()).toEqual(after);
    expect(done).toBe(false);
  });
  it('a new tween replaces the running one, starting from the current camera', () => {
    const { src, sched, store } = setup();
    let first: boolean | null = null;
    tweenCam(store, { x: -3000, y: 0, z: 1 }, { sched, reduced: false, onDone: (ok) => (first = ok) });
    run(src, 4);
    const t2 = { x: 100, y: 100, z: 1 };
    tweenCam(store, t2, { sched, reduced: false });
    expect(first).toBe(false);
    run(src, 40);
    expect(store.getCam()).toEqual(t2);
  });
  it('van Wijk path hits both ends and zooms out in between on a long hop', () => {
    const view = { w: 1000, h: 800 };
    const from = { x: 0, y: 0, z: 1 }, to = { x: -50000, y: 0, z: 1 };
    const p = planPath(from, to, view);
    const a = p.at(0), b = p.at(1), m = p.at(0.5);
    expect(a.z).toBeCloseTo(1, 6); expect(b.z).toBeCloseTo(1, 6); expect(b.x).toBeCloseTo(-50000, 3);
    expect(m.z).toBeLessThan(0.5);
  });
});

describe('goTo', () => {
  it('animates on the given scheduler and pulses the target', () => {
    const { src, sched, store } = setup();
    const pulses: unknown[] = [];
    const off = onPulse((p) => pulses.push(p.rect));
    goTo({ x: 5000, y: 5000 }, { store, sched });
    off();
    expect(pulses.length).toBe(1);
    run(src, 40);
    expect(store.toWorld(500, 400)).toEqual({ x: 5000, y: 5000 });
  });
  it('keeps the zoom when the rect fits comfortably, fits otherwise', () => {
    const cam = { x: 0, y: 0, z: 1 }, view = { w: 1000, h: 800 };
    expect(planGoTo({ x: 100, y: 100, w: 100, h: 100 }, cam, view).z).toBe(1);
    expect(planGoTo({ x: 0, y: 0, w: 4000, h: 4000 }, cam, view).z).toBeLessThan(1);
  });
});

describe('stepZoom', () => {
  it('walks the preset ladder both ways and clamps', () => {
    expect(stepZoom(1, 1)).toBe(2);
    expect(stepZoom(1, -1)).toBe(0.5);
    expect(stepZoom(0.37, 1)).toBe(0.5);
    expect(stepZoom(0.37, -1)).toBe(0.25);
    expect(stepZoom(0.02, -1)).toBe(0.02);
    expect(stepZoom(256, 1)).toBe(256);
  });
});
