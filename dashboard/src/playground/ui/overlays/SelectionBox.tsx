// The human's selection: outline per selected layer, corner handles and a size readout when one
// layer is selected. Screen space: positions come from the paint frame, handles stay 8 px at any zoom.
import { useCallback, useRef } from 'react';
import { useStoreValue } from '../../core/react';
import { absRect } from '../../core/tree';
import type { ShapeId } from '../../core/types';
import { useBoardEnv, usePainter } from '../board/context';
import { w2v } from '../board/state';

const CORNERS = ['nw', 'ne', 'sw', 'se'] as const;

export function SelectionBox() {
  const env = useBoardEnv();
  const { board, ui } = env;
  const subSel = useCallback((l: () => void) => board.selection.subscribe(() => l()), [board]);
  const ids = useStoreValue(subSel, useCallback(() => board.selection.get(board.me).ids, [board]));
  const hidden = useStoreValue(ui.subscribe, useCallback(() => ui.get().editing !== null || ui.get().tool === 'comment', [ui]));
  const els = useRef(new Map<ShapeId, HTMLDivElement>());
  const dims = useRef<HTMLDivElement>(null);

  usePainter((cam) => {
    const st = board.doc.getState();
    for (const [id, el] of els.current) {
      const s = st.shapes.get(id);
      const r = s && !s.deleted ? absRect(st, id) : null;
      if (!r) { el.style.display = 'none'; continue; }
      const p = w2v(cam, r);
      el.style.display = '';
      el.style.transform = `translate(${p.x}px, ${p.y}px)`;
      el.style.width = `${r.w * cam.z}px`;
      el.style.height = `${r.h * cam.z}px`;
      if (dims.current && ids.length === 1) dims.current.textContent = `${Math.round(r.w)} × ${Math.round(r.h)}`;
    }
  });

  if (hidden || !ids.length) return null;
  return (
    <>
      {ids.map((id) => (
        <div key={id} className="pg-sel" ref={(el) => { if (el) els.current.set(id, el); else els.current.delete(id); }}>
          {ids.length === 1 && CORNERS.map((c) => <div key={c} data-handle={c} className={`pg-handle h-${c}`} />)}
          {ids.length === 1 && <div className="pg-dims" ref={dims} />}
        </div>
      ))}
    </>
  );
}
