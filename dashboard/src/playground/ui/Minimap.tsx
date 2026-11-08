// Minimap (CANVAS-24, MULTI-11): a 180x120 canvas of the top-level shapes, other actors' viewports and cursor dots, plus the
// draggable local viewport. Drawn from a scheduler frame (never a React render per frame): camera and presence wake it, the
// shape list is rebuilt at most every 100 ms after a document change. Shift+M (action view.minimap) toggles prefs.flags.minimap, default on.
import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { SlotProps } from './slotProps';
import type { Pt, Rect, Shape } from '../core/types';
import { worldBounds } from '../core/tree';
import { goTo } from '../core/goto';
import { scheduler } from '../core/raf';
import { prefs } from '../core/prefs';
import { useBoardEnv } from './board/context';
import '../styles/minimap.css';

export const MAP_W = 180;
export const MAP_H = 120;
const PAD = 8;
const DOC_THROTTLE_MS = 100;
const MAX_VIEWPORT_RECTS = 12;
const DOT_HIT_PX = 6;

export interface MapXform { scale: number; ox: number; oy: number }
export interface Box { r: Rect; color: string | null }

export const unionRect = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};
export const containsRect = (outer: Rect, inner: Rect): boolean =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

/** Scale and offset that fit `bounds` into the map with a pad around it. */
export function fitBounds(bounds: Rect, w = MAP_W, h = MAP_H, pad = PAD): MapXform {
  const scale = Math.min((w - 2 * pad) / Math.max(bounds.w, 1), (h - 2 * pad) / Math.max(bounds.h, 1));
  return { scale, ox: (w - bounds.w * scale) / 2 - bounds.x * scale, oy: (h - bounds.h * scale) / 2 - bounds.y * scale };
}
export const toMap = (t: MapXform, p: Pt): Pt => ({ x: p.x * t.scale + t.ox, y: p.y * t.scale + t.oy });
export const fromMap = (t: MapXform, p: Pt): Pt => ({ x: (p.x - t.ox) / t.scale, y: (p.y - t.oy) / t.scale });
/** Hidden when there is nothing to navigate: no content, or all of it already inside the viewport. */
export const shouldHide = (content: Rect | null, viewport: Rect): boolean => !content || containsRect(viewport, content);
export const clampPt = (p: Pt, w = MAP_W, h = MAP_H, m = 3): { p: Pt; off: boolean } => {
  const x = Math.min(w - m, Math.max(m, p.x)), y = Math.min(h - m, Math.max(m, p.y));
  return { p: { x, y }, off: x !== p.x || y !== p.y };
};
/** Camera that puts world point `c` at the centre of a view of the given size. */
export const camCentered = (c: Pt, z: number, view: { w: number; h: number }) => ({ z, x: view.w / 2 - c.x * z, y: view.h / 2 - c.y * z });

const firstColor = (s: Shape): string | null => {
  const f = s.fills?.find((p) => !p.hidden);
  return f ? f.color : null;
};

const useFlag = () => useSyncExternalStore(prefs.subscribe, () => prefs.get().flags.minimap !== false, () => true);

export function Minimap({ board, cursors }: SlotProps) {
  const env = useBoardEnv();
  const on = useFlag();
  const wrap = useRef<HTMLDivElement>(null);
  const cvs = useRef<HTMLCanvasElement>(null);
  const cursorsRef = useRef(cursors);
  cursorsRef.current = cursors;

  useEffect(() => {
    const canvas = cvs.current, box = wrap.current;
    if (!on || !canvas || !box) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = MAP_W * dpr; canvas.height = MAP_H * dpr;
    const cam = env.camera;
    const narrow = window.matchMedia?.('(max-width: 899px)');

    let boxes: Box[] = [];
    let content: Rect | null = null;
    let docDirty = true, docTimer = 0, dragging = false;
    let xf: MapXform = { scale: 1, ox: 0, oy: 0 };
    let dragOff: Pt = { x: 0, y: 0 };
    const colors = { bg: '', sel: '', muted: '', ink: '' };

    const rebuild = () => {
      const st = board.doc.getState();
      const out: Box[] = [];
      let u: Rect | null = null;
      for (const id of st.children.get(null) ?? []) {
        const s = st.shapes.get(id);
        if (!s || s.deleted) continue;
        const r = worldBounds(st, id);
        if (!r) continue;
        out.push({ r, color: firstColor(s) });
        u = u ? unionRect(u, r) : r;
      }
      boxes = out; content = u; docDirty = false;
    };

    const readColors = () => {
      const cs = getComputedStyle(box);
      colors.bg = cs.getPropertyValue('--pg-panel').trim() || '#fff';
      colors.sel = cs.getPropertyValue('--pg-sel').trim() || '#0d99ff';
      colors.muted = cs.getPropertyValue('--pg-muted').trim() || '#888';
      colors.ink = cs.getPropertyValue('--pg-ink-soft').trim() || '#555';
    };

    const sub = scheduler.register(() => {
      if (narrow?.matches) return;
      if (docDirty) rebuild();
      const vp = cam.visibleRect();
      if (vp.w <= 0 || vp.h <= 0) return;
      const hide = shouldHide(content, vp) && !dragging;
      box.hidden = hide;
      if (hide) return;
      if (!colors.sel) readColors();
      xf = fitBounds(content ? unionRect(content, vp) : vp);
      const { scale } = xf;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, MAP_W, MAP_H);

      // top-level shapes (flat rects, no text)
      ctx.globalAlpha = 0.55;
      let last = '';
      for (const b of boxes) {
        const fill = b.color ?? colors.muted;
        if (fill !== last) { ctx.fillStyle = fill; last = fill; }
        ctx.fillRect(b.r.x * scale + xf.ox, b.r.y * scale + xf.oy, Math.max(1, b.r.w * scale), Math.max(1, b.r.h * scale));
      }
      ctx.globalAlpha = 1;

      // other actors: viewport rectangles (dashed for agents) and dots
      const list = cursorsRef.current.filter((c) => c.id !== board.me);
      const rects = list.length <= MAX_VIEWPORT_RECTS;
      ctx.lineWidth = 1;
      for (const c of list) {
        const p = board.presence.get(c.id);
        if (!p) continue;
        if (rects && p.viewport) {
          const a = toMap(xf, p.viewport);
          ctx.strokeStyle = c.color;
          ctx.setLineDash(c.kind === 'agent' ? [3, 2] : []);
          ctx.strokeRect(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5, Math.max(2, p.viewport.w * scale), Math.max(2, p.viewport.h * scale));
          ctx.setLineDash([]);
        }
        if (p.x === undefined || p.y === undefined) continue;
        const { p: d, off } = clampPt(toMap(xf, { x: p.x, y: p.y }));
        ctx.beginPath(); ctx.arc(d.x, d.y, 3, 0, Math.PI * 2);
        if (off) { ctx.strokeStyle = c.color; ctx.lineWidth = 1.5; ctx.stroke(); ctx.lineWidth = 1; }
        else { ctx.fillStyle = c.color; ctx.fill(); ctx.strokeStyle = colors.bg; ctx.stroke(); }
      }

      // local viewport: filled brand rect
      const v = toMap(xf, vp);
      ctx.fillStyle = colors.sel; ctx.globalAlpha = 0.12;
      ctx.fillRect(v.x, v.y, vp.w * scale, vp.h * scale);
      ctx.globalAlpha = 1; ctx.strokeStyle = colors.sel; ctx.lineWidth = 1.5;
      ctx.strokeRect(v.x, v.y, vp.w * scale, vp.h * scale);
      ctx.lineWidth = 1;
    });

    const wake = () => sub.wake();
    const offCam = cam.subscribe(wake);
    const offPresence = board.presence.subscribe(wake);
    const offDoc = board.doc.onChange(() => {
      docDirty = true;
      if (docTimer) return;
      docTimer = window.setTimeout(() => { docTimer = 0; wake(); }, DOC_THROTTLE_MS);
    });
    const onMq = () => { readColors(); wake(); };
    narrow?.addEventListener?.('change', onMq);
    const offTheme = prefs.subscribe(() => { colors.sel = ''; wake(); });   // theme pref changed: re-read tokens
    wake();

    // ---- pointer: drag the viewport, click elsewhere to centre, click an actor to go there ----
    const local = (e: PointerEvent): Pt => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const centerOn = (mp: Pt, off: Pt) => {
      const w = fromMap(xf, mp);
      const z = cam.getCam().z;
      cam.setCam(camCentered({ x: w.x - off.x, y: w.y - off.y }, z, cam.getViewSize()));
    };
    const actorAt = (mp: Pt) => {
      for (const c of cursorsRef.current) {
        if (c.id === board.me) continue;
        const p = board.presence.get(c.id);
        if (!p || p.x === undefined || p.y === undefined) continue;
        const d = clampPt(toMap(xf, { x: p.x, y: p.y })).p;
        if (Math.hypot(d.x - mp.x, d.y - mp.y) <= DOT_HIT_PX) return { c, p };
      }
      return null;
    };
    const down = (e: PointerEvent) => {
      e.stopPropagation(); e.preventDefault();
      const mp = local(e);
      const hit = actorAt(mp);
      if (hit) { goTo({ x: hit.p.x!, y: hit.p.y! }, { pulse: hit.c.color }); return; }
      const vp = cam.visibleRect();
      const w = fromMap(xf, mp);
      const inside = containsRect(vp, { x: w.x, y: w.y, w: 0, h: 0 });
      dragOff = inside ? { x: w.x - (vp.x + vp.w / 2), y: w.y - (vp.y + vp.h / 2) } : { x: 0, y: 0 };
      dragging = true; box.classList.add('is-drag');
      canvas.setPointerCapture(e.pointerId);
      centerOn(mp, dragOff);
    };
    const move = (e: PointerEvent) => { e.stopPropagation(); if (dragging) centerOn(local(e), dragOff); };
    const up = (e: PointerEvent) => {
      e.stopPropagation();
      dragging = false; box.classList.remove('is-drag'); wake();
    };
    const stop = (e: Event) => e.stopPropagation();
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    for (const t of ['dblclick', 'mousedown', 'wheel', 'contextmenu'] as const) box.addEventListener(t, stop);

    return () => {
      sub.dispose(); offCam(); offPresence(); offDoc(); offTheme();
      narrow?.removeEventListener?.('change', onMq);
      if (docTimer) clearTimeout(docTimer);
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      for (const t of ['dblclick', 'mousedown', 'wheel', 'contextmenu'] as const) box.removeEventListener(t, stop);
    };
  }, [on, board, env]);

  if (!on) return null;
  return (
    <div ref={wrap} className="pg-minimap" data-pg-ctx="minimap" role="img" aria-label="Minimap" hidden>
      <canvas ref={cvs} />
    </div>
  );
}
