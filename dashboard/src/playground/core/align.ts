// Align and distribute (ALIGN-11, ALIGN-13) as pure command batches, plus the agent snapping helper (ALIGN-10).
// No React, no DOM. Callers run the returned commands in ONE board.exec so the whole action is one undo entry.
import type { Command, Rect, ShapeId } from './types';
import { union } from './geom';
import { ancestors, worldBounds } from './tree';
import type { TreeView } from './tree';
import { snapMove } from './snap';
import type { SnapCtx } from './snap';

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';
export const ALIGN_MODES: readonly AlignMode[] = ['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'];

/** World-space bounds (rotated box) of each movable top-level member: drops unknown, deleted, locked and nested ids. */
function members(view: TreeView, ids: readonly ShapeId[]): Array<{ id: ShapeId; box: Rect }> {
  const set = new Set(ids);
  const out: Array<{ id: ShapeId; box: Rect }> = [];
  for (const id of set) {
    const s = view.shapes.get(id);
    if (!s || s.deleted || s.locked) continue;
    if (ancestors(view, id).some((a) => set.has(a))) continue; // moves with its selected parent
    const box = worldBounds(view, id);
    if (box) out.push({ id, box });
  }
  return out;
}

/** The rectangle to align to: the selection's bounds for 2+ shapes, the parent frame for exactly one. Null = nothing to do. */
function target(view: TreeView, mem: Array<{ id: ShapeId; box: Rect }>): Rect | null {
  if (mem.length >= 2) return union(mem.map((m) => m.box));
  if (mem.length === 1) {
    const p = view.shapes.get(mem[0]!.id)?.parent;
    if (p == null || !view.shapes.has(p)) return null;
    return worldBounds(view, p);
  }
  return null;
}

/** True when the align bar can act on this selection (2+ movable shapes, or one inside a parent). */
export function canAlign(view: TreeView, ids: readonly ShapeId[]): boolean {
  const mem = members(view, ids);
  return mem.length > 0 && target(view, mem) !== null;
}

function deltaFor(mode: AlignMode, box: Rect, t: Rect): { dx: number; dy: number } {
  switch (mode) {
    case 'left': return { dx: t.x - box.x, dy: 0 };
    case 'right': return { dx: t.x + t.w - (box.x + box.w), dy: 0 };
    case 'hcenter': return { dx: t.x + t.w / 2 - (box.x + box.w / 2), dy: 0 };
    case 'top': return { dx: 0, dy: t.y - box.y };
    case 'bottom': return { dx: 0, dy: t.y + t.h - (box.y + box.h) };
    case 'vcenter': return { dx: 0, dy: t.y + t.h / 2 - (box.y + box.h / 2) };
  }
}

/** One `shape.translate` per shape that actually moves, deltas rounded to integers. Empty when nothing moves. */
export function alignCommands(view: TreeView, ids: readonly ShapeId[], mode: AlignMode): Command[] {
  const mem = members(view, ids);
  const t = target(view, mem);
  if (!t) return [];
  const cmds: Command[] = [];
  for (const m of mem) {
    const d = deltaFor(mode, m.box, t);
    const dx = Math.round(d.dx), dy = Math.round(d.dy);
    if (dx !== 0 || dy !== 0) cmds.push({ t: 'shape.translate', ids: [m.id], dx, dy });
  }
  return cmds;
}

/** Equal gaps between consecutive shapes (first and last stay put). Needs 3+ movable shapes. */
export function distributeCommands(view: TreeView, ids: readonly ShapeId[], axis: 'h' | 'v'): Command[] {
  const mem = members(view, ids);
  if (mem.length < 3) return [];
  const h = axis === 'h';
  const pos = (b: Rect) => (h ? b.x : b.y);
  const size = (b: Rect) => (h ? b.w : b.h);
  const sorted = [...mem].sort((a, b) => pos(a.box) + size(a.box) / 2 - (pos(b.box) + size(b.box) / 2));
  const first = sorted[0]!.box, last = sorted[sorted.length - 1]!.box;
  const span = pos(last) + size(last) - pos(first);
  const total = sorted.reduce((n, m) => n + size(m.box), 0);
  const gap = (span - total) / (sorted.length - 1);
  const cmds: Command[] = [];
  let cursor = pos(first) + size(first) + gap;
  for (let i = 1; i < sorted.length - 1; i++) {
    const m = sorted[i]!;
    const d = Math.round(cursor - pos(m.box));
    if (d !== 0) cmds.push({ t: 'shape.translate', ids: [m.id], dx: h ? d : 0, dy: h ? 0 : d });
    cursor += size(m.box) + gap;
  }
  return cmds;
}

// ---- agent snapping (ALIGN-10): the same facade the human gestures use, with a 2-world-unit threshold ----
export const AGENT_SNAP_THRESHOLD = 2;

/** Snap a box an agent is about to place and round it to integers. Returns the corrected box. */
export function agentSnapMove(box: Rect, ctx: Omit<SnapCtx, 'thresholdWorld'>): Rect {
  const r = snapMove(box, { ...ctx, thresholdWorld: AGENT_SNAP_THRESHOLD });
  return { x: Math.round(box.x + r.dx), y: Math.round(box.y + r.dy), w: Math.round(box.w), h: Math.round(box.h) };
}
