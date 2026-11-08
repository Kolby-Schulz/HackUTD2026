// Camera store and pure coordinate math (CANVAS-1, 2, 4, 39). No React, no DOM.
import type { Cam, Pt, Rect } from './types';
import { clampCoord } from './geom';
import { scheduler as defaultScheduler, type Scheduler } from './raf';

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 256;
export type ViewSize = { w: number; h: number };
/** Top-left of the view element in client px (a DOMRect satisfies this). */
export type ViewOrigin = { left: number; top: number };

export function clampZoom(z: number): number {
  const c = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
  return Number(c.toPrecision(6));            // no float drift at z=256
}

// ---- pure helpers ----
/** Client px -> world. `rect` is the view element's bounding rect (never the window). */
export function screenToWorld(p: Pt, cam: Cam, rect: ViewOrigin): Pt {
  return { x: (p.x - rect.left - cam.x) / cam.z, y: (p.y - rect.top - cam.y) / cam.z };
}
export function worldToScreen(p: Pt, cam: Cam, rect: ViewOrigin): Pt {
  return { x: p.x * cam.z + cam.x + rect.left, y: p.y * cam.z + cam.y + rect.top };
}
export function visibleWorldRect(cam: Cam, view: ViewSize): Rect {
  return { x: -cam.x / cam.z, y: -cam.y / cam.z, w: view.w / cam.z, h: view.h / cam.z };
}
/** Zoom by `factor` keeping the world point under `screenPt` (view-local px) fixed. z is clamped first, x/y follow the clamped z. */
export function zoomAt(cam: Cam, screenPt: Pt, factor: number): Cam {
  const z = clampZoom(cam.z * factor);
  const k = z / cam.z;
  return { z, x: screenPt.x - (screenPt.x - cam.x) * k, y: screenPt.y - (screenPt.y - cam.y) * k };
}
/** Camera that centres `rect` in the view with `margin` px around it; never zooms past maxZoom. */
export function fitRect(rect: Rect, view: ViewSize, margin = 60, maxZoom = 1.5): Cam {
  const zx = rect.w > 0 ? (view.w - 2 * margin) / rect.w : Infinity;
  const zy = rect.h > 0 ? (view.h - 2 * margin) / rect.h : Infinity;
  const z = clampZoom(Math.min(maxZoom, zx, zy));
  return { z, x: view.w / 2 - (rect.x + rect.w / 2) * z, y: view.h / 2 - (rect.y + rect.h / 2) * z };
}
/** Same zoom, same world point at the view centre, after the view changed size. */
export function resizeKeepCenter(cam: Cam, from: ViewSize, to: ViewSize): Cam {
  return { z: cam.z, x: cam.x + (to.w - from.w) / 2, y: cam.y + (to.h - from.h) / 2 };
}
export function sanitize(c: Cam): Cam {
  return { x: clampCoord(c.x), y: clampCoord(c.y), z: clampZoom(c.z) };
}

// ---- store ----
export interface SetCamOpts { animate?: 'fit' | 'goto' | number }   // animation is owned by goto.ts later; ignored (instant) here
export interface FitOpts { margin?: number; maxZoom?: number }
export interface CameraStore {
  getCam(): Cam;
  /** Applies at once to getCam(); subscribers run once in the next frame however many times this is called. */
  setCam(next: Cam, opts?: SetCamOpts): void;
  /** `fn` runs once per frame in which the camera changed. Same fn twice = one subscription (StrictMode safe). */
  subscribe(fn: (cam: Cam) => void): () => void;
  /** Like subscribe, but fn only runs when select(cam) changes (e.g. rounded zoom %, LOD bucket). */
  subscribeSelect<T>(select: (cam: Cam) => T, fn: (value: T, cam: Cam) => void): () => void;
  zoomAt(screenPt: Pt, factor: number): void;
  fitRect(rect: Rect, opts?: FitOpts): void;           // remembers the fit so a resize re-fits
  setViewRect(r: { left: number; top: number; width: number; height: number }): void; // cached; call from ResizeObserver
  getViewSize(): ViewSize;
  toWorld(clientX: number, clientY: number): Pt;
  toScreen(p: Pt): Pt;                                 // client px
  visibleRect(): Rect;
}

export function createCameraStore(sched: Scheduler = defaultScheduler, initial: Cam = { x: 60, y: 90, z: 0.55 }): CameraStore {
  let cam = sanitize(initial);
  let notified = cam;
  let view: ViewSize = { w: 0, h: 0 };
  let origin: ViewOrigin = { left: 0, top: 0 };
  let lastFit: { rect: Rect; opts: FitOpts } | null = null;
  const subs = new Set<(c: Cam) => void>();
  const sub = sched.register(() => {
    if (cam === notified) return;
    notified = cam;
    [...subs].forEach((f) => f(cam));
  }, 0);

  const apply = (next: Cam) => {
    const c = sanitize(next);
    if (c.x === cam.x && c.y === cam.y && c.z === cam.z) return;
    cam = c;
    sub.wake();
  };
  const store: CameraStore = {
    getCam: () => cam,
    setCam(next) { lastFit = null; apply(next); },
    subscribe(fn) { subs.add(fn); return () => { subs.delete(fn); }; },
    subscribeSelect(select, fn) {
      let prev = select(cam);
      return store.subscribe((c) => { const v = select(c); if (!Object.is(v, prev)) { prev = v; fn(v, c); } });
    },
    zoomAt(p, factor) { lastFit = null; apply(zoomAt(cam, p, factor)); },
    fitRect(rect, opts = {}) {
      apply(fitRect(rect, view, opts.margin, opts.maxZoom));
      lastFit = { rect, opts };
    },
    setViewRect(r) {
      origin = { left: r.left, top: r.top };
      const next = { w: r.width, h: r.height };
      if (next.w === view.w && next.h === view.h) return;
      const prev = view;
      view = next;
      if (next.w <= 0 || next.h <= 0) return;          // hidden tab / collapsed: keep camera
      if (lastFit) apply(fitRect(lastFit.rect, view, lastFit.opts.margin, lastFit.opts.maxZoom));
      else if (prev.w > 0 && prev.h > 0) apply(resizeKeepCenter(cam, prev, view));
    },
    getViewSize: () => view,
    toWorld: (x, y) => screenToWorld({ x, y }, cam, origin),
    toScreen: (p) => worldToScreen(p, cam, origin),
    visibleRect: () => visibleWorldRect(cam, view),
  };
  return store;
}

/** The app-wide camera. `window.board.cam` should return `camera.getCam()`. */
export const camera: CameraStore = createCameraStore();
export const getCam = () => camera.getCam();
export const setCam = (next: Cam, opts?: SetCamOpts) => camera.setCam(next, opts);
export const subscribeCam = (fn: (cam: Cam) => void) => camera.subscribe(fn);
