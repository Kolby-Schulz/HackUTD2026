// The derived tree (D1): flat map with explicit parent, local coordinates, sibling order by (index, id).
// Pure functions over a TreeView (DocState satisfies it). Tombstones stay in `shapes` but not in `children`.
import { COORD_LIMIT, IDENTITY, applyMat, boxMatrix, clampCoord, invert, multiply, normAngle, union } from './geom';
import type { Mat } from './geom';
import { compareSiblings } from './order';
import type { Pt, Rect, Shape, ShapeId, ShapeProps } from './types';

export interface TreeView {
  shapes: ReadonlyMap<ShapeId, Shape>;
  children: ReadonlyMap<ShapeId | null, readonly ShapeId[]>;
}

/** Children index: parent -> ids sorted by (index, id). Missing parents count as root; tombstones are left out. */
export function buildChildren(shapes: ReadonlyMap<ShapeId, Shape>): Map<ShapeId | null, ShapeId[]> {
  const groups = new Map<ShapeId | null, Shape[]>();
  for (const s of shapes.values()) {
    if (s.deleted) continue;
    const parent = s.parent !== null && shapes.has(s.parent) ? s.parent : null;
    const list = groups.get(parent);
    if (list) list.push(s); else groups.set(parent, [s]);
  }
  const out = new Map<ShapeId | null, ShapeId[]>();
  for (const [parent, list] of groups) out.set(parent, list.sort(compareSiblings).map((s) => s.id));
  return out;
}

/** Ids from the parent up to the root (nearest first). Stops on a cycle. */
export function ancestors(view: TreeView, id: ShapeId): ShapeId[] {
  const out: ShapeId[] = [];
  const seen = new Set<ShapeId>([id]);
  let p = view.shapes.get(id)?.parent ?? null;
  while (p !== null && view.shapes.has(p) && !seen.has(p)) {
    out.push(p);
    seen.add(p);
    p = view.shapes.get(p)!.parent;
  }
  return out;
}

/** True when `id` sits anywhere below `ofId`. */
export function isDescendant(view: TreeView, id: ShapeId, ofId: ShapeId): boolean {
  return ancestors(view, id).includes(ofId);
}

/** Reparenting `id` under `newParent` would make a cycle (also true for itself). */
export function wouldCycle(view: TreeView, id: ShapeId, newParent: ShapeId | null): boolean {
  return newParent !== null && (newParent === id || isDescendant(view, newParent, id));
}

/** All live descendants of id, parents before children. */
export function descendants(view: TreeView, id: ShapeId): ShapeId[] {
  const out: ShapeId[] = [];
  const walk = (p: ShapeId) => {
    for (const c of view.children.get(p) ?? []) { out.push(c); walk(c); }
  };
  walk(id);
  return out;
}

/** Paint order: depth-first, parent before its children, siblings by index (last paints on top). */
export function flatten(view: TreeView, from: ShapeId | null = null): ShapeId[] {
  const out: ShapeId[] = [];
  const walk = (p: ShapeId | null) => {
    for (const c of view.children.get(p) ?? []) { out.push(c); walk(c); }
  };
  walk(from);
  return out;
}

// ---- geometry through the tree ----

/** World matrix of the space a shape's children live in (origin at its top-left, rotated about its center). */
export function worldMatrix(view: TreeView, id: ShapeId | null): Mat {
  if (id === null) return IDENTITY;
  const chain = [id, ...ancestors(view, id)].reverse();
  let m = IDENTITY;
  for (const sid of chain) {
    const s = view.shapes.get(sid)!;
    m = multiply(m, boxMatrix({ x: s.x, y: s.y, w: s.w, h: s.h }, s.rotation));
  }
  return m;
}

/** Unrotated box in world space: own x, y plus every ancestor's x, y. Null for an unknown id. */
export function absRect(view: TreeView, id: ShapeId): Rect | null {
  const s = view.shapes.get(id);
  if (!s) return null;
  let x = s.x, y = s.y;
  for (const a of ancestors(view, id)) { x += view.shapes.get(a)!.x; y += view.shapes.get(a)!.y; }
  return { x, y, w: s.w, h: s.h };
}

/** Axis-aligned world bounds including this shape's rotation and every ancestor's. */
export function worldBounds(view: TreeView, id: ShapeId): Rect | null {
  const s = view.shapes.get(id);
  if (!s) return null;
  const m = worldMatrix(view, s.parent !== null && view.shapes.has(s.parent) ? s.parent : null);
  const box = boxMatrix({ x: s.x, y: s.y, w: s.w, h: s.h }, s.rotation);
  const full = multiply(m, box);
  const corners = [{ x: 0, y: 0 }, { x: s.w, y: 0 }, { x: s.w, y: s.h }, { x: 0, y: s.h }]
    .map((p) => applyMat(full, p));
  return union(corners.map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 })));
}

/** Point in `parent`'s local space (null = root) to world space. */
export function toWorld(view: TreeView, parent: ShapeId | null, p: Pt): Pt {
  return applyMat(worldMatrix(view, parent), p);
}

/** World point to `parent`'s local space. Falls back to the input if the matrix is singular. */
export function toLocal(view: TreeView, parent: ShapeId | null, p: Pt): Pt {
  const inv = invert(worldMatrix(view, parent));
  return inv ? applyMat(inv, p) : p;
}

/** Topmost visible frame under a world point (deepest wins, later siblings win). */
export function frameAt(view: TreeView, p: Pt, opts: { exclude?: readonly ShapeId[] } = {}): ShapeId | null {
  const skip = new Set<ShapeId>();
  for (const id of opts.exclude ?? []) { skip.add(id); descendants(view, id).forEach((d) => skip.add(d)); }
  const order = flatten(view);
  for (let i = order.length - 1; i >= 0; i--) {
    const s = view.shapes.get(order[i])!;
    if (s.kind !== 'frame' || s.hidden || skip.has(s.id)) continue;
    const local = toLocal(view, s.id, p);
    if (local.x >= 0 && local.y >= 0 && local.x <= s.w && local.y <= s.h) return s.id;
  }
  return null;
}

/** Visual-position-preserving parent change for a box: returns the new local x, y and rotation. */
export function reparentBox(view: TreeView, id: ShapeId, newParent: ShapeId | null): Pick<ShapeProps, 'x' | 'y' | 'rotation'> | null {
  const s = view.shapes.get(id);
  if (!s) return null;
  const oldParent = s.parent !== null && view.shapes.has(s.parent) ? s.parent : null;
  const world = multiply(worldMatrix(view, oldParent), boxMatrix({ x: s.x, y: s.y, w: s.w, h: s.h }, s.rotation));
  const inv = invert(worldMatrix(view, newParent));
  if (!inv) return null;
  const local = multiply(inv, world); // box matrix expressed in the new parent's space
  const rotation = normAngle((Math.atan2(local[1], local[0]) * 180) / Math.PI);
  const c = applyMat(local, { x: s.w / 2, y: s.h / 2 }); // center in new parent space
  return { x: c.x - s.w / 2, y: c.y - s.h / 2, rotation };
}

// ---- shape records (HISTORY-27, HISTORY-41) ----

const PROP_KEY_MAP: Record<keyof ShapeProps, true> = {
  name: true, nameAuto: true, x: true, y: true, w: true, h: true, rotation: true, flipX: true, flipY: true,
  hidden: true, locked: true, opacity: true, fills: true, strokes: true, effects: true, radius: true,
  clip: true, lockRatio: true, text: true, fontFamily: true, fontSize: true, fontWeight: true,
  lineHeight: true, letterSpacing: true, textAlign: true, textVAlign: true, textMode: true, color: true,
  humanEdited: true, constraints: true, author: true,
};
export const PROP_KEYS = Object.keys(PROP_KEY_MAP) as (keyof ShapeProps)[];
const RECORD_KEYS = ['id', 'kind', 'parent', 'index', 'createdBy', 'deleted', 'stamps'];

/**
 * Fill defaults, clamp coordinates, flip negative sizes, migrate legacy `fill` to `fills`, drop unknown
 * and ephemeral fields (`owner`). Idempotent. Throws on NaN/Infinity in geometry (reject bad API input).
 */
export function normalizeShape(rec: Record<string, any>): Shape {
  const num = (k: string, dflt: number) => {
    const v = rec[k] ?? dflt;
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new RangeError(`shape.${k} must be a finite number`);
    return v;
  };
  let x = num('x', 0), y = num('y', 0), w = num('w', 0), h = num('h', 0);
  if (w < 0) { x += w; w = -w; }
  if (h < 0) { y += h; h = -h; }
  const out: Record<string, any> = {};
  for (const k of PROP_KEYS) if (rec[k] !== undefined) out[k] = rec[k];
  for (const k of RECORD_KEYS) if (rec[k] !== undefined) out[k] = rec[k];
  Object.assign(out, { x: clampCoord(x), y: clampCoord(y), w: Math.min(w, COORD_LIMIT), h: Math.min(h, COORD_LIMIT) });
  if (out.fills === undefined) {
    const legacy = rec.fill;
    out.fills = typeof legacy === 'string' ? [{ type: 'solid', color: legacy }] : [];
  }
  out.name ??= String(rec.kind ?? 'shape');
  out.parent ??= null;
  out.index ??= 'V';
  out.stamps ??= {};
  if (out.rotation !== undefined) out.rotation = normAngle(out.rotation);
  return out as Shape;
}
