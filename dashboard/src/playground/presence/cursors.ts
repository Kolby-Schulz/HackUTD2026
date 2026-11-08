// Remote cursor smoothing (MULTI-2). Pure: feed arrival-timestamped samples, ask for a position.
// Renders `delayMs` in the past with linear interpolation; when samples run late it glides with a
// critically damped follower (~60 ms) after at most 150 ms of extrapolation; sparse feeds (agents that
// only publish when they act) are glided to; a jump over 2000 world units snaps with a short fade.

/** Single flag: draw the local human's pointer as an outline arrow too. Flip to false when WP-20 uses native tool cursors. */
export const DRAW_LOCAL_CURSOR = false; // the local human uses native per-tool cursors (ui/board/cursor.ts)

export const DELAY_MS = 100;
export const TAU_MS = 60;
export const MAX_EXTRAPOLATE_MS = 150;
export const SPARSE_GAP_MS = 250;
export const TELEPORT = 2000;
export const FADE_MS = 150;

interface Sample { x: number; y: number; t: number }
export interface Smoothed { x: number; y: number; fade: number; movedAt: number }

export interface Smoother {
  push(x: number, y: number, t: number): void;
  at(now: number): Smoothed | null;
}

export function createSmoother(): Smoother {
  let s: Sample[] = [];
  let px = 0, py = 0, pt = -1;         // displayed (damped) position and the time it was computed
  let fadeFrom = -Infinity;
  let movedAt = -Infinity;
  return {
    push(x, y, t) {
      const last = s[s.length - 1];
      if (last && last.x === x && last.y === y) return;
      if (last && Math.hypot(x - last.x, y - last.y) > TELEPORT) { s = []; px = x; py = y; pt = t; fadeFrom = t; }
      s.push({ x, y, t: last && t <= last.t ? last.t + 1 : t });
      if (s.length > 3) s.shift();
      movedAt = t;
    },
    at(now) {
      if (!s.length) return null;
      const last = s[s.length - 1];
      const dt = pt < 0 ? 0 : Math.max(0, now - pt);
      const prev = s[s.length - 2];
      let tx = last.x, ty = last.y, exact = false;
      if (prev && last.t - prev.t <= SPARSE_GAP_MS) {
        const rt = now - DELAY_MS;
        if (rt <= last.t) {
          let a = s[0], b = s[1];
          for (let i = 1; i < s.length; i++) { a = s[i - 1]; b = s[i]; if (rt <= b.t) break; }
          const k = Math.min(1, Math.max(0, (rt - a.t) / (b.t - a.t)));
          tx = a.x + (b.x - a.x) * k; ty = a.y + (b.y - a.y) * k; exact = true;
        } else {
          const over = Math.min(rt - last.t, MAX_EXTRAPOLATE_MS), span = last.t - prev.t;
          tx = last.x + ((last.x - prev.x) / span) * over; ty = last.y + ((last.y - prev.y) / span) * over;
        }
      }
      if (pt < 0 || exact) { px = tx; py = ty; }
      else { const k = 1 - Math.exp(-dt / TAU_MS); px += (tx - px) * k; py += (ty - py) * k; }
      pt = now;
      return { x: px, y: py, fade: Math.min(1, Math.max(0, (now - fadeFrom) / FADE_MS)), movedAt };
    },
  };
}

// ---- scale and tag declutter (MULTI-16, MULTI-22, CANVAS-42) ----
// Pure helpers. ui/Cursors.tsx calls `layoutTags` once per frame with screen positions and applies the
// result with classList toggles (no React render). Previous-frame results are fed back in for hysteresis.

export const MAX_TAGS = 12;           // full tags shown at once (nearest / highest priority)
export const DOT_MODE_AT = 200;       // beyond this many visible cursors, draw 4px dots only
export const STATUS_MIN_ZOOM = 0.5;   // below this zoom the " · status" text is hidden
export const SHORT_STATUS_AT = 6;     // with more than this many tags, status text is dropped
export const TAG_H = 22;
const TAG_PAD = 4;
const CELL = 64;                      // grid hash cell (px)

export type TagMode = 'full' | 'short' | 'dot';   // full = name + status, short = name only, dot = arrow only
export interface TagItem {
  id: string; x: number; y: number;               // screen px of the arrow tip
  name: string; hasStatus?: boolean;
  kind?: 'human' | 'agent' | 'api'; idle?: boolean;
  boosted?: boolean;                              // hovered, followed, mentioned or selected
}
export interface TagPlan { mode: TagMode; hidden?: number }   // hidden = "+n" chip count on the winning tag

/** Cursor arrow scale: full size at normal zoom, shrinking to 0.7 when zoomed far out so crowds stay readable. */
export function cursorScale(zoom: number): number {
  if (!(zoom > 0)) return 1;
  return Math.min(1, Math.max(0.7, 0.7 + 0.3 * (zoom / 0.5)));
}

/** Estimated tag width in px (11px semibold text, glyph, padding). */
export function tagWidth(name: string, withStatus: boolean): number {
  return 34 + Math.min(18, name.length) * 6.4 + (withStatus ? 64 : 0);
}

const rank = (i: TagItem, prev?: Map<string, TagPlan>) =>
  (i.boosted ? 1000 : 0) + (i.kind === 'human' ? 100 : i.idle ? 0 : 50) + (prev?.get(i.id)?.mode === 'full' || prev?.get(i.id)?.mode === 'short' ? 20 : 0);

/**
 * Decide which tags show. Highest priority first (boosted, humans, working agents, then ones that were
 * shown last frame, then nearest to `focus`); a tag is kept if it is among the first MAX_TAGS and its box
 * does not overlap a kept tag (grid hash). Losers become dots; the winner that blocked them gets a "+n" count.
 * `off` items (outside the viewport) are skipped entirely.
 */
export function layoutTags(items: TagItem[], o: { zoom: number; view: { w: number; h: number }; focus?: { x: number; y: number }; prev?: Map<string, TagPlan>; maxTags?: number }): Map<string, TagPlan> {
  const out = new Map<string, TagPlan>();
  const max = o.maxTags ?? MAX_TAGS;
  const vis = items.filter((i) => i.x > -40 && i.y > -40 && i.x < o.view.w + 40 && i.y < o.view.h + 40);
  for (const i of items) out.set(i.id, { mode: 'dot' });
  if (vis.length > DOT_MODE_AT) return out;
  const f = o.focus, d = (i: TagItem) => (f ? Math.hypot(i.x - f.x, i.y - f.y) : 0);
  const order = vis.map((i) => ({ i, r: rank(i, o.prev), d: d(i) })).sort((a, b) => b.r - a.r || a.d - b.d || (a.i.id < b.i.id ? -1 : 1));
  const showStatus = o.zoom >= STATUS_MIN_ZOOM && vis.length <= SHORT_STATUS_AT;
  const grid = new Map<string, { id: string; l: number; t: number; r: number; b: number }[]>();
  let shown = 0;
  for (const { i } of order) {
    const withStatus = showStatus && !!i.hasStatus;
    const l = i.x + 16, t = i.y + 18, r = l + tagWidth(i.name, withStatus), b = t + TAG_H;
    let blocker: string | null = null;
    const cells: string[] = [];
    for (let cx = Math.floor((l - TAG_PAD) / CELL); cx <= Math.floor((r + TAG_PAD) / CELL); cx++)
      for (let cy = Math.floor((t - TAG_PAD) / CELL); cy <= Math.floor((b + TAG_PAD) / CELL); cy++) cells.push(cx + ',' + cy);
    if (shown >= max) blocker = '';
    else for (const c of cells) {
      for (const k of grid.get(c) ?? []) if (l < k.r + TAG_PAD && r + TAG_PAD > k.l && t < k.b + TAG_PAD && b + TAG_PAD > k.t) { blocker = k.id; break; }
      if (blocker) break;
    }
    if (blocker === null) {
      shown++;
      const box = { id: i.id, l, t, r, b };
      for (const c of cells) { const a = grid.get(c); if (a) a.push(box); else grid.set(c, [box]); }
      out.set(i.id, { mode: withStatus ? 'full' : 'short' });
    } else if (blocker) {
      const w = out.get(blocker)!;
      w.hidden = (w.hidden ?? 0) + 1;
    }
  }
  return out;
}
