// Pure 2D geometry: rects, points, rotation and affine matrices. No React or DOM.
import type { Pt, Rect } from './types';

export const COORD_LIMIT = 1e7;

export function clampCoord(n: number): number {
  return Math.max(-COORD_LIMIT, Math.min(COORD_LIMIT, n));
}

/** Rect with positive w/h (a drag that went up/left gives negative sizes). */
export function norm(r: Rect): Rect {
  return {
    x: r.w < 0 ? r.x + r.w : r.x,
    y: r.h < 0 ? r.y + r.h : r.y,
    w: Math.abs(r.w),
    h: Math.abs(r.h),
  };
}

export function rectFromPoints(a: Pt, b: Pt): Rect {
  return norm({ x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y });
}

export function union(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Touching edges do not count as intersecting. */
export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function intersection(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
  return x1 > x && y1 > y ? { x, y, w: x1 - x, h: y1 - y } : null;
}

export function containsPoint(r: Rect, p: Pt): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

/** True when outer fully covers inner. */
export function containsRect(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

export function center(r: Rect): Pt {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

export function translateRect(r: Rect, dx: number, dy: number): Rect {
  return { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h };
}

/** Rotation in degrees normalized to (-180, 180]. */
export function normAngle(deg: number): number {
  let a = deg % 360;
  if (a > 180) a -= 360;
  if (a <= -180) a += 360;
  return a;
}

/** Rotate p about c by deg degrees clockwise (y axis points down, as on screen). */
export function rotatePoint(p: Pt, c: Pt, deg: number): Pt {
  const t = (deg * Math.PI) / 180, cos = Math.cos(t), sin = Math.sin(t);
  const dx = p.x - c.x, dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

/** Axis-aligned bounds of a rect rotated about its center. */
export function rotatedBounds(r: Rect, deg: number): Rect {
  if (!deg) return r;
  const c = center(r);
  const corners = [
    { x: r.x, y: r.y }, { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h },
  ].map((p) => rotatePoint(p, c, deg));
  return union(corners.map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 })))!;
}

// ---- affine matrices: [a, b, c, d, e, f] maps (x, y) to (a x + c y + e, b x + d y + f) ----
export type Mat = readonly [number, number, number, number, number, number];
export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

/** Apply m after n: multiply(m, n) is "n first, then m". */
export function multiply(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function invert(m: Mat): Mat | null {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det || !Number.isFinite(det)) return null;
  const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

export function applyMat(m: Mat, p: Pt): Pt {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

/** Local transform of a box: translate to (x, y), rotate about the box center. Children live in this space. */
export function boxMatrix(r: Rect, rotation = 0): Mat {
  const t = (rotation * Math.PI) / 180, cos = Math.cos(t), sin = Math.sin(t);
  const cx = r.w / 2, cy = r.h / 2;
  // x + cx + R(p - c)  =>  linear part R, translation (x + cx - R c)
  return [cos, sin, -sin, cos, r.x + cx - (cos * cx - sin * cy), r.y + cy - (sin * cx + cos * cy)];
}
