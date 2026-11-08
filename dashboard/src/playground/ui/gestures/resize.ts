// Resize the selection from any of the eight handles. Shift = keep ratio, Alt = from centre,
// Mod = ignore snapping (all read live on every pointer move). The box is recomputed from the
// original box each frame and sent as absolute targets through one board.gesture (one undo entry);
// Escape aborts. Members are scaled as a block; with one parent they work in that parent's space.
import { norm, union } from '../../core/geom';
import { isHandle, resizeBoxFlip, scaleInto } from '../../core/resize';
import type { Handle, ResizeOpts } from '../../core/resize';
import { snapResize, snapResult } from '../../core/snap';
import { resetResizeSnapMemory } from '../../core/snap/resize';
import { absRect, descendants, toLocal } from '../../core/tree';
import type { Command, Gesture, Pt, Rect, ShapeId } from '../../core/types';
import { selectedIds } from '../board/state';
import type { BoardEnv } from '../board/state';
import { modeAfterResize } from '../text/autosize';
import type { Mode, PointerInfo } from './pipeline';

/** Box for dragging `corner` of `orig` to the local point (px, py); the opposite corner is the anchor. */
export function cornerBox(orig: Rect, corner: string, px: number, py: number): Rect {
  const ax = corner.includes('w') ? orig.x + orig.w : orig.x;
  const ay = corner.includes('n') ? orig.y + orig.h : orig.y;
  return norm({ x: ax, y: ay, w: px - ax, h: py - ay });
}

interface Member { id: ShapeId; parent: ShapeId | null; rect: Rect }

export function startResize(env: BoardEnv, p0: PointerInfo): Mode | null {
  const { board } = env;
  const handle: Handle | null = isHandle(p0.handle) ? p0.handle : null;
  if (!handle) return null;
  const st = board.doc.getState();

  // roots of the selection (a selected descendant follows its selected ancestor)
  const picked = selectedIds(board).filter((id) => { const s = st.shapes.get(id); return s && !s.deleted; });
  const pickedSet = new Set(picked);
  const roots = picked.filter((id) => {
    for (let p = st.shapes.get(id)?.parent ?? null; p !== null; p = st.shapes.get(p)?.parent ?? null) if (pickedSet.has(p)) return false;
    return true;
  });
  if (!roots.length) return null;

  const parentOf = (id: ShapeId): ShapeId | null => {
    const p = st.shapes.get(id)!.parent;
    return p !== null && st.shapes.has(p) ? p : null;
  };
  const sameParent = roots.every((id) => parentOf(id) === parentOf(roots[0]));
  const space: ShapeId | null = sameParent ? parentOf(roots[0]) : null;    // null = world (mixed parents or root)
  const members: Member[] = roots.map((id) => {
    const s = st.shapes.get(id)!;
    return { id, parent: parentOf(id), rect: sameParent ? { x: s.x, y: s.y, w: s.w, h: s.h } : absRect(st, id)! };
  });
  const orig = union(members.map((m) => m.rect))!;
  const lock = roots.length === 1 && !!st.shapes.get(roots[0])!.lockRatio;
  const ignore = new Set<ShapeId>();
  for (const id of roots) { ignore.add(id); descendants(st, id).forEach((d) => ignore.add(d)); }

  const compute = (p: PointerInfo) => {
    const pt: Pt = toLocal(st, space, p.world);
    const opts: ResizeOpts = { shift: p.shift, alt: p.alt, lock };
    let res = resizeBoxFlip(orig, handle, pt.x, pt.y, opts);
    if (p.mod) { snapResult.clear(); return res; }
    const z = env.camera.getCam().z;
    const snap = snapResize(res.box, handle, { actor: board.me, ignore, thresholdWorld: 5 / z, parent: space });
    if (snap.dx || snap.dy) res = resizeBoxFlip(orig, handle, pt.x + snap.dx, pt.y + snap.dy, opts);
    snapResult.set(snap);
    return res;
  };

  // text boxes change mode with the handle: width edges -> auto-h, height edges and corners -> fixed (TEXT-4)
  const textModes: Command[] = roots.flatMap((id) => {
    const s = st.shapes.get(id)!;
    if (s.kind !== 'text') return [];
    const mode = modeAfterResize(s.textMode, handle);
    return mode === (s.textMode ?? 'auto-h') ? [] : [{ t: 'shape.update', ids: [id], patch: { textMode: mode } } as Command];
  });

  const commands = (p: PointerInfo): Command[] => [...sizeCommands(p), ...textModes];
  const sizeCommands = (p: PointerInfo): Command[] => {
    const res = compute(p);
    if (members.length === 1 && sameParent) return [{ t: 'shape.resize', id: members[0].id, box: res.box }];
    return members.map((m) => {
      const r = scaleInto(orig, res, m.rect);
      if (sameParent) return { t: 'shape.resize', id: m.id, box: r } as Command;
      const a = toLocal(st, m.parent, { x: r.x, y: r.y });
      const b = toLocal(st, m.parent, { x: r.x + r.w, y: r.y + r.h });
      return { t: 'shape.resize', id: m.id, box: norm({ x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y }) } as Command;
    });
  };

  let g: Gesture | null = null;
  const apply = (p: PointerInfo) => {
    g ??= board.gesture(board.me, roots.length > 1 ? `Resize ${roots.length} layers` : 'Resize');
    g.update(commands(p));
  };
  return {
    move: apply,
    up(p) {
      snapResult.clear();
      if (!g && p.clientX === p0.clientX && p.clientY === p0.clientY) { resetResizeSnapMemory(board.me); return; }   // click on a handle: no change
      apply(p);
      g!.commit();
      resetResizeSnapMemory(board.me);
    },
    cancel() { snapResult.clear(); g?.abort(); resetResizeSnapMemory(board.me); },
  };
}
