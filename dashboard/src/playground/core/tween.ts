// Camera tweens (CANVAS-13). One active tween per camera store, driven by the shared frame scheduler.
// Big jumps use van Wijk smooth zoom-pan (zoom out, travel, zoom in); anything the user does
// (wheel, pointer down, or another setCam) cancels it and keeps the current interpolated camera.
import type { Cam } from './types';
import type { CameraStore } from './camera';
import { scheduler as sharedScheduler, type Scheduler } from './raf';

export const MIN_MS = 250;
export const MAX_MS = 400;
const RHO = Math.SQRT2;

export function prefersReducedMotion(): boolean {
  const g = globalThis as { matchMedia?: (q: string) => { matches: boolean } };
  try { return !!g.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

type View = { w: number; h: number };
/** A camera as "centre of the view in world coordinates + visible world width". */
const toCenter = (c: Cam, v: View) => ({ cx: (v.w / 2 - c.x) / c.z, cy: (v.h / 2 - c.y) / c.z, w: v.w / c.z });
const fromCenter = (cx: number, cy: number, w: number, v: View): Cam => {
  const z = v.w / w;
  return { z, x: v.w / 2 - cx * z, y: v.h / 2 - cy * z };
};

/** Van Wijk path between two cameras: `at(t)` for t in 0..1 (already eased by the caller), plus its natural length S. */
export function planPath(from: Cam, to: Cam, view: View): { at(t: number): Cam; S: number } {
  const a = toCenter(from, view), b = toCenter(to, view);
  const dx = b.cx - a.cx, dy = b.cy - a.cy;
  const d = Math.hypot(dx, dy);
  const w0 = a.w, w1 = b.w;
  if (d < 1e-6 * Math.max(w0, w1)) {          // pure zoom: geometric interpolation of the width
    const S = Math.abs(Math.log(w1 / w0));
    return { S, at: (t) => fromCenter(a.cx, a.cy, w0 * Math.pow(w1 / w0, t), view) };
  }
  const r2 = RHO * RHO, r4 = r2 * r2;
  const b0 = (w1 * w1 - w0 * w0 + r4 * d * d) / (2 * w0 * r2 * d);
  const b1 = (w1 * w1 - w0 * w0 - r4 * d * d) / (2 * w1 * r2 * d);
  const q0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0), q1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
  const S = (q1 - q0) / RHO;
  return {
    S: Math.abs(S),
    at(t) {
      const s = t * S;
      const u = (w0 / r2) * Math.cosh(q0) * Math.tanh(RHO * s + q0) - (w0 / r2) * Math.sinh(q0);
      const w = (w0 * Math.cosh(q0)) / Math.cosh(RHO * s + q0);
      const k = u / d;
      return fromCenter(a.cx + dx * k, a.cy + dy * k, w, view);
    },
  };
}

export interface TweenOpts {
  /** ms; default scales with the distance, 250..400. */
  duration?: number;
  sched?: Scheduler;
  /** Force reduced motion on or off (default: the media query). */
  reduced?: boolean;
  /** Called once: true = reached the target, false = interrupted or replaced. */
  onDone?(completed: boolean): void;
}
export interface Tween { cancel(): void; readonly active: boolean }

interface Running { cancel(): void }
const running = new WeakMap<CameraStore, Running>();

export function cancelTween(store: CameraStore) { running.get(store)?.cancel(); }
export function isTweening(store: CameraStore): boolean { return running.has(store); }

const same = (a: Cam, b: Cam) => a.x === b.x && a.y === b.y && a.z === b.z;
const INPUT_EVENTS = ['wheel', 'pointerdown', 'touchstart'] as const;

export function tweenCam(store: CameraStore, target: Cam, opts: TweenOpts = {}): Tween {
  cancelTween(store);                                   // one tween at a time; the new one starts from the current camera
  const from = store.getCam();
  const view = store.getViewSize();
  const reduced = opts.reduced ?? prefersReducedMotion();
  const dead: Tween = { cancel() {}, active: false };
  if (reduced || view.w <= 0 || view.h <= 0 || same(from, target)) {
    store.setCam(target);
    opts.onDone?.(true);
    return dead;
  }
  const path = planPath(from, target, view);
  const dur = opts.duration ?? Math.min(MAX_MS, Math.max(MIN_MS, 180 + path.S * 120));
  const sched = opts.sched ?? sharedScheduler;
  let elapsed = 0, last: Cam = from, finished = false;

  const doc = (globalThis as { document?: { addEventListener: Function; removeEventListener: Function } }).document;
  const onInput = () => end(false);
  if (doc) for (const e of INPUT_EVENTS) doc.addEventListener(e, onInput, { capture: true, passive: true });

  const sub = sched.register((dt) => {
    if (finished) return;
    if (!same(store.getCam(), last)) { end(false); return; }   // someone else moved the camera
    elapsed += dt;
    const t = Math.min(1, elapsed / dur);
    if (t >= 1) { store.setCam(target); end(true); return; }
    store.setCam(path.at(easeOutCubic(t)));
    last = store.getCam();
    return true;
  }, -1);                                               // before the camera store's own notifier (priority 0)

  function end(completed: boolean) {
    if (finished) return;
    finished = true;
    if (doc) for (const e of INPUT_EVENTS) doc.removeEventListener(e, onInput, { capture: true });
    sub.dispose();
    if (running.get(store) === handle) running.delete(store);
    opts.onDone?.(completed);
  }
  const handle: Running & Tween = { cancel: () => end(false), get active() { return !finished; } };
  running.set(store, handle);
  sub.wake();
  return handle;
}
