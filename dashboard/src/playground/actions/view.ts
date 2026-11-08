// View actions (KEYS-5, CANVAS-10, CANVAS-12): zoom in/out on the preset ladder, fit all, fit selection,
// 100/50/200 %. All moves are tweens (core/tween.ts) and are instant under reduced motion.
// Defining view.zoomFit and view.zoom100 here replaces the fallbacks in ui/board/viewActions.ts.
import type { Action, Cam, Rect } from '../core/types';
import type { CameraStore } from '../core/camera';
import { fitRect, zoomAt } from '../core/camera';
import { union } from '../core/geom';
import { isTweening, tweenCam } from '../core/tween';
import { worldBounds } from '../core/tree';
import { toast } from '../core/toast';
import { activeBoard, selectedIds } from '../ui/board/state';
import type { BoardEnv } from '../ui/board/state';

export const DEFAULT_CAM: Cam = { x: 60, y: 90, z: 0.55 };
/** Zoom presets in percent, smallest to largest (CANVAS-12). */
export const ZOOM_LADDER = [2, 3, 5, 6, 12, 25, 50, 100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600];

/** Next preset above (dir 1) or below (dir -1) the zoom `z`; stays on the end of the ladder. */
export function stepZoom(z: number, dir: 1 | -1): number {
  const pct = z * 100;
  const eps = 1e-6;
  if (dir > 0) return (ZOOM_LADDER.find((p) => p > pct * (1 + eps)) ?? ZOOM_LADDER[ZOOM_LADDER.length - 1]) / 100;
  return ([...ZOOM_LADDER].reverse().find((p) => p < pct * (1 - eps)) ?? ZOOM_LADDER[0]) / 100;
}

/** Camera for a fit of everything (80 px margin, at most 200 %), or the default camera on an empty board. */
export function planFitAll(content: Rect | null, view: { w: number; h: number }): Cam {
  return content ? fitRect(content, view, 80, 2) : DEFAULT_CAM;
}
/** Camera for a fit of the selection: a tiny rect fills about 70 % of the shorter view axis. */
export function planFitSelection(box: Rect, view: { w: number; h: number }): Cam {
  const r = box.w > 0 && box.h > 0 ? box : { x: box.x - 100, y: box.y - 100, w: 200, h: 200 };
  return fitRect(r, view, 0.15 * Math.min(view.w, view.h), 256);
}

// The camera a running key-repeat tween is heading for, so repeated presses keep stepping.
const heading = new WeakMap<CameraStore, Cam>();
function go(env: BoardEnv, cam: Cam, remember?: { rect: Rect; margin: number; maxZoom: number }) {
  heading.set(env.camera, cam);
  tweenCam(env.camera, cam, {
    duration: 220,
    onDone: (ok) => { if (ok && remember) env.camera.fitRect(remember.rect, { margin: remember.margin, maxZoom: remember.maxZoom }); },
  });
}
const baseCam = (env: BoardEnv): Cam => (isTweening(env.camera) ? heading.get(env.camera) ?? env.camera.getCam() : env.camera.getCam());

function contentBounds(env: BoardEnv): Rect | null {
  const st = env.board.doc.getState();
  const boxes = (st.children.get(null) ?? []).map((id) => worldBounds(st, id)).filter((r): r is Rect => !!r);
  return union(boxes);
}

function zoomFit(env: BoardEnv) {
  const r = contentBounds(env);
  go(env, planFitAll(r, env.camera.getViewSize()), r ? { rect: r, margin: 80, maxZoom: 2 } : undefined);
}
function zoomSelection(env: BoardEnv) {
  const st = env.board.doc.getState();
  const box = union(selectedIds(env.board).map((id) => worldBounds(st, id)).filter((r): r is Rect => !!r));
  if (!box) { toast('Select something first', { key: 'view.sel', onceMs: 1500 }); return; }
  go(env, planFitSelection(box, env.camera.getViewSize()));
}
/** Zoom to `z` around the pointer when it is over the board, else around the view centre. */
function zoomToward(env: BoardEnv, z: number, usePointer: boolean) {
  const v = env.camera.getViewSize();
  const p = usePointer && env.pointer.inside ? { x: env.pointer.x, y: env.pointer.y } : { x: v.w / 2, y: v.h / 2 };
  const cam = baseCam(env);
  go(env, zoomAt(cam, p, z / cam.z));
}
const zoomStep = (env: BoardEnv, dir: 1 | -1) => zoomToward(env, stepZoom(baseCam(env).z, dir), true);

const run = (fn: (env: BoardEnv) => void) => () => { const e = activeBoard(); if (e) fn(e); };
const ctx: Action['contexts'] = ['canvas', 'panel'];

export const actions: Action[] = [
  { id: 'view.zoomIn', title: 'Zoom in', group: 'View', keys: { all: ['Mod+Equal', 'Mod+Shift+Equal', 'Mod+NumpadAdd'] }, contexts: ctx, run: run((e) => zoomStep(e, 1)) },
  { id: 'view.zoomOut', title: 'Zoom out', group: 'View', keys: { all: ['Mod+Minus', 'Mod+NumpadSubtract'] }, contexts: ctx, run: run((e) => zoomStep(e, -1)) },
  { id: 'view.zoomFit', title: 'Zoom to fit', group: 'View', keys: { all: ['Shift+Digit1'] }, contexts: ctx, run: run(zoomFit) },
  { id: 'view.zoomSelection', title: 'Zoom to selection', group: 'View', keys: { all: ['Shift+Digit2'] }, contexts: ctx, run: run(zoomSelection) },
  { id: 'view.zoom100', title: 'Zoom to 100%', group: 'View', keys: { all: ['Mod+Digit0', 'Shift+Digit0'] }, contexts: ctx, run: run((e) => zoomToward(e, 1, false)) },
  { id: 'view.zoom50', title: 'Zoom to 50%', group: 'View', contexts: ctx, run: run((e) => zoomToward(e, 0.5, false)) },
  { id: 'view.zoom200', title: 'Zoom to 200%', group: 'View', contexts: ctx, run: run((e) => zoomToward(e, 2, false)) },
];
