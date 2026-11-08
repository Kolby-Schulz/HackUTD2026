// The document store (D3): immutable DocState outside React, transactions, gesture frames, change feed.
// No React or DOM here. All document writes arrive via dispatch / begin / applyRemote.
//
// Two states: `committed` (what the op log describes) and `view` (committed + open gestures' transient
// frames; what getState() returns). Transient frames are never logged and never touch `committed`.
import { exportSeqs, newId, opId, restoreSeqs } from './ids';
import { applyOp } from './ops';
import { buildChildren, normalizeShape, PROP_KEYS } from './tree';
import type {
  ActorId, DocState, DocStore, Op, OpEnvelope, SavedBoard, Shape, ShapeId, Stamp, Tx, TxHandle,
} from './types';

const LOG_TAIL = 500;

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

function changedIds(a: DocState, b: DocState): ShapeId[] {
  const out: ShapeId[] = [];
  for (const [id, s] of b.shapes) if (a.shapes.get(id) !== s) out.push(id);
  for (const id of a.shapes.keys()) if (!b.shapes.has(id)) out.push(id);
  return out;
}

/** Net change from `a` to `b` as forward and inverse ops (inverse restores `a`'s values and stamps-free). */
function diff(a: DocState, b: DocState): { forward: Op[]; inverse: Op[] } {
  const creates: Op[] = [], restores: Op[] = [], sets: Op[] = [], places: Op[] = [], removes: Op[] = [];
  const iCreates: Op[] = [], iRestores: Op[] = [], iSets: Op[] = [], iPlaces: Op[] = [], iRemoves: Op[] = [];
  for (const [id, after] of b.shapes) {
    const before = a.shapes.get(id);
    if (before === after) continue;
    if (!before) {
      if (after.deleted) continue; // created and deleted inside one gesture: nothing happened
      const { stamps: _s, deleted: _d, ...rest } = after;
      creates.push({ t: 'create', shape: rest });
      iRemoves.push({ t: 'remove', id });
      continue;
    }
    if (!before.deleted && after.deleted) { removes.push({ t: 'remove', id }); iRestores.push({ t: 'restore', id }); }
    if (before.deleted && !after.deleted) { restores.push({ t: 'restore', id }); iRemoves.push({ t: 'remove', id }); }
    const fwd: Record<string, unknown> = {}, inv: Record<string, unknown> = {};
    for (const k of PROP_KEYS) {
      const x = before[k], y = after[k];
      if (!deepEqual(x, y)) { fwd[k] = y; inv[k] = x; }
    }
    if (Object.keys(fwd).length) {
      sets.push({ t: 'set', id, patch: fwd });
      iSets.push({ t: 'set', id, patch: inv });
    }
    if (before.parent !== after.parent || before.index !== after.index) {
      places.push({ t: 'place', id, parent: after.parent, index: after.index });
      iPlaces.push({ t: 'place', id, parent: before.parent, index: before.index });
    }
  }
  const metaF: Record<string, unknown> = {}, metaI: Record<string, unknown> = {};
  if (a.meta !== b.meta) {
    for (const k of new Set([...Object.keys(a.meta), ...Object.keys(b.meta)])) {
      const x = (a.meta as Record<string, unknown>)[k], y = (b.meta as Record<string, unknown>)[k];
      if (!deepEqual(x, y)) { metaF[k] = y; metaI[k] = x; }
    }
  }
  const board = (p: Record<string, unknown>): Op[] => (Object.keys(p).length ? [{ t: 'board', patch: p }] : []);
  return {
    forward: [...creates, ...restores, ...sets, ...places, ...removes, ...board(metaF)],
    // undo order: bring tombstones back first so later set/place are not dropped, remove last
    inverse: [...iRestores, ...iSets, ...iPlaces, ...iRemoves, ...iCreates, ...board(metaI)],
  };
}

const sameStamp = (a?: Stamp, b?: Stamp) => !!a && !!b && a[0] === b[0] && a[1] === b[1];

/** Every (shape, field) whose stamp differs between `a` and `b`: what a commit wrote. */
function produced(a: DocState, b: DocState): Tx['produced'] {
  const out: Tx['produced'] = [];
  for (const [id, after] of b.shapes) {
    const before = a.shapes.get(id);
    if (before === after) continue;
    for (const [field, stamp] of Object.entries(after.stamps) as [string, Stamp][]) {
      if (!sameStamp(before?.stamps[field as keyof Shape['stamps']], stamp)) out.push({ id, field, stamp });
    }
  }
  return out;
}

function isDev(): boolean {
  return (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV !== false;
}

interface Open { id: string; actor: ActorId; label: string; coalesceKey?: string; ops: Op[]; n: number; done: boolean }

/**
 * Append gesture ops, folding a `set` into the latest earlier `set` on the same shape when nothing else touched
 * that shape in between. A drag or an agent's typing then keeps one set per shape instead of one per frame, so
 * replaying open gestures (on every other actor's commit) stays cheap. Final values are unchanged.
 */
function pushCompact(list: Op[], ops: readonly Op[]) {
  for (const op of ops) {
    if (op.t === 'set') {
      let j = list.length - 1;
      while (j >= 0 && !touches(list[j], op.id)) j--;
      const prev = j >= 0 ? list[j] : undefined;
      if (prev && prev.t === 'set') { list[j] = { t: 'set', id: op.id, patch: { ...prev.patch, ...op.patch } }; continue; }
    }
    list.push(op);
  }
}
function touches(op: Op, id: ShapeId): boolean {
  return op.t === 'create' ? op.shape.id === id : op.t === 'board' ? false : op.id === id;
}

export function createDocStore(opts: { boardId?: string } = {}): DocStore {
  const emptyState = (rev: number, lamport: number): DocState =>
    ({ rev, lamport, shapes: new Map(), children: new Map(), meta: { name: 'Untitled' } });
  let committed: DocState = emptyState(0, 0);
  let view: DocState = committed;
  let clock = 0;
  let log: OpEnvelope[] = [];
  const seen = new Set<string>();
  const open = new Map<ActorId, Open>();

  const listeners = new Set<() => void>();
  const shapeListeners = new Map<ShapeId, Set<() => void>>();
  const changeListeners = new Set<(ids: ShapeId[]) => void>();
  const pending = new Set<ShapeId>();
  let queued = false;

  function schedule(ids: ShapeId[]) {
    for (const id of ids) pending.add(id);
    if (queued) return;
    queued = true;
    queueMicrotask(flush);
  }
  function safe(f: () => void) { try { f(); } catch (e) { console.error('[doc store] listener failed', e); } }
  function flush() {
    queued = false;
    const ids = [...pending];
    pending.clear();
    for (const l of [...listeners]) safe(l);
    for (const id of ids) for (const l of [...(shapeListeners.get(id) ?? [])]) safe(l);
    for (const l of [...changeListeners]) safe(() => l(ids));
  }

  /** Make `next` the visible state if anything observable changed; rev only ever goes up. */
  function setView(next: DocState) {
    const ids = changedIds(view, next);
    if (ids.length === 0 && next.meta === view.meta) return;
    view = next.rev > view.rev ? next : { ...next, rev: view.rev + 1 };
    schedule(ids);
  }

  function tenv(o: Open, body: Op, i: number): OpEnvelope {
    // Transient envelopes outrank everything committed so the gesture is visible; never logged.
    return { opId: `~${o.id}:${i}`, actor: o.actor, lamport: Math.max(clock, committed.lamport) + i + 1, ts: Date.now(), tx: o.id, body };
  }
  function replay(base: DocState, o: Open): DocState {
    let s = base;
    o.ops.forEach((op, i) => { s = applyOp(s, tenv(o, op, i)); });
    return s;
  }
  function recompute() {
    let s = committed;
    for (const o of open.values()) s = replay(s, o);
    setView(s);
  }

  /** Apply ops to `committed` as real, logged envelopes. Returns the new committed state and the envelopes. */
  function envelopes(actor: ActorId, txId: string, ops: Op[]): OpEnvelope[] {
    const ts = Date.now();
    return ops.map((body) => ({ opId: opId(actor), actor, lamport: ++clock, ts, tx: txId, body }));
  }
  function reduce(state: DocState, envs: OpEnvelope[]): DocState {
    let s = state;
    for (const e of envs) s = applyOp(s, e);
    return s;
  }
  function record(envs: OpEnvelope[]) {
    for (const e of envs) { log.push(e); seen.add(e.opId); }
  }

  function finish(actor: ActorId, label: string, txId: string, forward: Op[], inverse: Op[], base: DocState,
    after: DocState, envs: OpEnvelope[], o: { coalesceKey?: string; causedBy?: string }): Tx {
    committed = after;
    record(envs);
    recompute();
    const tx: Tx = { id: txId, actor, label, ops: forward, inverse, produced: produced(base, after), ts: Date.now() };
    if (o.coalesceKey !== undefined) tx.coalesceKey = o.coalesceKey;
    if (o.causedBy !== undefined) tx.causedBy = o.causedBy;
    return tx;
  }

  function dispatch(actor: ActorId, label: string, ops: Op[], o: { coalesceKey?: string; causedBy?: string } = {}): Tx | null {
    if (ops.length === 0) return null;
    const txId = newId('tx');
    const savedClock = clock;
    const envs = envelopes(actor, txId, ops);
    let after: DocState;
    try { after = reduce(committed, envs); } catch (e) { clock = savedClock; throw e; } // all or nothing
    const { inverse } = diff(committed, after);
    if (inverse.length === 0) { clock = savedClock; return null; } // no net change: nothing recorded
    return finish(actor, label, txId, ops, inverse, committed, after, envs, o);
  }

  function begin(actor: ActorId, label: string, o: { coalesceKey?: string } = {}): TxHandle {
    const prev = open.get(actor);
    if (prev) {
      if (isDev()) throw new Error(`begin(${actor}): a transaction is already open ("${prev.label}")`);
      prev.done = true; open.delete(actor); // production: drop the stale gesture rather than wedge the actor
    }
    const t: Open = { id: newId('tx'), actor, label, ops: [], n: 0, done: false };
    if (o.coalesceKey !== undefined) t.coalesceKey = o.coalesceKey;
    open.set(actor, t);
    return {
      apply(ops) {
        if (t.done) throw new Error('transaction already finished');
        if (ops.length === 0) return;
        let next = view;
        // t.n only grows (>= t.ops.length), so each frame's transient stamp beats the previous frame's
        ops.forEach((op) => { next = applyOp(next, tenv(t, op, t.n++)); }); // throws before anything is kept
        pushCompact(t.ops, ops);
        setView(next);
      },
      commit() {
        if (t.done) return null;
        t.done = true; open.delete(actor);
        const base = committed;
        const { forward, inverse } = diff(base, replay(base, t));
        if (forward.length === 0) { recompute(); return null; } // dragged and returned: nothing to record
        const envs = envelopes(actor, t.id, forward);
        const after = reduce(base, envs);
        return finish(actor, label, t.id, forward, inverse, base, after, envs, t.coalesceKey !== undefined ? { coalesceKey: t.coalesceKey } : {});
      },
      abort() {
        if (t.done) return;
        t.done = true; open.delete(actor);
        recompute();
      },
    };
  }

  function applyRemote(envs: OpEnvelope[]) {
    let s = committed;
    for (const e of envs) {
      if (seen.has(e.opId)) continue;
      clock = Math.max(clock, e.lamport);
      s = applyOp(s, e);
      log.push(e); seen.add(e.opId);
    }
    if (s === committed) return;
    committed = s;
    recompute();
  }

  return {
    getState: () => view,
    subscribe(l) { listeners.add(l); return () => { listeners.delete(l); }; },
    subscribeShape(id, l) {
      let set = shapeListeners.get(id);
      if (!set) shapeListeners.set(id, (set = new Set()));
      set.add(l);
      return () => { set!.delete(l); if (set!.size === 0) shapeListeners.delete(id); };
    },
    dispatch, begin, applyRemote,
    log: (from = 0) => log.slice(from),
    onChange(l) { changeListeners.add(l); return () => { changeListeners.delete(l); }; },
    snapshot(): SavedBoard {
      return {
        format: 'contract-board', v: 1, boardId: opts.boardId ?? 'board', meta: committed.meta, savedAt: Date.now(),
        lamport: Math.max(clock, committed.lamport), seq: exportSeqs(), shapes: [...committed.shapes.values()],
        logTail: log.slice(-LOG_TAIL),
      };
    },
    load(b) {
      if (b?.format !== 'contract-board') throw new Error('not a contract-board save');
      const prev = view;
      for (const o of open.values()) o.done = true;
      open.clear();
      const shapes = new Map<ShapeId, Shape>();
      for (const s of b.shapes) shapes.set(s.id, normalizeShape(s));
      restoreSeqs(b.seq ?? {});
      clock = b.lamport;
      log = [...(b.logTail ?? [])];
      seen.clear();
      for (const e of log) seen.add(e.opId);
      committed = { rev: prev.rev + 1, lamport: b.lamport, shapes, children: buildChildren(shapes), meta: b.meta };
      view = committed;
      const ids = new Set<ShapeId>([...prev.shapes.keys(), ...shapes.keys()]);
      schedule([...ids]);
    },
  };
}
