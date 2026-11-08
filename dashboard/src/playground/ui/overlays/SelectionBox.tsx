// The human's selection: one box around the union of the selected layers, a thin outline per member
// when several are selected, 4 corner handles plus 4 invisible edge strips. Screen space: positions
// come from the paint frame, handles stay 8 px at any zoom. Dragging a handle starts a resize.
import { useCallback, useRef } from 'react';
import { useStoreValue } from '../../core/react';
import { union } from '../../core/geom';
import { absRect } from '../../core/tree';
import type { Rect, ShapeId } from '../../core/types';
import { useBoardEnv, usePainter } from '../board/context';
import { w2v } from '../board/state';
import '../../styles/overlays.css';

const CORNERS = ['nw', 'ne', 'sw', 'se'] as const;
const EDGES = ['n', 'e', 's', 'w'] as const;
const MAX_OUTLINES = 200;

export function SelectionBox() {
  const env = useBoardEnv();
  const { board, ui } = env;
  const subSel = useCallback((l: () => void) => board.selection.subscribe(() => l()), [board]);
  const ids = useStoreValue(subSel, useCallback(() => board.selection.get(board.me).ids, [board]));
  const hidden = useStoreValue(ui.subscribe, useCallback(() => ui.get().editing !== null || ui.get().tool === 'comment', [ui]));
  const outlines = useRef(new Map<ShapeId, HTMLDivElement>());
  const box = useRef<HTMLDivElement>(null);
  const dims = useRef<HTMLDivElement>(null);

  usePainter((cam) => {
    const st = board.doc.getState();
    const rects: Rect[] = [];
    for (const id of ids) {
      const s = st.shapes.get(id);
      const r = s && !s.deleted ? absRect(st, id) : null;
      const el = outlines.current.get(id);
      if (r) rects.push(r);
      if (!el) continue;
      if (!r) { el.style.display = 'none'; continue; }
      const p = w2v(cam, r);
      el.style.display = '';
      el.style.transform = `translate(${p.x}px, ${p.y}px)`;
      el.style.width = `${r.w * cam.z}px`;
      el.style.height = `${r.h * cam.z}px`;
    }
    const el = box.current;
    const u = union(rects);
    if (!el) return;
    if (!u) { el.style.display = 'none'; return; }
    const p = w2v(cam, u);
    el.style.display = '';
    el.style.transform = `translate(${p.x}px, ${p.y}px)`;
    el.style.width = `${u.w * cam.z}px`;
    el.style.height = `${u.h * cam.z}px`;
    el.classList.toggle('tiny', u.w * cam.z < 16 || u.h * cam.z < 16);
    if (dims.current) dims.current.textContent = `${Math.round(u.w)} × ${Math.round(u.h)}`;
  });

  if (hidden || !ids.length) return null;
  return (
    <>
      {ids.length > 1 && ids.length <= MAX_OUTLINES && ids.map((id) => (
        <div key={id} className="pg-ob" ref={(el) => { if (el) outlines.current.set(id, el); else outlines.current.delete(id); }} />
      ))}
      <div className="pg-sbox" ref={box}>
        {EDGES.map((e) => <div key={e} data-handle={e} className={`pg-edge h-${e}`} />)}
        {CORNERS.map((c) => <div key={c} data-handle={c} className={`pg-hnd h-${c}`} />)}
        <div className="pg-dims" ref={dims} />
      </div>
    </>
  );
}
