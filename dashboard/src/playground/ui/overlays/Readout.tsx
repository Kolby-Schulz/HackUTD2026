// Live readout pill (SELECT-30): a blue pill 8 screen px under the selection while a gesture runs.
// Resize / draw: `W × H`. Move: `X: 120  Y: 80` of the primary layer in its parent's space (only the axis that
// changed when Shift locks one). Rotate: `34°`. Marquee / plain click: nothing.
// No gesture seam is needed: the gesture is classified by comparing the selection with a snapshot taken on the
// first paint frame after pointer-down, so the numbers are exactly what the document holds (snapped values).
// Screen space and painter-driven: the pill is one element updated per frame, never a React re-render.
import { useEffect, useRef } from 'react';
import { union } from '../../core/geom';
import { absRect } from '../../core/tree';
import type { Rect, ShapeId } from '../../core/types';
import { useBoardEnv, usePainter } from '../board/context';
import { w2v } from '../board/state';

const GAP = 8;       // screen px between the selection box and the pill
const EPS = 1e-6;
const CREATE_TOOLS = new Set(['frame', 'rect', 'ellipse', 'text']);

export type ReadoutMode = 'size' | 'move' | 'rotate' | null;
export interface ReadoutSnap { box: Rect; x: number; y: number; rot: number; ids: string; draw: boolean }
export interface ReadoutNow { box: Rect; x: number; y: number; rot: number; ids: string }

/** Number text: integers, one decimal past 400% zoom. */
export function fmt(n: number, z: number): string {
  if (z > 4) return String(Math.round(n * 10) / 10 + 0);
  return String(Math.round(n) + 0);   // + 0 turns -0 into 0
}

/** What the pill shows for this frame, or null for no pill. */
export function readoutText(start: ReadoutSnap, now: ReadoutNow, z: number): string | null {
  if (start.draw) return `${fmt(now.box.w, z)} × ${fmt(now.box.h, z)}`;
  if (now.ids !== start.ids) return null;                                       // marquee or click: selection only
  const dw = Math.abs(now.box.w - start.box.w) > EPS || Math.abs(now.box.h - start.box.h) > EPS;
  if (dw) return `${fmt(now.box.w, z)} × ${fmt(now.box.h, z)}`;
  if (Math.abs(now.rot - start.rot) > EPS) return `${fmt(((now.rot % 360) + 360) % 360, z)}°`;
  const dx = Math.abs(now.x - start.x) > EPS, dy = Math.abs(now.y - start.y) > EPS;
  if (!dx && !dy) return null;
  const parts: string[] = [];
  if (dx) parts.push(`X: ${fmt(now.x, z)}`);
  if (dy) parts.push(`Y: ${fmt(now.y, z)}`);
  return parts.join('  ');
}

/** Pill centre-x and top in view px: below the box, flipped above when it would leave the view, clamped sideways. */
export function placePill(box: { x: number; y: number; w: number; h: number }, pw: number, ph: number, vw: number, vh: number) {
  let top = box.y + box.h + GAP;
  if (top + ph > vh) top = box.y - GAP - ph;
  if (top < 0) top = Math.max(0, Math.min(vh - ph, top < 0 ? box.y + box.h + GAP : top));
  const half = pw / 2;
  const cx = Math.max(half + 2, Math.min(vw - half - 2, box.x + box.w / 2));
  return { cx, top };
}

export function Readout() {
  const env = useBoardEnv();
  const { board } = env;
  const pill = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const down = useRef<{ tool: string } | null>(null);
  const start = useRef<ReadoutSnap | null>(null);

  useEffect(() => {
    const view = root.current?.parentElement?.parentElement ?? null;   // overlays -> .pg-view
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || !view || !(e.target instanceof Node) || !view.contains(e.target)) return;
      down.current = { tool: env.ui.get().tool };
      start.current = null;                       // snapshot on the first frame, after the press changed the selection
      env.paint.wake();
    };
    const onUp = () => { down.current = null; start.current = null; env.paint.wake(); };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
    };
  }, [env]);

  usePainter((cam) => {
    const el = pill.current;
    if (!el) return;
    // the selection box's own idle W × H pill hides while a gesture pill is up (SELECT-30)
    const idle = root.current?.parentElement?.querySelector<HTMLElement>('.pg-sbox .pg-dims') ?? null;
    const hide = () => { el.style.display = 'none'; if (idle) idle.style.visibility = ''; };
    if (!down.current) return hide();
    const st = board.doc.getState();
    const ids: ShapeId[] = board.selection.get(board.me).ids.filter((id) => { const s = st.shapes.get(id); return s && !s.deleted; });
    const rects: Rect[] = [];
    for (const id of ids) { const r = absRect(st, id); if (r) rects.push(r); }
    const u = union(rects);
    if (!u) return hide();
    const primary = st.shapes.get(ids[0])!;
    const now: ReadoutNow = { box: u, x: primary.x, y: primary.y, rot: primary.rotation ?? 0, ids: ids.join(',') };
    if (!start.current) {
      start.current = { box: u, x: now.x, y: now.y, rot: now.rot, ids: now.ids, draw: CREATE_TOOLS.has(down.current.tool) };
    }
    const text = readoutText(start.current, now, cam.z);
    if (text === null) return hide();
    if (idle) idle.style.visibility = 'hidden';
    el.textContent = text;
    el.style.display = '';
    const view = root.current?.parentElement;
    const vw = view?.clientWidth || 4000, vh = view?.clientHeight || 4000;
    const p = w2v(cam, u);
    const { cx, top } = placePill({ x: p.x, y: p.y, w: u.w * cam.z, h: u.h * cam.z }, el.offsetWidth, el.offsetHeight, vw, vh);
    el.style.transform = `translate(${cx}px, ${top}px) translateX(-50%)`;
  });

  return (
    <div ref={root} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      <div
        ref={pill}
        className="pg-readout"
        style={{
          display: 'none', position: 'absolute', left: 0, top: 0, background: 'var(--pg-sel)', color: 'var(--pg-white)',
          fontSize: 10, padding: '1px 5px', borderRadius: 3, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
          pointerEvents: 'none', zIndex: 5,
        }}
      />
    </div>
  );
}
