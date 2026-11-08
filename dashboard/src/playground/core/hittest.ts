// The one hit-test (D6, CANVAS-21, SELECT-47). Pure: takes a tree view and a SpatialIndex.
import { applyMat, invert, multiply, boxMatrix } from './geom';
import type { Mat } from './geom';
import { ancestors, flatten, worldMatrix } from './tree';
import type { TreeView } from './tree';
import { SpatialIndex } from './spatial';
import type { Pt, Rect, Shape, ShapeId } from './types';

export interface HitOpts {
  /** Camera zoom; tolerance in world units is tolerancePx / z. */
  z?: number;
  tolerancePx?: number;
  /** Cmd/Ctrl: return the deepest descendant instead of the top-level container child. */
  deep?: boolean;
  /** Locked shapes are skipped unless true. Hidden shapes are never hit. */
  includeLocked?: boolean;
  /** Never return these ids (or anything inside them). */
  exclude?: ReadonlySet<ShapeId>;
}

const hasFill = (s: Shape) => s.fills.some((f) => !f.hidden && f.opacity !== 0);
const strokeHalf = (s: Shape) => Math.max(0, ...(s.strokes ?? []).filter((k) => !k.hidden).map((k) => k.width / 2));

function corners(s: Shape): [number, number, number, number] {
  const r = s.radius ?? 0;
  const lim = Math.min(s.w, s.h) / 2;
  const a: number[] = Array.isArray(r) ? r : [r, r, r, r];
  return a.map((v) => Math.max(0, Math.min(v, lim))) as [number, number, number, number];
}

/** Distance from p (local) to the box outline; negative when inside, ellipse/rounded aware. */
function signedDist(s: Shape, p: Pt): number {
  const { w, h } = s;
  if (s.kind === 'ellipse') {
    const rx = w / 2, ry = h / 2;
    if (rx <= 0 || ry <= 0) return Math.hypot(p.x - rx, p.y - ry);
    const dx = (p.x - rx) / rx, dy = (p.y - ry) / ry;
    const d = Math.hypot(dx, dy);
    if (d === 0) return -Math.min(rx, ry);
    // First-order distance to the ellipse boundary along the radial direction.
    return (d - 1) * Math.min(rx, ry);
  }
  // Rounded rect via the standard rounded-box distance (per-corner radius).
  const [tl, tr, br, bl] = corners(s);
  const left = p.x < w / 2, top = p.y < h / 2;
  const r = top ? (left ? tl : tr) : (left ? bl : br);
  const qx = Math.abs(p.x - w / 2) - (w / 2 - r), qy = Math.abs(p.y - h / 2) - (h / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Does world point `pt` hit shape `s` (tolerance `tol` world units)? Ancestor clipping is the caller's job. */
function hitsShape(view: TreeView, s: Shape, pt: Pt, tol: number): boolean {
  const parentM = worldMatrix(view, s.parent !== null && view.shapes.has(s.parent) ? s.parent : null);
  const inv = invert(multiply(parentM, boxMatrix({ x: s.x, y: s.y, w: s.w, h: s.h }, s.rotation)));
  if (!inv) return false;
  const p = applyMat(inv, pt);
  if (s.kind === 'line') return segDist(p, { x: 0, y: 0 }, { x: s.w, y: s.h }) <= tol + strokeHalf(s);
  if (s.kind === 'text' || s.kind === 'image') {
    return p.x >= -tol && p.y >= -tol && p.x <= s.w + tol && p.y <= s.h + tol;
  }
  const d = signedDist(s, p);
  if (hasFill(s)) return d <= tol;
  // No fill: only the edge band (stroke plus tolerance) counts.
  return Math.abs(d) <= tol + strokeHalf(s);
}

/** Hidden self/ancestor, locked self/ancestor (unless asked), excluded self/ancestor. */
function blocked(view: TreeView, id: ShapeId, opts: HitOpts): boolean {
  for (const a of [id, ...ancestors(view, id)]) {
    const s = view.shapes.get(a);
    if (!s || s.deleted || s.hidden) return true;
    if (s.locked && !opts.includeLocked) return true;
    if (opts.exclude?.has(a)) return true;
  }
  return false;
}

/** A clipping ancestor frame must contain the point (no tolerance), else the child cannot be hit there. */
function clippedOut(view: TreeView, id: ShapeId, pt: Pt): boolean {
  for (const a of ancestors(view, id)) {
    const f = view.shapes.get(a)!;
    if (f.kind !== 'frame' || f.clip === false) continue;
    const inv = invert(multiply(worldMatrix(view, f.parent !== null && view.shapes.has(f.parent) ? f.parent : null), boxMatrix({ x: f.x, y: f.y, w: f.w, h: f.h }, f.rotation)));
    if (!inv) return true;
    const p = applyMat(inv, pt);
    if (p.x < 0 || p.y < 0 || p.x > f.w || p.y > f.h) return true;
  }
  return false;
}

/** Default selection target: climb out of groups, stop at frames (a frame's children are individually selectable). */
export function topLevelTarget(view: TreeView, id: ShapeId): ShapeId {
  let cur = id;
  for (;;) {
    const p = view.shapes.get(cur)?.parent;
    if (p == null || view.shapes.get(p)?.kind !== 'group') return cur;
    cur = p;
  }
}

/** The shape under a world point, or null. Topmost in paint (flatten) order wins. */
export function hitTest(view: TreeView, index: SpatialIndex, pt: Pt, opts: HitOpts = {}): ShapeId | null {
  const tol = (opts.tolerancePx ?? 4) / (opts.z && opts.z > 0 ? opts.z : 1);
  const cands = index.queryPoint(pt, tol);
  if (cands.length === 0) return null;
  const rank = index.order(view, flatten);
  cands.sort((a, b) => (rank.get(b) ?? -1) - (rank.get(a) ?? -1));
  for (const id of cands) {
    const s = view.shapes.get(id);
    if (!s || s.kind === 'group') continue; // groups are hit through their children
    if (blocked(view, id, opts) || clippedOut(view, id, pt)) continue;
    if (!hitsShape(view, s, pt, tol)) continue;
    return opts.deep ? id : topLevelTarget(view, id);
  }
  return null;
}

/** Marquee: targets whose world bounds touch `rect`, in paint order. Same hidden/locked/deep rules as hitTest. */
export function hitRect(view: TreeView, index: SpatialIndex, rect: Rect, opts: HitOpts = {}): ShapeId[] {
  const rank = index.order(view, flatten);
  const out = new Set<ShapeId>();
  for (const id of index.queryRect(rect)) {
    const s = view.shapes.get(id);
    if (!s || (opts.deep && s.kind === 'group') || blocked(view, id, opts)) continue;
    out.add(opts.deep ? id : topLevelTarget(view, id));
  }
  return [...out].sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
}
