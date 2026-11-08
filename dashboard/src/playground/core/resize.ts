// Pure resize math for the eight selection handles. No React, no DOM, no store.
// The box is recomputed from the ORIGINAL box and the current pointer every frame (never from deltas),
// so toggling Shift/Alt mid-drag never jumps and Escape is exact.
import type { Rect } from './types';

export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export interface ResizeOpts {
  /** Corner drag keeps the original aspect ratio. Ignored for edge handles. */
  shift?: boolean;
  /** The centre is the anchor; both sides move. */
  alt?: boolean;
  /** Shape flagged `lockRatio`: always proportional, edges included. */
  lock?: boolean;
  /** Smallest width/height, default 1. */
  min?: number;
}

export interface ResizeResult { box: Rect; flipX: boolean; flipY: boolean }

const MIN = 1;

export const isHandle = (s: unknown): s is Handle => typeof s === 'string' && (HANDLES as readonly string[]).includes(s);

interface Axis { anchor: number; len: number; flip: boolean; sign: number }

/** One axis: `dir` is -1 (west/north handle), 0 (not dragged) or +1. */
function axis(o: number, len: number, dir: number, p: number, alt: boolean): Axis {
  if (dir === 0) return { anchor: o, len, flip: false, sign: 1 };
  const a = alt ? o + len / 2 : dir > 0 ? o : o + len;
  const e = p - a;
  const sign = e === 0 ? dir : Math.sign(e);
  return { anchor: a, len: alt ? 2 * Math.abs(e) : Math.abs(e), flip: sign * dir < 0, sign };
}

/** New box when `handle` of `orig` is dragged to the point (px, py), in the same space as `orig`. */
export function resizeBoxFlip(orig: Rect, handle: Handle, px: number, py: number, opts: ResizeOpts = {}): ResizeResult {
  const min = opts.min ?? MIN;
  const dx = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0;
  const dy = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0;
  const alt = !!opts.alt;
  const X = axis(orig.x, orig.w, dx, px, alt);
  const Y = axis(orig.y, orig.h, dy, py, alt);
  let w = X.len, h = Y.len;

  const corner = dx !== 0 && dy !== 0;
  const proportional = corner ? !!(opts.shift || opts.lock) : !!opts.lock;
  if (proportional && orig.w > 0 && orig.h > 0) {
    // the dominant pointer axis wins; an edge drag scales the other side with it
    const s = corner ? Math.max(w / orig.w, h / orig.h) : dx !== 0 ? w / orig.w : h / orig.h;
    w = orig.w * s; h = orig.h * s;
  }
  w = Math.max(min, w); h = Math.max(min, h);

  const place = (A: Axis, o: number, len: number, size: number, dir: number) => {
    if (dir === 0) return proportional ? o + len / 2 - size / 2 : o;   // other side of a proportional edge drag grows about the centre
    if (alt) return o + len / 2 - size / 2;
    return A.sign > 0 ? A.anchor : A.anchor - size;
  };
  const box = { x: place(X, orig.x, orig.w, w, dx), y: place(Y, orig.y, orig.h, h, dy), w, h };
  return { box, flipX: X.flip, flipY: Y.flip };
}

export function resizeBox(orig: Rect, handle: Handle, px: number, py: number, opts: ResizeOpts = {}): Rect {
  return resizeBoxFlip(orig, handle, px, py, opts).box;
}

/** Where `m` ends up when the union box `from` is resized into `to` (mirrored on a flipped axis). */
export function scaleInto(from: Rect, to: ResizeResult, m: Rect): Rect {
  const { box, flipX, flipY } = to;
  const sx = from.w > 0 ? box.w / from.w : 1;
  const sy = from.h > 0 ? box.h / from.h : 1;
  const ox = flipX ? from.x + from.w - (m.x + m.w) : m.x - from.x;
  const oy = flipY ? from.y + from.h - (m.y + m.h) : m.y - from.y;
  return { x: box.x + ox * sx, y: box.y + oy * sy, w: m.w * sx, h: m.h * sy };
}
