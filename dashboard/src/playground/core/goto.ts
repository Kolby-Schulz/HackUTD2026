// goTo (CANVAS-26): frozen signature `goTo(target: Rect | Cam | Pt, opts?)`. Moves are tweened
// (core/tween.ts) and the target is pulsed so the eye finds it. A custom `store` without `sched`
// jumps instantly (unit tests); the app-wide camera animates unless reduced motion is on.
import type { Cam, Pt, Rect } from './types';
import { camera, fitRect, visibleWorldRect, type CameraStore } from './camera';
import type { Scheduler } from './raf';
import { tweenCam } from './tween';
import { worldBounds, type TreeView } from './tree';
import type { ShapeId } from './types';

/** Rect = fit it; Cam = jump there; Pt = centre on it keeping the current zoom. */
export type GoToTarget = Rect | Cam | Pt;
export interface GoToOpts {
  animate?: boolean | number;       // false = instant; a number = duration in ms
  margin?: number; maxZoom?: number; store?: CameraStore; sched?: Scheduler;
  /** Pulse the target for ~400 ms. Default true for Rect and Pt targets. A string sets the ring colour. */
  pulse?: boolean | string;
}

export interface PulseEvent { rect: Rect; color?: string; ms: number; at: number }
const pulseSubs = new Set<(p: PulseEvent) => void>();
/** The board's overlay subscribes and draws a ring over `rect` (world coordinates) for `ms`. */
export function onPulse(fn: (p: PulseEvent) => void): () => void { pulseSubs.add(fn); return () => { pulseSubs.delete(fn); }; }
export const PULSE_MS = 400;
export function emitPulse(rect: Rect, color?: string) {
  const p: PulseEvent = { rect, color, ms: PULSE_MS, at: Date.now() };
  [...pulseSubs].forEach((f) => f(p));
}

const isRect = (t: GoToTarget): t is Rect => 'w' in t;
const isCam = (t: GoToTarget): t is Cam => 'z' in t;

/** Where the camera should end up for a target (pure). */
export function planGoTo(target: GoToTarget, cam: Cam, view: { w: number; h: number }, o: { margin?: number; maxZoom?: number } = {}): Cam {
  if (isCam(target)) return target;
  if (!isRect(target)) return { z: cam.z, x: view.w / 2 - target.x * cam.z, y: view.h / 2 - target.y * cam.z };
  const margin = o.margin ?? 60;
  const fit = fitRect(target, view, margin, o.maxZoom);
  // Fits comfortably at the current zoom: keep it and just centre; otherwise zoom out to fit.
  if (fit.z >= cam.z) return { z: cam.z, x: view.w / 2 - (target.x + target.w / 2) * cam.z, y: view.h / 2 - (target.y + target.h / 2) * cam.z };
  return fit;
}

export function goTo(target: GoToTarget, opts: GoToOpts = {}): void {
  const store = opts.store ?? camera;
  const view = store.getViewSize();
  const cam = store.getCam();
  const rectTarget = isRect(target);
  const instant = opts.animate === false || (opts.store !== undefined && opts.sched === undefined && opts.animate === undefined);

  // Rect targets that do not fit at the current zoom behave like fitRect: the store remembers the fit for resizes.
  const dest = planGoTo(target, cam, view, opts);
  const remember = rectTarget && dest.z !== cam.z && view.w > 0;
  const done = (ok: boolean) => { if (ok && remember) store.fitRect(target as Rect, { margin: opts.margin, maxZoom: opts.maxZoom }); };

  if (opts.pulse !== false && !isCam(target)) {
    emitPulse(rectTarget ? target : { x: target.x - 20, y: target.y - 20, w: 40, h: 40 }, typeof opts.pulse === 'string' ? opts.pulse : undefined);
  }
  if (instant) {
    if (remember) store.fitRect(target as Rect, { margin: opts.margin, maxZoom: opts.maxZoom });
    else store.setCam(dest);
    return;
  }
  tweenCam(store, dest, { sched: opts.sched, duration: typeof opts.animate === 'number' ? opts.animate : undefined, onDone: done });
}

/** `{shapeId}` target: centre and pulse a layer. Returns false when it no longer exists. */
export function goToShape(view: TreeView, id: ShapeId, opts: GoToOpts = {}): boolean {
  const r = worldBounds(view, id);
  if (!r) return false;
  const box = r.w > 0 && r.h > 0 ? r : { x: r.x - 100, y: r.y - 100, w: 200, h: 200 };
  const store = opts.store ?? camera;
  const v = store.getViewSize();
  // Already fully in view: no camera move, still pulse.
  const vis = visibleWorldRect(store.getCam(), v);
  const inView = box.x >= vis.x && box.y >= vis.y && box.x + box.w <= vis.x + vis.w && box.y + box.h <= vis.y + vis.h;
  if (inView) { if (opts.pulse !== false) emitPulse(box, typeof opts.pulse === 'string' ? opts.pulse : undefined); return true; }
  goTo(box, opts);
  return true;
}
