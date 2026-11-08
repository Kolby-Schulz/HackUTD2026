// Zoom actions the board needs today (Shift+1 fit, Cmd/Ctrl+0 100 %). They belong to
// actions/view.ts; registered here only when that file has not defined them, so its owner can
// take them over without a conflict.
import { getAction, registerAction } from '../../core/actions';
import { union } from '../../core/geom';
import { worldBounds } from '../../core/tree';
import type { Action, Rect } from '../../core/types';
import { activeBoard } from './state';
import type { BoardEnv } from './state';

export const DEFAULT_CAM = { x: 60, y: 90, z: 0.55 };

/** World bounds of everything on the board, or null when it is empty. */
export function contentBounds(env: BoardEnv): Rect | null {
  const st = env.board.doc.getState();
  const boxes = (st.children.get(null) ?? []).map((id) => worldBounds(st, id)).filter((r): r is Rect => !!r);
  return union(boxes);
}

export function zoomToFit(env: BoardEnv) {
  const r = contentBounds(env);
  if (!r) env.camera.setCam(DEFAULT_CAM);
  else env.camera.fitRect(r, { margin: 60, maxZoom: 1.5 });
}

export function zoomTo(env: BoardEnv, z: number) {
  const v = env.camera.getViewSize();
  env.camera.zoomAt({ x: v.w / 2, y: v.h / 2 }, z / env.camera.getCam().z);
}

const VIEW: Action[] = [
  { id: 'view.zoomFit', title: 'Zoom to fit', group: 'View', keys: { all: ['Shift+Digit1'] }, contexts: ['canvas', 'panel'], run: () => { const e = activeBoard(); if (e) zoomToFit(e); } },
  { id: 'view.zoom100', title: 'Zoom to 100%', group: 'View', keys: { all: ['Mod+Digit0'] }, contexts: ['canvas', 'panel'], run: () => { const e = activeBoard(); if (e) zoomTo(e, 1); } },
];

/** Register the fallbacks that are still missing. Returns the remover. */
export function registerViewFallbacks(): () => void {
  const offs = VIEW.filter((a) => !getAction(a.id)).map((a) => registerAction(a));
  return () => offs.forEach((f) => f());
}
