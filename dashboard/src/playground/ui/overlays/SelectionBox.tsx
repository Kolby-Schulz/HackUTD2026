// The human's selection: one box around the union of the selected layers, a thin outline per member
// when several are selected, 4 corner handles plus 4 invisible edge strips. Screen space: positions
// come from the paint frame, handles stay 8 px at any zoom. Dragging a handle starts a resize.
import { useCallback, useRef } from 'react';
import { useStoreValue } from '../../core/react';
import { applyMat, boxMatrix, multiply, union } from '../../core/geom';
import { worldBounds, worldMatrix } from '../../core/tree';
import type { Rect, Shape, ShapeId } from '../../core/types';
import type { TreeView } from '../../core/tree';
import { resizeCursor, rotateCursor } from '../gestures/rotate';
import { useBoardEnv, usePainter } from '../board/context';
import { w2v } from '../board/state';
import '../../styles/overlays.css';

const CORNERS = ['nw', 'ne', 'sw', 'se'] as const;
const EDGES = ['n', 'e', 's', 'w'] as const;
const MAX_OUTLINES = 200;

/** A shape's world frame: centre, size and clockwise angle (parents' rotation included). */
function frameOf(st: TreeView, s: Shape) {
  const parent = s.parent !== null && st.shapes.has(s.parent) ? s.parent : null;
  const m = multiply(worldMatrix(st, parent), boxMatrix({ x: s.x, y: s.y, w: s.w, h: s.h }, s.rotation));
  const c = applyMat(m, { x: s.w / 2, y: s.h / 2 });
  return { cx: c.x, cy: c.y, w: s.w, h: s.h, rot: (Math.atan2(m[1], m[0]) * 180) / Math.PI };
}

/** Screen position/size/rotation of a world frame (rotation about the centre). */
function place(el: HTMLElement, cam: { x: number; y: number; z: number }, f: { cx: number; cy: number; w: number; h: number; rot: number }) {
  const p = w2v(cam, { x: f.cx - f.w / 2, y: f.cy - f.h / 2 });
  el.style.display = '';
  el.style.transformOrigin = '50% 50%';
  el.style.transform = `translate(${p.x}px, ${p.y}px)${f.rot ? ` rotate(${f.rot}deg)` : ''}`;
  el.style.width = `${f.w * cam.z}px`;
  el.style.height = `${f.h * cam.z}px`;
}

export function SelectionBox() {
  const env = useBoardEnv();
  const { board, ui } = env;
  const subSel = useCallback((l: () => void) => board.selection.subscribe(() => l()), [board]);
  const ids = useStoreValue(subSel, useCallback(() => board.selection.get(board.me).ids, [board]));
  const hidden = useStoreValue(ui.subscribe, useCallback(() => ui.get().editing !== null || ui.get().tool === 'comment', [ui]));
  const outlines = useRef(new Map<ShapeId, HTMLDivElement>());
  const box = useRef<HTMLDivElement>(null);
  const dims = useRef<HTMLDivElement>(null);

  const hnds = useRef(new Map<string, HTMLElement>());
  const lastRot = useRef<number | null>(null);

  usePainter((cam) => {
    const st = board.doc.getState();
    const frames: ReturnType<typeof frameOf>[] = [];
    const bounds: Rect[] = [];
    for (const id of ids) {
      const s = st.shapes.get(id);
      const live = s && !s.deleted ? s : null;
      const f = live ? frameOf(st, live) : null;
      const el = outlines.current.get(id);
      if (f) { frames.push(f); bounds.push(worldBounds(st, id)!); }
      if (!el) continue;
      if (!f) { el.style.display = 'none'; continue; }
      place(el, cam, f);
    }
    const el = box.current;
    if (!el) return;
    if (!frames.length) { el.style.display = 'none'; return; }
    // one shape: the box turns with it; several: the axis-aligned union
    let f = frames.length === 1 ? frames[0] : null;
    if (!f) { const u = union(bounds)!; f = { cx: u.x + u.w / 2, cy: u.y + u.h / 2, w: u.w, h: u.h, rot: 0 }; }
    place(el, cam, f);
    el.classList.toggle('tiny', f.w * cam.z < 16 || f.h * cam.z < 16);
    const tiny = f.w * cam.z < 16 || f.h * cam.z < 16;
    if (dims.current) {
      dims.current.textContent = `${Math.round(f.w)} × ${Math.round(f.h)}`;
      dims.current.style.display = f.rot ? 'none' : '';
    }
    // rotate-ring zones sit 12 px outside the corner handles; cursors follow the box angle
    for (const c of CORNERS) {
      const z = hnds.current.get(`rot-${c}`);
      if (!z) continue;
      const off = tiny ? 23 : 12;
      z.style.top = c.startsWith('n') ? `${-off - 9}px` : '';
      z.style.bottom = c.startsWith('s') ? `${-off - 9}px` : '';
      z.style.left = c.endsWith('w') ? `${-off - 9}px` : '';
      z.style.right = c.endsWith('e') ? `${-off - 9}px` : '';
    }
    if (lastRot.current !== f.rot) {
      lastRot.current = f.rot;
      for (const c of CORNERS) {
        const h = hnds.current.get(c); if (h) h.style.cursor = resizeCursor(c, f.rot);
        const z = hnds.current.get(`rot-${c}`); if (z) z.style.cursor = rotateCursor(c, f.rot);
      }
      for (const e of EDGES) { const h = hnds.current.get(e); if (h) h.style.cursor = resizeCursor(e, f.rot); }
    }
  });

  if (hidden || !ids.length) return null;
  return (
    <>
      {ids.length > 1 && ids.length <= MAX_OUTLINES && ids.map((id) => (
        <div key={id} className="pg-ob" ref={(el) => { if (el) outlines.current.set(id, el); else outlines.current.delete(id); }} />
      ))}
      <div className="pg-sbox" ref={box}>
        {CORNERS.map((c) => (
          <div key={`rot-${c}`} data-handle={`rot-${c}`} style={{ position: 'absolute', width: 12, height: 12, pointerEvents: 'auto', zIndex: 0 }}
            ref={(el) => { if (el) { hnds.current.set(`rot-${c}`, el); lastRot.current = null; } else hnds.current.delete(`rot-${c}`); }} />
        ))}
        {EDGES.map((e) => <div key={e} data-handle={e} className={`pg-edge h-${e}`} ref={(el) => { if (el) { hnds.current.set(e, el); lastRot.current = null; } else hnds.current.delete(e); }} />)}
        {CORNERS.map((c) => <div key={c} data-handle={c} className={`pg-hnd h-${c}`} ref={(el) => { if (el) { hnds.current.set(c, el); lastRot.current = null; } else hnds.current.delete(c); }} />)}
        <div className="pg-dims" ref={dims} />
      </div>
    </>
  );
}
