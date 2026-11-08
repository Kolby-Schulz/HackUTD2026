// Marquee (rubber-band) selection (SELECT-8, CANVAS-6). A drag that starts on empty canvas draws a
// rectangle; shapes it touches are selected live. Frames count only when fully enclosed or when the
// rectangle touches their edge or title. A marquee started inside a frame picks that frame's direct
// children; at the root it picks top-level layers. Shift adds to the selection held at the start,
// Mod picks every touched leaf. Dragging past the view edge pans the camera. Escape restores.
// Panning stays on Space / middle button / Hand tool (pan.ts); this file only replaces the
// empty-canvas fallback.
import { hitRect } from '../../core/hittest';
import { rectFromPoints } from '../../core/geom';
import { frameAt, worldBounds } from '../../core/tree';
import type { TreeView } from '../../core/tree';
import type { Pt, Rect, ShapeId } from '../../core/types';
import { selectIds, selectedIds, w2v } from '../board/state';
import type { BoardEnv } from '../board/state';
import type { Mode, PointerInfo } from './pipeline';

/** Frame titles sit this many screen px above the frame. */
const TITLE_PX = 20;
/** Auto-pan speed at full overshoot (screen px per frame) and the overshoot that reaches it. */
const EDGE_SPEED = 20;
const EDGE_PX = 20;

// ---- the live rectangle, read by overlays/Marquee.tsx ----
export interface MarqueeStore {
  get(): Rect | null;
  set(r: Rect | null): void;
  subscribe(l: () => void): () => void;
}
const stores = new WeakMap<BoardEnv, MarqueeStore>();
export function marqueeOf(env: BoardEnv): MarqueeStore {
  let s = stores.get(env);
  if (!s) {
    let cur: Rect | null = null;
    const subs = new Set<() => void>();
    s = {
      get: () => cur,
      set(r) { cur = r; [...subs].forEach((l) => l()); env.paint.wake(); },
      subscribe(l) { subs.add(l); return () => { subs.delete(l); }; },
    };
    stores.set(env, s);
  }
  return s;
}

const inside = (r: Rect, b: Rect) => r.x > b.x && r.y > b.y && r.x + r.w < b.x + b.w && r.y + r.h < b.y + b.h;
const encloses = (r: Rect, b: Rect) => r.x <= b.x && r.y <= b.y && r.x + r.w >= b.x + b.w && r.y + r.h >= b.y + b.h;
const touches = (a: Rect, b: Rect) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;

/**
 * Which layers a marquee `rect` selects. Pure: `scope` is the container whose direct children are
 * eligible (null = root); `deep` ignores scope and containers and returns every touched leaf.
 */
export function marqueeHits(
  view: TreeView, index: Parameters<typeof hitRect>[1], rect: Rect,
  opts: { scope: ShapeId | null; deep: boolean; z: number },
): ShapeId[] {
  const hits = hitRect(view, index, rect, { z: opts.z, deep: opts.deep });
  if (opts.deep) return hits;
  const title = TITLE_PX / (opts.z > 0 ? opts.z : 1);
  return hits.filter((id) => {
    const s = view.shapes.get(id);
    if (!s || (s.parent ?? null) !== opts.scope) return false;
    if (s.kind !== 'frame') return true;
    const b = worldBounds(view, id);
    if (!b) return false;
    if (encloses(rect, b)) return true;
    // edge or title: the rectangle is not wholly inside the frame, or it reaches the title strip
    return !inside(rect, b) || touches(rect, { x: b.x, y: b.y - title, w: b.w, h: title });
  });
}

export function startMarquee(env: BoardEnv, p: PointerInfo): Mode | null {
  const { board, camera } = env;
  const store = marqueeOf(env);
  const view0 = board.doc.getState();
  const startSel = [...selectedIds(board)];
  const startScope = board.selection.get(board.me).scope;
  // scope: the frame the press landed in (a transparent frame passes presses through)
  const scope = frameAt(view0, p.world);
  const origin: Pt = p.world;
  let last = p;
  let applied = '';
  let raf = 0;
  let live = true;

  const apply = (q: PointerInfo) => {
    last = q;
    const rect = rectFromPoints(origin, q.world);
    store.set(rect);
    const hits = marqueeHits(board.doc.getState(), board.index, rect, { scope, deep: q.mod, z: camera.getCam().z });
    const ids = q.shift ? [...new Set([...startSel, ...hits])] : hits;
    const key = ids.join(',');
    if (key === applied) return;
    applied = key;
    selectIds(board, ids);
    if (ids.length) board.selection.set(board.me, ids, q.mod ? undefined : scope);
  };

  // dragging past the view edge pans toward the pointer while the pointer is held there
  const tick = () => {
    raf = 0;
    if (!live) return;
    const cam = camera.getCam();
    const size = camera.getViewSize();
    const l = w2v(cam, last.world);
    const over = (v: number, max: number) => v < 0 ? Math.max(v, -EDGE_PX) : v > max ? Math.min(v - max, EDGE_PX) : 0;
    const dx = over(l.x, size.w), dy = over(l.y, size.h);
    if (dx === 0 && dy === 0) return;
    const sx = (dx / EDGE_PX) * EDGE_SPEED, sy = (dy / EDGE_PX) * EDGE_SPEED;
    camera.setCam({ z: cam.z, x: cam.x - sx, y: cam.y - sy });
    apply({ ...last, world: { x: last.world.x + sx / cam.z, y: last.world.y + sy / cam.z } });
    schedule();
  };
  const schedule = () => {
    if (!raf && live && typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(tick);
  };
  const stop = () => {
    live = false;
    if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
    raf = 0;
    store.set(null);
  };

  return {
    move(q) { apply(q); schedule(); },
    up() { stop(); },
    cancel() {
      stop();
      selectIds(board, startSel);
      board.selection.set(board.me, startSel, startScope);
    },
  };
}
