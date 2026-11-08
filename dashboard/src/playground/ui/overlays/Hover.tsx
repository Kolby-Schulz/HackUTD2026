// Comment-tool hover: outline of the layer under the pointer with a "Layer → Agent" label in the
// colour of the agent the note would go to.
import { useCallback, useRef } from 'react';
import { useStoreValue } from '../../core/react';
import { absRect } from '../../core/tree';
import type { ShapeId } from '../../core/types';
import { useBoardEnv, usePainter } from '../board/context';
import { w2v } from '../board/state';

export type DescribeTarget = (id: ShapeId) => { label: string; color: string };

export function Hover({ describe }: { describe?: DescribeTarget }) {
  const env = useBoardEnv();
  const { board, ui } = env;
  const id = useStoreValue(ui.subscribe, useCallback(() => {
    const s = ui.get();
    return s.tool === 'comment' && !s.pop ? s.hover : null;
  }, [ui]));
  const ref = useRef<HTMLDivElement>(null);

  usePainter((cam) => {
    const el = ref.current;
    if (!el || !id) return;
    const st = board.doc.getState();
    const s = st.shapes.get(id);
    const r = s && !s.deleted ? absRect(st, id) : null;
    if (!s || !r) { el.style.display = 'none'; return; }
    const p = w2v(cam, r);
    el.style.display = '';
    el.style.transform = `translate(${p.x}px, ${p.y}px)`;
    el.style.width = `${r.w * cam.z}px`;
    el.style.height = `${r.h * cam.z}px`;
    const rad = typeof s.radius === 'number' ? s.radius : s.radius?.[0] ?? 0;
    el.style.borderRadius = s.kind === 'ellipse' ? '50%' : `${rad * cam.z}px`;
  });

  if (!id) return null;
  const s = board.doc.getState().shapes.get(id);
  if (!s) return null;
  const d = describe?.(id) ?? { label: s.name, color: '#d97757' };
  return (
    <div ref={ref} className="pg-target" style={{ ['--c' as string]: d.color }}>
      <span>{d.label}</span>
    </div>
  );
}
