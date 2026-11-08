// Per-actor selection (SELECT-1). Presence-like: not in the DocStore, never undoable.
// ids are ordered, last = primary. scope = container the actor is "inside" (null = root).
import type { ActorId, ShapeId } from '../core/types';

export interface SelectionState { ids: ShapeId[]; scope: ShapeId | null }
export interface SelectionStore {
  get(actor: ActorId): SelectionState;
  set(actor: ActorId, ids: ShapeId[], scope?: ShapeId | null): void;
  clear(actor: ActorId): void;
  /** Drop ids that no longer exist (deleted by someone else). Returns actors whose selection changed. */
  prune(exists: (id: ShapeId) => boolean): ActorId[];
  subscribe(cb: (actor: ActorId, s: SelectionState) => void): () => void;
}

const EMPTY: SelectionState = { ids: [], scope: null };
const same = (a: SelectionState, b: SelectionState) =>
  a.scope === b.scope && a.ids.length === b.ids.length && a.ids.every((id, i) => id === b.ids[i]);

export function createSelectionStore(): SelectionStore {
  const sels = new Map<ActorId, SelectionState>();
  const subs = new Set<(actor: ActorId, s: SelectionState) => void>();
  function put(actor: ActorId, next: SelectionState): boolean {
    const prev = sels.get(actor) ?? EMPTY;
    if (same(prev, next)) return false;
    sels.set(actor, next);
    subs.forEach((cb) => cb(actor, next));
    return true;
  }
  return {
    get: (a) => sels.get(a) ?? EMPTY,
    set(a, ids, scope) {
      const prev = sels.get(a) ?? EMPTY;
      put(a, { ids: [...new Set(ids)], scope: scope === undefined ? prev.scope : scope });
    },
    clear(a) { put(a, { ids: [], scope: sels.get(a)?.scope ?? null }); },
    prune(exists) {
      const changed: ActorId[] = [];
      for (const [a, s] of [...sels]) {
        const ids = s.ids.filter(exists);
        const scope = s.scope && !exists(s.scope) ? null : s.scope;
        if (put(a, { ids, scope })) changed.push(a);
      }
      return changed;
    },
    subscribe(cb) { subs.add(cb); return () => { subs.delete(cb); }; },
  };
}
