// Overlay: off-screen cursor chips (CANVAS-29, MULTI-17). An actor whose cursor is outside the view gets a small
// coloured chip clamped to the nearest edge, an arrow pointing toward it and its initial. Crowded chips on one edge
// merge into "+N" groups (max 8 per edge). Click = go to the actor (or fit a whole group).
// A fixed pool of buttons is repositioned imperatively in the paint frame; React renders once, never per frame.
import { useMemo, useRef } from 'react';
import { goTo } from '../../core/goto';
import type { Rect } from '../../core/types';
import { badgeOf } from '../../presence/colors';
import { useBoardEnv, usePainter } from '../board/context';
import { w2v } from '../board/state';

export type Edge = 'top' | 'right' | 'bottom' | 'left';
const EDGES: Edge[] = ['top', 'right', 'bottom', 'left'];
export const CHIP = 26;            // chip diameter, px
export const INSET = 12;           // gap between chip and the view edge
export const MAX_PER_EDGE = 8;
export const CORNER_KEEPOUT = 150; // bottom/right corner holds the minimap and zoom controls

export interface ChipItem { id: string; x: number; y: number }   // x, y = screen (view-local) position
export interface Chip { edge: Edge; pos: number; x: number; y: number; angle: number; ids: string[] }

/** Chips for every item outside the view, grouped per edge (pure). */
export function planChips(items: ChipItem[], view: { w: number; h: number }, o: { max?: number; gap?: number } = {}): Chip[] {
  const max = o.max ?? MAX_PER_EDGE;
  const gap = o.gap ?? CHIP + 2;
  const r = CHIP / 2 + INSET;
  const cx = view.w / 2, cy = view.h / 2;
  const by = new Map<Edge, { id: string; t: number; angle: number }[]>();
  for (const it of items) {
    if (it.x >= 0 && it.x <= view.w && it.y >= 0 && it.y <= view.h) continue;
    const over: [Edge, number][] = [['left', -it.x], ['right', it.x - view.w], ['top', -it.y], ['bottom', it.y - view.h]];
    const edge = over.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
    const horiz = edge === 'top' || edge === 'bottom';
    const len = horiz ? view.w : view.h;
    const keep = (edge === 'bottom' || edge === 'right') && len > CORNER_KEEPOUT * 2 ? CORNER_KEEPOUT : 0;
    const lo = r, hi = Math.max(lo, len - r - keep);
    const t = Math.min(hi, Math.max(lo, horiz ? it.x : it.y));
    (by.get(edge) ?? by.set(edge, []).get(edge)!).push({ id: it.id, t, angle: Math.atan2(it.y - cy, it.x - cx) });
  }
  const out: Chip[] = [];
  for (const [edge, list] of by) {
    list.sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1));
    let groups = list.reduce<typeof list[]>((g, it) => {
      const last = g[g.length - 1];
      if (last && it.t - last[last.length - 1].t < gap) last.push(it); else g.push([it]);
      return g;
    }, []);
    const mean = (g: typeof list) => g.reduce((s, m) => s + m.t, 0) / g.length;
    while (groups.length > max) {   // merge the closest neighbours until the edge fits
      let best = 0, bestGap = Infinity;
      for (let i = 0; i < groups.length - 1; i++) {
        const d = mean(groups[i + 1]) - mean(groups[i]);
        if (d < bestGap) { bestGap = d; best = i; }
      }
      groups.splice(best, 2, [...groups[best], ...groups[best + 1]]);
    }
    for (const g of groups) {
      const pos = mean(g);
      const horiz = edge === 'top' || edge === 'bottom';
      const fixed = edge === 'top' || edge === 'left' ? r : (horiz ? view.h : view.w) - r;
      const angle = g.length === 1 ? g[0].angle : Math.atan2(g.reduce((s, m) => s + Math.sin(m.angle), 0), g.reduce((s, m) => s + Math.cos(m.angle), 0));
      out.push({ edge, pos, x: horiz ? pos : fixed, y: horiz ? fixed : pos, angle, ids: g.map((m) => m.id) });
    }
  }
  return out;
}

const SLOTS = EDGES.flatMap((e) => Array.from({ length: MAX_PER_EDGE }, (_, i) => `${e}${i}`));
const FALLBACK = 'var(--pg-ink-soft)';

export function OffscreenChips() {
  const env = useBoardEnv();
  const { board } = env;
  const els = useRef<(HTMLButtonElement | null)[]>([]);
  const ids = useRef<string[][]>([]);          // actor ids each pool slot currently stands for
  const keys = useRef<string[]>([]);           // content key per slot, so DOM text changes only when needed
  const slots = useMemo(() => SLOTS, []);

  usePainter((cam) => {
    const view = env.camera.getViewSize();
    const items: ChipItem[] = [];
    if (view.w > 0 && view.h > 0) {
      for (const a of board.actors.list()) {
        if (a.id === board.me) continue;
        const p = board.presence.get(a.id);
        if (!p || p.x === undefined || p.y === undefined || p.state === 'stopped') continue;
        const s = w2v(cam, { x: p.x, y: p.y });
        items.push({ id: a.id, x: s.x, y: s.y });
      }
    }
    const chips = planChips(items, view);
    const used = new Map<Edge, number>();
    const taken = new Set<number>();
    for (const c of chips) {
      const n = used.get(c.edge) ?? 0;
      used.set(c.edge, n + 1);
      const idx = EDGES.indexOf(c.edge) * MAX_PER_EDGE + n;
      const el = els.current[idx];
      if (!el) continue;
      taken.add(idx);
      ids.current[idx] = c.ids;
      const actors = c.ids.map((id) => board.actors.get(id)).filter((x) => !!x);
      const solo = c.ids.length === 1 ? actors[0] : undefined;
      const status = solo ? board.presence.get(solo.id)?.detail ?? board.presence.get(solo.id)?.state : undefined;
      const key = `${c.ids.join(',')}|${solo?.color}|${solo?.name}|${status}`;
      if (keys.current[idx] !== key) {
        keys.current[idx] = key;
        const label = el.querySelector<HTMLElement>('[data-label]')!;
        label.textContent = solo ? badgeOf(solo.name) : `+${c.ids.length}`;
        el.style.background = solo?.color ?? FALLBACK;
        const arrow = el.querySelector<HTMLElement>('[data-arrow]')!;
        arrow.style.borderLeftColor = solo?.color ?? FALLBACK;
        el.title = solo ? `${solo.name}${status ? ` · ${status}` : ''} (click to go)` : `${actors.map((x) => x!.name).join(', ')} (click to fit)`;
        el.setAttribute('aria-label', el.title);
      }
      el.style.display = '';
      el.style.transform = `translate(${c.x - CHIP / 2}px, ${c.y - CHIP / 2}px)`;
      (el.querySelector('[data-arrow-wrap]') as HTMLElement).style.transform = `rotate(${c.angle}rad)`;
    }
    els.current.forEach((el, i) => { if (el && !taken.has(i)) { el.style.display = 'none'; ids.current[i] = []; keys.current[i] = ''; } });
  });

  const jump = (idx: number) => {
    const list = ids.current[idx] ?? [];
    const pts = list.map((id) => board.presence.get(id)).filter((p) => p && p.x !== undefined && p.y !== undefined) as { x: number; y: number }[];
    if (!pts.length) return;
    if (pts.length === 1) { goTo({ x: pts[0].x, y: pts[0].y }); return; }
    const x0 = Math.min(...pts.map((p) => p.x)), x1 = Math.max(...pts.map((p) => p.x));
    const y0 = Math.min(...pts.map((p) => p.y)), y1 = Math.max(...pts.map((p) => p.y));
    const r: Rect = { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
    goTo(r);
  };

  return (
    <div aria-label="Off-screen cursors">
      {slots.map((s, i) => (
        <button
          key={s}
          ref={(el) => { els.current[i] = el; }}
          type="button"
          onClick={() => jump(i)}
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', left: 0, top: 0, width: CHIP, height: CHIP, display: 'none', padding: 0,
            borderRadius: '50%', border: '2px solid var(--pg-white)', boxShadow: 'var(--pg-shadow-pin)', cursor: 'pointer',
            pointerEvents: 'auto', color: 'var(--pg-white)', font: '600 11px/1 system-ui, sans-serif', willChange: 'transform',
          }}
        >
          <span data-arrow-wrap style={{ position: 'absolute', inset: -2, pointerEvents: 'none' }}>
            <span data-arrow style={{ position: 'absolute', right: -9, top: '50%', marginTop: -5, width: 0, height: 0, borderTop: '5px solid transparent', borderBottom: '5px solid transparent', borderLeft: '7px solid currentColor' }} />
          </span>
          <span data-label style={{ position: 'relative' }} />
        </button>
      ))}
    </div>
  );
}
