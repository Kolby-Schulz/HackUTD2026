// Per-actor undo and redo (HISTORY-10, 11, 12, 8, 13, 14, 15; AGENT-24). No React or DOM.
//
// Undo never rewinds the log: it dispatches the entry's inverse as a NEW tx attributed to the undoing actor.
// A field is written only if its current stamp is still the one the original tx produced (nobody wrote it
// since); otherwise it is skipped and reported with the actor who superseded it.
// Redo is the same machinery one step later: the entry pushed onto redo is the undo tx the store returned, so
// redo dispatches ITS inverse (a `restore` rather than a replayed `create`, which would be a no-op on a tombstone).
import { between } from './order';
import type { ActorId, DocState, DocStore, Op, Shape, ShapeId, ShapeProps, Stamp, Tx } from './types';

export interface UndoSkip { id: ShapeId; field: string; by: ActorId }
export interface UndoOutcome { ok: boolean; tx: Tx | null; skipped: UndoSkip[] }
export interface UndoManager {
  record(tx: Tx): void;
  undo(actor: ActorId): UndoOutcome;
  redo(actor: ActorId): UndoOutcome;
  revert(by: ActorId, txId: string): UndoOutcome;
  canUndo(actor: ActorId): boolean;
  canRedo(actor: ActorId): boolean;
  forget(actor: ActorId): void;
  // ---- additions (WP-77) ----
  /** Label of the entry the next undo / redo of `actor` would act on, or null. */
  nextLabel(actor: ActorId, which: 'undo' | 'redo'): string | null;
  /** Called after any stack change or undo / redo / revert / reapply attempt (read `last()` for what happened). */
  subscribe(cb: () => void): () => void;
  /** The most recent undo / redo / revert / reapply attempt, including failed ones that skipped fields. */
  last(): UndoEvent | null;
  /** Revert several txs, newest first, each with the skip rule. ok if any applied; skipped is the union. */
  revertMany(by: ActorId, txIds: string[]): UndoOutcome;
  /** Was `txId` (original or revert tx id) reverted and not yet re-applied? */
  canReapply(txId: string): boolean;
  /** Re-apply a reverted tx (the inverse of the revert, same skip filter). Never touches `by`'s own stacks. */
  reapply(by: ActorId, txId: string): UndoOutcome;
}

export interface UndoEvent {
  n: number; kind: 'undo' | 'redo' | 'revert' | 'reapply'; actor: ActorId;
  /** Label of the original tx (without the verb). */ label: string;
  /** Actor that owned the original tx (differs from `actor` for revert / reapply). */ owner: ActorId;
  /** Id of the original tx, usable with `reapply` after a revert. */ txId: string; outcome: UndoOutcome;
}

interface Entry { tx: Tx; ids: Set<string>; at: number }
interface Stacks { undo: Entry[]; redo: Entry[] }

const EMPTY: UndoOutcome = { ok: false, tx: null, skipped: [] };
const rank = (op: Op) => (op.t === 'restore' ? 0 : op.t === 'set' ? 1 : op.t === 'place' ? 2 : op.t === 'remove' ? 3 : 4);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** Undo / redo txs are labelled "Undo X" / "Redo X"; the user-facing name is X. */
const baseLabel = (l: string) => l.replace(/^((Undo|Redo) )+/, '');
const stampEq = (a?: Stamp, b?: Stamp) => !!a && !!b && a[0] === b[0] && a[1] === b[1];

export function createUndo(store: DocStore, o: { now?: () => number; cap?: number; coalesceMs?: number } = {}): UndoManager {
  const now = o.now ?? Date.now;
  const cap = o.cap ?? 200;
  const coalesceMs = o.coalesceMs ?? 1000;
  const stacks = new Map<ActorId, Stacks>();
  // Reverted entries waiting for a possible reapply: `entry` is the revert tx, so applying its inverse re-does the work.
  const reverted: { owner: ActorId; ids: Set<string>; entry: Entry; label: string }[] = [];
  const subs = new Set<() => void>();
  let lastEvent: UndoEvent | null = null;
  let n = 0;
  const notify = () => subs.forEach((f) => f());
  const announce = (kind: UndoEvent['kind'], actor: ActorId, e: Entry, owner: ActorId, outcome: UndoOutcome) => {
    lastEvent = { n: ++n, kind, actor, label: baseLabel(e.tx.label), owner, txId: e.tx.id, outcome };
    notify();
  };

  const of = (a: ActorId): Stacks => {
    let s = stacks.get(a);
    if (!s) { s = { undo: [], redo: [] }; stacks.set(a, s); }
    return s;
  };
  const push = (list: Entry[], e: Entry) => { list.push(e); while (list.length > cap) list.shift(); };

  /**
   * May `b` merge into `a`? Only if nobody else wrote in between: what b overwrote (its inverse values) must be what
   * a wrote, and any field a wrote that b did not touch must still carry a's stamp.
   */
  function mergeable(a: Tx, b: Tx): boolean {
    const shapes = store.getState().shapes;
    const wrote = new Map<string, unknown>();
    for (const op of a.ops) if (op.t === 'set') for (const k of Object.keys(op.patch)) wrote.set(`${op.id}\0${k}`, (op.patch as Record<string, unknown>)[k]);
    const touched = new Set<string>();
    for (const op of b.inverse) {
      if (op.t !== 'set') continue;
      for (const k of Object.keys(op.patch)) {
        const key = `${op.id}\0${k}`;
        touched.add(key);
        if (wrote.has(key) && !same(wrote.get(key), (op.patch as Record<string, unknown>)[k])) return false;
      }
    }
    return a.produced.every((p) => touched.has(`${p.id}\0${p.field}`)
      || stampEq(shapes.get(p.id)?.stamps[p.field as keyof Shape['stamps']], p.stamp));
  }

  /** Merge `b` (newer) into `a`: first inverse wins, latest forward ops and stamps win. */
  function merge(a: Tx, b: Tx): Tx {
    const inverse: Op[] = a.inverse.map((op) => (op.t === 'set' ? { ...op, patch: { ...op.patch } } : op));
    for (const op of b.inverse) {
      if (op.t === 'set') {
        const mine = inverse.find((x) => x.t === 'set' && x.id === op.id);
        if (mine && mine.t === 'set') {
          for (const k of Object.keys(op.patch) as (keyof ShapeProps)[]) if (!(k in mine.patch)) (mine.patch as Record<string, unknown>)[k] = op.patch[k];
          continue;
        }
      } else if (inverse.some((x) => same(x, op))) continue;
      inverse.push(op);
    }
    inverse.sort((x, y) => rank(x) - rank(y)); // stable
    const produced = new Map<string, Tx['produced'][number]>();
    for (const p of [...a.produced, ...b.produced]) produced.set(`${p.id}\0${p.field}`, p);
    const out: Tx = { ...a, ops: b.ops, inverse, produced: [...produced.values()], ts: b.ts };
    if (b.sel && a.sel) out.sel = { before: a.sel.before, after: b.sel.after };
    return out;
  }

  /** Keep only the inverse writes nobody has superseded. Foreign children of removed shapes are reparented. */
  function filter(tx: Tx): { ops: Op[]; skipped: UndoSkip[] } {
    const st = store.getState();
    const prod = new Map<string, Stamp>();
    for (const p of tx.produced) prod.set(`${p.id}\0${p.field}`, p.stamp);
    const skipped: UndoSkip[] = [];
    const ops: Op[] = [];
    const restoring = new Set<ShapeId>();
    const removing = new Set<ShapeId>();
    const skip = (id: ShapeId, field: string, cur?: Stamp) => skipped.push({ id, field, by: cur ? cur[1] : tx.actor });
    // current: is the field still the one this tx wrote? (no recorded stamp => nothing to compare, allow)
    const current = (s: Shape, field: keyof Shape['stamps']): boolean => {
      const want = prod.get(`${s.id}\0${field}`);
      return !want || stampEq(s.stamps[field], want);
    };

    for (const op of tx.inverse) {
      if (op.t === 'board' || op.t === 'create') { ops.push(op); continue; }
      const s = st.shapes.get(op.id);
      if (!s) continue; // gone entirely: harmless no-op
      if (op.t === 'restore') {
        if (current(s, 'deleted')) { ops.push(op); restoring.add(op.id); } else skip(op.id, 'deleted', s.stamps.deleted);
      } else if (op.t === 'remove') {
        if (current(s, 'deleted')) { ops.push(op); removing.add(op.id); } else skip(op.id, 'deleted', s.stamps.deleted);
      } else if (op.t === 'place') {
        if (s.deleted && !restoring.has(op.id)) { skip(op.id, 'deleted', s.stamps.deleted); continue; }
        if (current(s, 'place')) ops.push(op); else skip(op.id, 'place', s.stamps.place);
      } else {
        if (s.deleted && !restoring.has(op.id)) { skip(op.id, 'deleted', s.stamps.deleted); continue; }
        const patch: Record<string, unknown> = {};
        for (const k of Object.keys(op.patch) as (keyof ShapeProps)[]) {
          if (current(s, k)) patch[k] = op.patch[k]; else skip(op.id, k, s.stamps[k]);
        }
        if (Object.keys(patch).length) ops.push({ t: 'set', id: op.id, patch: patch as Partial<ShapeProps> });
      }
    }

    // Removing shapes (undo of create): do not delete other actors' work inside them; lift it out first.
    if (removing.size) {
      const lift: Op[] = [];
      for (const c of st.shapes.values()) {
        if (c.deleted || c.parent === null || !removing.has(c.parent) || removing.has(c.id)) continue;
        let dx = 0, dy = 0, p: Shape | undefined = st.shapes.get(c.parent);
        let anchor: Shape | undefined = p;
        while (p && removing.has(p.id)) {
          dx += p.x; dy += p.y; anchor = p;
          p = p.parent !== null ? st.shapes.get(p.parent) : undefined;
        }
        const target = p && !p.deleted ? p.id : null;
        const sibs = (st.children.get(target) ?? []).map((id) => st.shapes.get(id)!).filter((x) => x && !removing.has(x.id));
        const after = anchor ? anchor.index : undefined;
        const next = sibs.find((x) => after !== undefined && x.index > after);
        lift.push({ t: 'place', id: c.id, parent: target, index: between(after ?? sibs[sibs.length - 1]?.index, next?.index) });
        if (dx || dy) lift.push({ t: 'set', id: c.id, patch: { x: c.x + dx, y: c.y + dy } });
      }
      if (lift.length) {
        const at = ops.findIndex((x) => x.t === 'remove');
        ops.splice(at < 0 ? ops.length : at, 0, ...lift);
      }
    }
    return { ops, skipped };
  }

  /** Dispatch the filtered inverse of `e` as `actor`. Returns the outcome; the caller decides about stacks. */
  function apply(actor: ActorId, e: Entry, verb: string): UndoOutcome {
    const { ops, skipped } = filter(e.tx);
    if (ops.length === 0) return { ok: false, tx: null, skipped };
    const tx = store.dispatch(actor, `${verb} ${e.tx.label}`, ops, { causedBy: e.tx.id });
    if (!tx) return { ok: false, tx: null, skipped };
    if (e.tx.sel) { // undo reselects `before`, the reverse of what the original did; drop vanished shapes
      const shapes = store.getState().shapes;
      const live = (ids: ShapeId[]) => ids.filter((id) => { const s = shapes.get(id); return s && !s.deleted; });
      tx.sel = { before: live(e.tx.sel.after), after: live(e.tx.sel.before) };
    }
    return { ok: true, tx, skipped };
  }

  const entryOf = (tx: Tx): Entry => ({ tx, ids: new Set([tx.id]), at: now() });

  const api: UndoManager = {
    record(tx) {
      const s = of(tx.actor);
      s.redo.length = 0;
      const top = s.undo[s.undo.length - 1];
      const t = now();
      if (top && tx.coalesceKey !== undefined && top.tx.coalesceKey === tx.coalesceKey
        && t - top.at <= coalesceMs && mergeable(top.tx, tx)) {
        top.tx = merge(top.tx, tx);
        top.ids.add(tx.id);
        top.at = t;
        notify();
        return;
      }
      push(s.undo, { tx, ids: new Set([tx.id]), at: t });
      notify();
    },

    undo(actor) {
      const s = of(actor);
      const e = s.undo.pop();
      if (!e) return EMPTY;
      const r = apply(actor, e, 'Undo');
      if (r.tx) push(s.redo, entryOf(r.tx));
      announce('undo', actor, e, actor, r);
      return r;
    },

    redo(actor) {
      const s = of(actor);
      const e = s.redo.pop();
      if (!e) return EMPTY;
      const r = apply(actor, e, 'Redo');
      if (r.tx) push(s.undo, entryOf(r.tx));
      announce('redo', actor, e, actor, r);
      return r;
    },

    revert(by, txId) {
      for (const [owner, s] of stacks) {
        const i = s.undo.findIndex((e) => e.ids.has(txId));
        if (i < 0) continue;
        const [e] = s.undo.splice(i, 1);
        const r = apply(by, e, 'Undo');
        if (r.tx) { // remember it so the revert can be taken back; redo stays empty on purpose
          reverted.push({ owner, ids: new Set([...e.ids, r.tx.id]), entry: entryOf(r.tx), label: e.tx.label });
          while (reverted.length > cap) reverted.shift();
        }
        announce('revert', by, e, owner, r);
        return r;
      }
      return EMPTY;
    },

    revertMany(by, txIds) {
      const find = (id: string) => { for (const s of stacks.values()) { const e = s.undo.find((x) => x.ids.has(id)); if (e) return e; } };
      const order = txIds.map((id, i) => ({ id, i, ts: find(id)?.tx.ts ?? -1 })).sort((a, b) => b.ts - a.ts || b.i - a.i).map((x) => x.id);
      const out: UndoOutcome = { ok: false, tx: null, skipped: [] };
      order.forEach((id, k) => {
        const r = api.revert(by, id);
        if (r.ok) { out.ok = true; out.tx = r.tx; }
        out.skipped.push(...r.skipped);
        if (!r.tx) return;
        // Our own revert re-stamped those fields. Older entries of this batch must not see that as someone else's edit.
        const fresh = new Map(r.tx.produced.map((p) => [`${p.id}\0${p.field}`, p.stamp] as const));
        for (const later of order.slice(k + 1)) {
          const e = find(later);
          if (e) e.tx = { ...e.tx, produced: e.tx.produced.map((p) => ({ ...p, stamp: fresh.get(`${p.id}\0${p.field}`) ?? p.stamp })) };
        }
      });
      return out;
    },

    canReapply: (txId) => reverted.some((r) => r.ids.has(txId)),

    reapply(by, txId) {
      const i = reverted.findIndex((r) => r.ids.has(txId));
      if (i < 0) return EMPTY;
      const [rec] = reverted.splice(i, 1);
      const r = apply(by, rec.entry, 'Redo');
      // The re-applied work goes back on its owner's undo stack so it can be reverted again.
      if (r.tx) push(of(rec.owner).undo, { tx: r.tx, ids: new Set([...rec.ids, r.tx.id]), at: now() });
      announce('reapply', by, { ...rec.entry, tx: { ...rec.entry.tx, label: rec.label } }, rec.owner, r);
      return r;
    },

    nextLabel(actor, which) {
      const list = stacks.get(actor)?.[which];
      return list && list.length ? baseLabel(list[list.length - 1].tx.label) : null;
    },
    subscribe(cb) { subs.add(cb); return () => { subs.delete(cb); }; },
    last: () => lastEvent,

    canUndo: (a) => (stacks.get(a)?.undo.length ?? 0) > 0,
    canRedo: (a) => (stacks.get(a)?.redo.length ?? 0) > 0,
    forget(a) { stacks.delete(a); notify(); },
  };
  return api;
}

export type { DocState };
