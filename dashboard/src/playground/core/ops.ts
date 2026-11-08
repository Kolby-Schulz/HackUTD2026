// Pure op application (HISTORY-35, HISTORY-36, AGENT-2).
// applyOp(state, env) never mutates state and returns the SAME object when the envelope changes nothing.
//
// Idempotency has no seen-set here: it falls out of the per-field stamps. A field is written only if the
// envelope's stamp [lamport, actor] is strictly greater than the stored one, so replaying an envelope
// (equal stamp) is a no-op. The store's opId seen-set is an extra fast path, not needed for correctness.
//
// Tombstones: remove/restore share one LWW register, stamps.deleted (newest wins; the stamp is recorded even when
// visibility does not change, so a late older remove cannot delete again). `set`/`place` on a tombstone are
// dropped (delete wins). Known gap: remove -> set(newer) -> restore diverges by arrival order.
import { normalizeShape, PROP_KEYS, wouldCycle } from './tree';
import { compareSiblings } from './order';
import type { BoardMeta, DocState, OpEnvelope, Shape, ShapeId, ShapeProps, Stamp } from './types';

type StampKey = keyof Shape['stamps'];

/** True when stamp a is strictly newer than b (lamport, then actor id). A missing b always loses. */
export function stampGt(a: Stamp, b: Stamp | undefined): boolean {
  if (!b) return true;
  return a[0] !== b[0] ? a[0] > b[0] : a[1] > b[1];
}

/** Children index: effective parent (missing or tombstoned parent counts as root), tombstones left out. */
export function childrenOf(shapes: ReadonlyMap<ShapeId, Shape>): Map<ShapeId | null, ShapeId[]> {
  const groups = new Map<ShapeId | null, Shape[]>();
  for (const s of shapes.values()) {
    if (s.deleted) continue;
    const p = s.parent !== null ? shapes.get(s.parent) : undefined;
    const parent = p && !p.deleted ? p.id : null;
    const list = groups.get(parent);
    if (list) list.push(s); else groups.set(parent, [s]);
  }
  const out = new Map<ShapeId | null, ShapeId[]>();
  for (const [parent, list] of groups) out.set(parent, list.sort(compareSiblings).map((s) => s.id));
  return out;
}

/** New state with a replaced shape map: bumps rev, raises lamport, rebuilds children when the tree changed. */
function commit(state: DocState, env: OpEnvelope, shapes: Map<ShapeId, Shape>, structural: boolean): DocState {
  return {
    ...state,
    rev: state.rev + 1,
    lamport: Math.max(state.lamport, env.lamport),
    shapes,
    children: structural ? childrenOf(shapes) : state.children,
  };
}

/** The requested parent, or root if it would make a cycle. A missing or deleted parent is kept as written and
 *  resolved by childrenOf (child shows at root), so the result does not depend on arrival order. */
function usableParent(state: DocState, id: ShapeId, parent: ShapeId | null): ShapeId | null {
  return wouldCycle(state, id, parent) ? null : parent;
}

function sameValue(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

export function applyOp(state: DocState, env: OpEnvelope): DocState {
  const stamp: Stamp = [env.lamport, env.actor];
  const op = env.body;

  switch (op.t) {
    case 'create': {
      if (state.shapes.has(op.shape.id)) return state; // idempotent; also true for tombstoned ids
      const rec = normalizeShape({ ...op.shape });
      const stamps: Shape['stamps'] = { place: stamp };
      for (const k of PROP_KEYS) if (rec[k] !== undefined) stamps[k] = stamp;
      const shape: Shape = { ...rec, parent: usableParent(state, rec.id, rec.parent), stamps };
      delete shape.deleted;
      const shapes = new Map(state.shapes);
      shapes.set(shape.id, shape);
      return commit(state, env, shapes, true);
    }

    case 'set': {
      const cur = state.shapes.get(op.id);
      if (!cur || cur.deleted) return state; // unknown id or tombstone: patch dropped
      let next: Record<string, any> | null = null;
      let stamps: Shape['stamps'] | null = null;
      for (const key of Object.keys(op.patch) as (keyof ShapeProps)[]) {
        if (!PROP_KEYS.includes(key)) continue;
        if (!stampGt(stamp, cur.stamps[key])) continue;
        const value = op.patch[key];
        next ??= { ...cur };
        stamps ??= { ...cur.stamps };
        if (value === undefined) delete next[key]; else next[key] = value;
        stamps[key] = stamp;
      }
      if (!next || !stamps) return state;
      next.stamps = stamps;
      const shapes = new Map(state.shapes);
      shapes.set(op.id, next as Shape);
      return commit(state, env, shapes, false);
    }

    case 'place': {
      const cur = state.shapes.get(op.id);
      if (!cur || cur.deleted) return state;
      if (!stampGt(stamp, cur.stamps.place)) return state;
      const parent = usableParent(state, op.id, op.parent);
      const shapes = new Map(state.shapes);
      shapes.set(op.id, { ...cur, parent, index: op.index, stamps: { ...cur.stamps, place: stamp } });
      return commit(state, env, shapes, true);
    }

    case 'remove':
    case 'restore': {
      // One LWW register: stamps.deleted holds the newest remove/restore. Recording the stamp even when the
      // visible state does not change makes remove/restore arrival order irrelevant.
      const cur = state.shapes.get(op.id);
      if (!cur || !stampGt(stamp, cur.stamps.deleted)) return state;
      const stamps = { ...cur.stamps, deleted: stamp };
      const shapes = new Map(state.shapes);
      if (op.t === 'remove') shapes.set(op.id, { ...cur, deleted: true, stamps });
      else { const { deleted: _gone, ...rest } = cur; shapes.set(op.id, { ...rest, stamps } as Shape); }
      return commit(state, env, shapes, !!cur.deleted !== (op.t === 'remove'));
    }

    case 'board': {
      // BoardMeta has no stamps in DocState, so board patches apply in arrival order.
      let meta: BoardMeta | null = null;
      for (const key of Object.keys(op.patch) as (keyof BoardMeta)[]) {
        if (sameValue(state.meta[key], op.patch[key])) continue;
        meta ??= { ...state.meta };
        (meta as any)[key] = op.patch[key];
      }
      if (!meta) return state;
      return { ...state, rev: state.rev + 1, lamport: Math.max(state.lamport, env.lamport), meta };
    }
  }
}
