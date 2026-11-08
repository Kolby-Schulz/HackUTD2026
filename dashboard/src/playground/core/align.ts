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

/** What to align to: the selection's bounds (default), each shape's own parent, or the key object (first selected). */
export type AlignTarget = 'selection' | 'parent' | 'key';

/** Rect a member aligns to under the chosen target; null when it has no parent (parent mode) or no key. */
function targetFor(view: TreeView, mem: Array<{ id: ShapeId; box: Rect }>, m: { id: ShapeId; box: Rect }, how: AlignTarget, keyId?: ShapeId): Rect | null {
  if (how === 'parent') {
    const p = view.shapes.get(m.id)?.parent;
    return p == null || !view.shapes.has(p) ? null : worldBounds(view, p);
  }
  if (how === 'key') return keyBox(mem, keyId)?.box ?? null;
  return target(view, mem);
}

/** The key object: the named id if it is a member, otherwise the first selected movable shape. */
function keyBox(mem: Array<{ id: ShapeId; box: Rect }>, keyId?: ShapeId) {
  return mem.find((m) => m.id === keyId) ?? mem[0];
}

/** True when `how` can work for this selection (parent needs every shape in a parent, key needs 2+). */
export function canAlignTo(view: TreeView, ids: readonly ShapeId[], how: AlignTarget): boolean {
  const mem = members(view, ids);
  if (!mem.length) return false;
  if (how === 'parent') return mem.every((m) => targetFor(view, mem, m, 'parent') !== null);
  if (how === 'key') return mem.length >= 2;
  return target(view, mem) !== null;
}

/** One `shape.translate` per shape that actually moves, deltas rounded to integers. Empty when nothing moves.
 *  `how` defaults to the old rule (selection bounds for 2+, parent for one). `keyId` picks the key object. */
export function alignCommands(view: TreeView, ids: readonly ShapeId[], mode: AlignMode, how?: AlignTarget, keyId?: ShapeId): Command[] {
  const mem = members(view, ids);
  const eff: AlignTarget = how ?? 'selection';
  if (how === undefined && mem.length === 1) return alignOne(view, mem, mode);
  const cmds: Command[] = [];
  for (const m of mem) {
    const t = targetFor(view, mem, m, eff, keyId);
    if (!t) continue;
    if (eff === 'key' && m.id === keyBox(mem, keyId)?.id) continue;
    const d = deltaFor(mode, m.box, t);
    const dx = Math.round(d.dx), dy = Math.round(d.dy);
    if (dx !== 0 || dy !== 0) cmds.push({ t: 'shape.translate', ids: [m.id], dx, dy });
  }
  return cmds;
}

function alignOne(view: TreeView, mem: Array<{ id: ShapeId; box: Rect }>, mode: AlignMode): Command[] {
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

/** Why distribute cannot run on this selection, or null when it can. */
export function distributeBlocked(view: TreeView, ids: readonly ShapeId[]): string | null {
  const mem = members(view, ids);
  if (mem.length < 3) return 'Select 3+ layers to distribute';
  const p0 = view.shapes.get(mem[0]!.id)?.parent ?? null;
  if (mem.some((m) => (view.shapes.get(m.id)?.parent ?? null) !== p0)) return 'Select layers in the same frame';
  return null;
}

/** Why match size cannot run, or null when it can. */
export function matchBlocked(view: TreeView, ids: readonly ShapeId[]): string | null {
  return members(view, ids).length < 2 ? 'Select 2+ layers to match size' : null;
}

/** Resize every member (except the key object) to the key's width and/or height, keeping its top-left. Text keeps its auto height. */
export function matchSizeCommands(view: TreeView, ids: readonly ShapeId[], dim: 'w' | 'h' | 'both', keyId?: ShapeId): Command[] {
  const mem = members(view, ids);
  if (mem.length < 2) return [];
  const key = view.shapes.get(keyBox(mem, keyId)!.id)!;
  const cmds: Command[] = [];
  for (const m of mem) {
    const sh = view.shapes.get(m.id)!;
    if (sh.id === key.id) continue;
    const w = dim !== 'h' ? Math.round(key.w) : sh.w;
    const h = dim !== 'w' && sh.kind !== 'text' ? Math.round(key.h) : sh.h;
    if (w !== sh.w || h !== sh.h) cmds.push({ t: 'shape.resize', id: sh.id, box: { x: sh.x, y: sh.y, w, h } });
  }
  return cmds;
}

/** Equal gaps between consecutive shapes (first and last stay put). Needs 3+ movable shapes. */
export function distributeCommands(view: TreeView, ids: readonly ShapeId[], axis: 'h' | 'v', by: 'gaps' | 'centers' = 'gaps'): Command[] {
  if (distributeBlocked(view, ids)) return [];
  const mem = members(view, ids);
  const h = axis === 'h';
  const pos = (b: Rect) => (h ? b.x : b.y);
  const size = (b: Rect) => (h ? b.w : b.h);
  const sorted = [...mem].sort((a, b) => pos(a.box) + size(a.box) / 2 - (pos(b.box) + size(b.box) / 2));
  const first = sorted[0]!.box, last = sorted[sorted.length - 1]!.box;
  if (by === 'centers') {
    const c0 = pos(first) + size(first) / 2, step = (pos(last) + size(last) / 2 - c0) / (sorted.length - 1);
    const out: Command[] = [];
    for (let i = 1; i < sorted.length - 1; i++) {
      const m = sorted[i]!;
      const d = Math.round(c0 + step * i - (pos(m.box) + size(m.box) / 2));
      if (d !== 0) out.push({ t: 'shape.translate', ids: [m.id], dx: h ? d : 0, dy: h ? 0 : d });
    }
    return out;
  }
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
