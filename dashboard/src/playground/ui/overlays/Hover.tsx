// Comment-tool hover: outline of the layer under the pointer with a "Layer → Agent" label in the
// colour of the agent the note would go to.
import { useCallback, useEffect, useRef } from 'react';
import { useStoreValue } from '../../core/react';
import { hitTest } from '../../core/hittest';
import { absRect } from '../../core/tree';
import type { ShapeId } from '../../core/types';
import { useBoardEnv, usePainter } from '../board/context';
import { w2v } from '../board/state';
import { clickTarget } from '../gestures/select';

export type DescribeTarget = (id: ShapeId) => { label: string; color: string };

function CommentHover({ describe }: { describe?: DescribeTarget }) {
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

/**
 * Select-tool hover (SELECT-7): a 1 px --pg-sel outline on the layer a click would select, with the
 * name above-left for frames. Computed in the paint frame from the last pointer position, so it
 * costs one hit-test per frame and no React render. Hidden while a button is down (move, resize,
 * marquee), while panning, over a resize handle, and for already-selected layers.
 */
function SelectHover() {
  const env = useBoardEnv();
  const { board, ui } = env;
  const box = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  const mod = useRef(false);
  const pressed = useRef(false);
  const overHandle = useRef(false);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      mod.current = e.metaKey || e.ctrlKey;
      overHandle.current = !!(e.target as HTMLElement | null)?.closest?.('[data-handle]');
    };
    const down = () => { pressed.current = true; };
    const up = () => { pressed.current = false; env.paint.wake(); };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    return () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
    };
  }, [env]);

  usePainter((cam) => {
    const el = box.current;
    if (!el) return;
    const u = ui.get();
    const hide = () => { el.style.display = 'none'; };
    if (u.tool !== 'select' || u.space || u.panning || u.editing || u.pop || pressed.current
      || overHandle.current || !env.pointer.inside) return hide();
    const view = board.doc.getState();
    const world = { x: (env.pointer.x - cam.x) / cam.z, y: (env.pointer.y - cam.y) / cam.z };
    const leaf = hitTest(view, board.index, world, { z: cam.z, deep: true });
    if (!leaf) return hide();
    const sel = board.selection.get(board.me);
    const id = mod.current ? leaf : clickTarget(view, leaf, sel.scope).id;
    const s = view.shapes.get(id);
    const r = s && !s.deleted ? absRect(view, id) : null;
    if (!s || !r || sel.ids.includes(id)) return hide();
    const p = w2v(cam, r);
    el.style.display = '';
    el.style.transform = `translate(${p.x}px, ${p.y}px)`;
    el.style.width = `${r.w * cam.z}px`;
    el.style.height = `${r.h * cam.z}px`;
    const rad = typeof s.radius === 'number' ? s.radius : s.radius?.[0] ?? 0;
    el.style.borderRadius = s.kind === 'ellipse' ? '50%' : `${rad * cam.z}px`;
    if (label.current) {
      label.current.style.display = s.kind === 'frame' ? '' : 'none';
      if (label.current.textContent !== s.name) label.current.textContent = s.name;
    }
  });

  return (
    <div
      ref={box}
      style={{ position: 'absolute', left: 0, top: 0, display: 'none', pointerEvents: 'none', boxSizing: 'border-box', border: '1px solid var(--pg-sel)' }}
    >
      <span
        ref={label}
        style={{ position: 'absolute', left: 0, top: -18, color: 'var(--pg-sel)', whiteSpace: 'nowrap', fontSize: 11, fontWeight: 500 }}
      />
    </div>
  );
}

export function Hover({ describe }: { describe?: DescribeTarget }) {
  return (
    <>
      <CommentHover describe={describe} />
      <SelectHover />
    </>
  );
}
