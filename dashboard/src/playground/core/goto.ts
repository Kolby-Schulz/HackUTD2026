// goTo: frozen signature. Stub = instant jump; the tween (CANVAS-13) replaces the body later.
import type { Cam, Pt, Rect } from './types';
import { camera, type CameraStore } from './camera';

/** Rect = fit it; Cam = jump there; Pt = centre on it keeping the current zoom. */
export type GoToTarget = Rect | Cam | Pt;
export interface GoToOpts { animate?: boolean | number; margin?: number; maxZoom?: number; store?: CameraStore }

export function goTo(target: GoToTarget, opts: GoToOpts = {}): void {
  const store = opts.store ?? camera;
  if ('w' in target) { store.fitRect(target, { margin: opts.margin, maxZoom: opts.maxZoom }); return; }
  if ('z' in target) { store.setCam(target); return; }
  const c = store.getCam(), v = store.getViewSize();
  store.setCam({ z: c.z, x: v.w / 2 - target.x * c.z, y: v.h / 2 - target.y * c.z });
}
