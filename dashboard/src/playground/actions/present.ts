// Present mode (SHARE-11): top-level frames one at a time, full screen, in board order.
// `present.start` enters (Cmd/Ctrl+Alt+P or the palette), the Present slot (ui/Present.tsx) renders the HUD and
// handles keys. State lives here so the action and the slot share one source. Agents keep working underneath.
import { fitRect } from '../core/camera';
import { union } from '../core/geom';
import { toast } from '../core/toast';
import { tweenCam, cancelTween } from '../core/tween';
import { worldBounds } from '../core/tree';
import type { Action, Cam, DocState, Rect, Shape, ShapeId } from '../core/types';
import { activeBoard } from '../ui/board/state';

/** Frames in reading order: rows top to bottom, left to right inside a row. A frame joins the current row when its
 *  top is within half of that row's first frame's height of the row top. */
export function orderFrames<T extends { x: number; y: number; h: number }>(frames: readonly T[]): T[] {
  const byY = [...frames].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: T[][] = [];
  let rowTop = 0, rowH = 0;
  for (const f of byY) {
    if (rows.length && f.y - rowTop < rowH / 2) rows[rows.length - 1].push(f);
    else { rows.push([f]); rowTop = f.y; rowH = f.h; }
  }
  return rows.flatMap((r) => r.sort((a, b) => a.x - b.x));
}

/** Live top-level frames of a document, in presenting order. */
export function presentFrames(st: Pick<DocState, 'shapes' | 'children'>): Shape[] {
  const out: Shape[] = [];
  for (const id of st.children.get(null) ?? []) {
    const s = st.shapes.get(id);
    if (s && s.kind === 'frame' && !s.deleted && !s.hidden) out.push(s);
  }
  return orderFrames(out);
}

/** Camera that fills the view with `rect` (4 % margin, at most 800 %). */
export function planPresentCam(rect: Rect, view: { w: number; h: number }): Cam {
  return fitRect(rect, view, 0.04 * Math.min(view.w, view.h), 8);
}

export const nextIndex = (i: number, n: number): number => Math.min(Math.max(n - 1, 0), i + 1);
export const prevIndex = (i: number): number => Math.max(0, i - 1);

export interface PresentState { active: boolean; index: number; ids: ShapeId[]; cursors: boolean }
const IDLE: PresentState = { active: false, index: 0, ids: [], cursors: true };
let state: PresentState = IDLE;
const subs = new Set<() => void>();
const set = (p: Partial<PresentState>) => { state = { ...state, ...p }; subs.forEach((f) => f()); };
export const presentStore = { get: () => state, subscribe: (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; } };

let prevCam: Cam | null = null;
let enteredFullscreen = false;
export const FS_EVENT = 'fullscreenchange';
const root = (): HTMLElement | null => (typeof document === 'undefined' ? null : document.querySelector<HTMLElement>('.pg'));

/** Move the camera to frame `index` (or to everything when the board has no frame). `instant` skips the ease. */
export function showFrame(index: number, instant = false) {
  const env = activeBoard();
  if (!env || !state.active) return;
  const st = env.board.doc.getState();
  const ids = presentFrames(st).map((s) => s.id);
  const i = Math.max(0, Math.min(index, Math.max(ids.length - 1, 0)));
  set({ ids, index: i });
  const rect = ids.length
    ? worldBounds(st, ids[i])
    : union((st.children.get(null) ?? []).map((id) => worldBounds(st, id)).filter((r): r is Rect => !!r));
  const view = env.camera.getViewSize();
  if (!rect || view.w <= 0) return;
  const cam = planPresentCam(rect, view);
  if (instant) { cancelTween(env.camera); env.camera.setCam(cam); }
  else tweenCam(env.camera, cam, { duration: 150 });
}

/** Run once layout has settled: two frames, or 120 ms when frames are throttled (background pane), whichever is first. */
const afterLayout = (fn: () => void) => {
  if (typeof requestAnimationFrame === 'undefined') { fn(); return; }
  let done = false;
  const once = () => { if (!done) { done = true; fn(); } };
  requestAnimationFrame(() => requestAnimationFrame(once));
  setTimeout(once, 120);
};

export function startPresent() {
  const env = activeBoard();
  if (!env || state.active) return;
  prevCam = env.camera.getCam();
  const r = root();
  r?.setAttribute('data-present', '1');
  const ids = presentFrames(env.board.doc.getState()).map((f) => f.id);
  set({ active: true, index: 0, ids, cursors: true });   // the counter is right from the first paint
  if (!ids.length) toast('No frames yet: showing everything. Add a frame to present slides.', { key: 'present.none', onceMs: 4000 });
  // Fullscreen needs this user gesture; it fails quietly (embedded pane, denied) and the page-level full viewport stays.
  try {
    const p = r?.requestFullscreen?.();
    if (p) { enteredFullscreen = true; p.catch(() => { enteredFullscreen = false; }); }
  } catch { enteredFullscreen = false; }
  afterLayout(() => showFrame(0));          // chrome is hidden now; wait for the board to take its new size
}

export function stopPresent() {
  const env = activeBoard();
  if (!state.active) return;
  root()?.removeAttribute('data-present');
  set({ ...IDLE });
  if (enteredFullscreen && typeof document !== 'undefined' && document.fullscreenElement) { try { void document.exitFullscreen(); } catch { /* ignore */ } }
  enteredFullscreen = false;
  const back = prevCam;
  prevCam = null;
  if (env && back) {
    cancelTween(env.camera);
    env.camera.setCam(back);
    // panels coming back and leaving fullscreen resize the board late; put the old view back after both settle
    afterLayout(() => env.camera.setCam(back));
    setTimeout(() => { if (!state.active) env.camera.setCam(back); }, 400);
  }
}

export const presentGo = (index: number) => showFrame(index);
export const presentNext = () => showFrame(nextIndex(state.index, state.ids.length));
export const presentPrev = () => showFrame(prevIndex(state.index));
export const presentToggleCursors = () => {
  set({ cursors: !state.cursors });
  root()?.setAttribute('data-present-cursors', state.cursors ? 'on' : 'off');
};

export const actions: Action[] = [
  {
    id: 'present.start', title: 'Present', group: 'Share', keys: { all: ['Mod+Alt+p'] }, contexts: ['canvas', 'panel'],
    run: () => (state.active ? stopPresent() : startPresent()),
  },
];
