// Rotate the selection from the ring just outside a corner (SELECT-18, SELECT-19, ALIGN-22).
// One shape rotates about its own centre; several rotate as a group about the centre of their union.
// Each frame re-plans from the original shapes as absolute targets through one board.gesture (one undo
// entry); Escape aborts. Shift snaps the absolute angle to 15 degrees; without Shift the angle snaps
// magnetically to 0/90/180/270 within 3 degrees. Rotation is stored clockwise in degrees.
import { applyMat, boxMatrix, center, multiply, normAngle, union } from '../../core/geom';
import { toLocal, worldBounds, worldMatrix } from '../../core/tree';
import type { Command, Gesture, Pt, ShapeId } from '../../core/types';
import { selectedIds } from '../board/state';
import type { BoardEnv } from '../board/state';
import type { Mode, PointerInfo } from './pipeline';

export const ROT_PREFIX = 'rot-';
export const SNAP_STEP = 15;
export const MAGNET_DEG = 3;

export const isRotateHandle = (h: unknown): boolean => typeof h === 'string' && /^rot-(nw|ne|sw|se)$/.test(h);

/** Clockwise degrees of the pointer around `c` (0 = east, 90 = south; y points down). */
export function pointerAngle(c: Pt, p: Pt): number {
  return (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI;
}

/** Angle after snapping: Shift = nearest 15 (absolute); otherwise magnet to 0/90/180/270 within 3 degrees. */
export function snapAngle(deg: number, shift: boolean): number {
  if (shift) return normAngle(Math.round(deg / SNAP_STEP) * SNAP_STEP);
  const q = Math.round(deg / 90) * 90;
  return Math.abs(deg - q) <= MAGNET_DEG ? normAngle(q) : normAngle(deg);
}

// ---- cursors (SELECT-31) ----
const CORNER_DIR: Record<string, number> = { nw: 225, ne: 315, se: 45, sw: 135 };   // screen angle of the corner from the centre
const EDGE_DIR: Record<string, number> = { n: 270, e: 0, s: 90, w: 180 };

/** Resize cursor for a handle on a shape rotated by `rot` degrees: the handle's axis snapped to 45 degrees. */
export function resizeCursor(handle: string, rot: number): string {
  const base = CORNER_DIR[handle] ?? EDGE_DIR[handle];
  if (base === undefined) return 'default';
  const a = ((Math.round((base + rot) / 45) * 45) % 180 + 180) % 180;
  return a === 0 ? 'ew-resize' : a === 45 ? 'nwse-resize' : a === 90 ? 'ns-resize' : 'nesw-resize';
}

/** Rotate-ring cursor: a curved double arrow turned to the corner angle (nearest 15 degrees), `grab` as fallback. */
export function rotateCursor(corner: string, rot: number): string {
  const base = (CORNER_DIR[corner] ?? 225) + 45;           // art points with the corner at the top-left
  const a = ((Math.round((base + rot) / 15) * 15) % 360 + 360) % 360;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><g transform='rotate(${a} 12 12)'>`
    + `<path d='M5 14 A8 8 0 0 1 14 5' fill='none' stroke='white' stroke-width='4' stroke-linecap='round'/>`
    + `<path d='M5 14 A8 8 0 0 1 14 5' fill='none' stroke='black' stroke-width='1.6' stroke-linecap='round'/>`
    + `<path d='M2 12 L5 17 L9 13 Z M12 2 L17 5 L13 9 Z' fill='black' stroke='white' stroke-width='1.2' stroke-linejoin='round'/></g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 12 12, grab`;
}

interface Member { id: ShapeId; parent: ShapeId | null; w: number; h: number; rot: number; cx: number; cy: number }

export function startRotate(env: BoardEnv, p0: PointerInfo): Mode | null {
  if (!isRotateHandle(p0.handle)) return null;
  const { board } = env;
  const st = board.doc.getState();
  const live = (id: ShapeId) => { const s = st.shapes.get(id); return s && !s.deleted ? s : undefined; };
  const picked = selectedIds(board).filter((id) => live(id) && !live(id)!.locked);
  const pickedSet = new Set(picked);
  const roots = picked.filter((id) => {
    for (let p = live(id)!.parent; p !== null; p = st.shapes.get(p)?.parent ?? null) if (pickedSet.has(p)) return false;
    return true;
  });
  if (!roots.length) return null;

  const members: Member[] = roots.map((id) => {
    const s = live(id)!;
    const parent = s.parent !== null && st.shapes.has(s.parent) ? s.parent : null;
    const m = multiply(worldMatrix(st, parent), boxMatrix({ x: s.x, y: s.y, w: s.w, h: s.h }, s.rotation));
    const c = applyMat(m, { x: s.w / 2, y: s.h / 2 });
    return { id, parent, w: s.w, h: s.h, rot: s.rotation ?? 0, cx: c.x, cy: c.y };
  });
  const single = members.length === 1;
  const pivot: Pt = single ? { x: members[0].cx, y: members[0].cy }
    : center(union(roots.map((id) => worldBounds(st, id)!))!);
  const a0 = pointerAngle(pivot, p0.world);
  // a single shape rotates to an absolute angle (so Shift lands on 15 multiples); a group by the pointer delta
  const base = single ? members[0].rot : 0;

  const commands = (p: PointerInfo): Command[] => {
    const raw = base + pointerAngle(pivot, p.world) - a0;
    const delta = snapAngle(raw, p.shift) - base;
    return members.map((m) => {
      let c: Pt = { x: m.cx, y: m.cy };
      if (!single) {
        const t = (delta * Math.PI) / 180, cos = Math.cos(t), sin = Math.sin(t);
        const dx = m.cx - pivot.x, dy = m.cy - pivot.y;
        c = { x: pivot.x + dx * cos - dy * sin, y: pivot.y + dx * sin + dy * cos };
      }
      const l = toLocal(st, m.parent, c);
      return { t: 'shape.update', ids: [m.id], patch: { x: l.x - m.w / 2, y: l.y - m.h / 2, rotation: normAngle(m.rot + delta) } } as Command;
    });
  };

  const prevCursor = typeof document !== 'undefined' ? document.body.style.cursor : '';
  const corner = p0.handle!.slice(ROT_PREFIX.length);
  if (typeof document !== 'undefined') document.body.style.cursor = rotateCursor(corner, single ? members[0].rot : 0);
  const restore = () => { if (typeof document !== 'undefined') document.body.style.cursor = prevCursor; };

  let g: Gesture | null = null;
  const apply = (p: PointerInfo) => {
    g ??= board.gesture(board.me, members.length > 1 ? `Rotate ${members.length} layers` : 'Rotate', { coalesceKey: 'rotate' });
    g.update(commands(p));
  };
  return {
    move: apply,
    up(p) {
      restore();
      if (!g && p.clientX === p0.clientX && p.clientY === p0.clientY) return;   // click on the ring: no change
      apply(p);
      g!.commit();
    },
    cancel() { restore(); g?.abort(); },
  };
}
