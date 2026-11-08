// Alt/Option-hover measurement (ALIGN-16, SELECT-50): red distance lines between the selection and the hovered layer.
// Painted in screen space from the last pointer position; never mutates the document.
import { useEffect, useRef } from 'react';
import { hitTest } from '../../core/hittest';
import { union } from '../../core/geom';
import { measureBetween } from '../../core/snap/spacing';
import { absRect } from '../../core/tree';
import type { Rect } from '../../core/types';
import { useBoardEnv, usePainter } from '../board/context';
import { w2v } from '../board/state';

const RED = 'var(--pg-guide)';
const TICK = 4;

export function Measure() {
  const env = useBoardEnv();
  const { board } = env;
  const g = useRef<SVGGElement>(null);
  const alt = useRef(false);
  const pressed = useRef(false);

  useEffect(() => {
    const set = (v: boolean) => { if (alt.current !== v) { alt.current = v; env.paint.wake(); } };
    const key = (e: KeyboardEvent) => { if (e.key === 'Alt') set(e.type === 'keydown'); };
    const move = (e: PointerEvent) => { set(e.altKey); env.paint.wake(); };
    const down = () => { pressed.current = true; env.paint.wake(); }; // Alt+drag is duplicate: no measuring
    const up = () => { pressed.current = false; env.paint.wake(); };
    const blur = () => set(false);
    window.addEventListener('keydown', key, true);
    window.addEventListener('keyup', key, true);
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('keyup', key, true);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      window.removeEventListener('blur', blur);
    };
  }, [env]);

  usePainter((cam) => {
    const el = g.current;
    if (!el) return;
    const clear = () => { if (el.firstChild) el.innerHTML = ''; };
    const u = env.ui.get();
    if (!alt.current || pressed.current || !env.pointer.inside || u.editing || u.panning) return clear();
    const view = board.doc.getState();
    const sel = board.selection.get(board.me).ids;
    const rects = sel.map((id) => { const s = view.shapes.get(id); return s && !s.deleted ? absRect(view, id) : null; })
      .filter((r): r is Rect => !!r);
    const a = union(rects);
    if (!a) return clear();
    const world = { x: (env.pointer.x - cam.x) / cam.z, y: (env.pointer.y - cam.y) / cam.z };
    const hit = hitTest(view, board.index, world, { z: cam.z, deep: true });
    if (!hit || sel.includes(hit)) return clear();
    const b = absRect(view, hit);
    if (!b) return clear();

    const vb = w2v(cam, b);
    let s = `<rect x="${vb.x + 0.5}" y="${vb.y + 0.5}" width="${b.w * cam.z}" height="${b.h * cam.z}" fill="none" stroke="currentColor"/>`;
    for (const m of measureBetween(a, b)) {
      const x1 = Math.round(m.x1 * cam.z + cam.x) + 0.5, y1 = Math.round(m.y1 * cam.z + cam.y) + 0.5;
      const x2 = Math.round(m.x2 * cam.z + cam.x) + 0.5, y2 = Math.round(m.y2 * cam.z + cam.y) + 0.5;
      const h = y1 === y2;
      s += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="currentColor"/>`;
      s += h
        ? `<path d="M${x1} ${y1 - TICK}V${y1 + TICK}M${x2} ${y2 - TICK}V${y2 + TICK}" stroke="currentColor"/>`
        : `<path d="M${x1 - TICK} ${y1}H${x1 + TICK}M${x2 - TICK} ${y2}H${x2 + TICK}" stroke="currentColor"/>`;
      if (Math.abs(h ? x2 - x1 : y2 - y1) >= 6) { // ALIGN-15: label hides when cramped
        const t = String(Math.round(m.size)), cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, w = t.length * 6 + 10;
        s += `<rect x="${cx - w / 2}" y="${cy - 7}" width="${w}" height="14" rx="3" fill="currentColor"/>`
          + `<text x="${cx}" y="${cy}" fill="var(--pg-white)" font-size="10" font-weight="600" text-anchor="middle" dominant-baseline="central" style="font-variant-numeric:tabular-nums;font-family:system-ui,sans-serif">${t}</text>`;
      }
    }
    el.innerHTML = s;
  });

  return (
    <svg aria-hidden="true" style={{ position: 'absolute', left: 0, top: 0, width: 1, height: 1, overflow: 'visible', pointerEvents: 'none', color: RED }}>
      <g ref={g} />
    </svg>
  );
}
