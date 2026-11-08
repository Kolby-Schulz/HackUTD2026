// Soft locks (MULTI-8, AGENT-12). `createLocks` is the pure table (TTL expiry); `attachLocks` wires it to a board:
// auto-acquire while an actor's gesture is open or after an agent write, and human takeover (humans always win).
import { isHuman } from '../core/actors';
import type { ActorId, Command, Gesture, LockRecord, ShapeId } from '../core/types';
import type { BoardKit } from '../core/commands';

export const DEFAULT_LOCK_TTL_MS = 4000; // MULTI-7 default for direct acquire()
export const ACTIVITY_LOCK_TTL_MS = 1200; // an agent gesture holds only what it is changing right now
export const IMPLICIT_HOLD_MS = 500;     // AGENT-12: an exec batch holds its shapes for 500 ms after it lands

export type LockCheck = { ok: true } | { ok: false; error: 'locked'; holder: ActorId; retryAfterMs?: number };
export interface Locks {
  /** Gate calls this before a write by `actor` touching `ids`. Humans always win. */
  check(ids: ShapeId[], actor: ActorId): LockCheck;
  acquire(shapeId: ShapeId, holder: ActorId, ttlMs?: number): LockRecord;
  release(shapeId: ShapeId, holder: ActorId): void;
  list(): LockRecord[];
}

export function createLocks(now: () => number = Date.now): Locks {
  const held = new Map<ShapeId, LockRecord>();
  const live = (r: LockRecord) => now() < r.since + r.ttlMs;
  const get = (id: ShapeId) => {
    const r = held.get(id);
    if (r && !live(r)) { held.delete(id); return undefined; } // expired: the holder stopped
    return r;
  };
  return {
    check(ids, actor) {
      if (isHuman(actor)) return { ok: true };
      for (const id of ids) {
        const r = get(id);
        if (r && r.holder !== actor) return { ok: false, error: 'locked', holder: r.holder, retryAfterMs: r.since + r.ttlMs - now() };
      }
      return { ok: true };
    },
    acquire(shapeId, holder, ttlMs = DEFAULT_LOCK_TTL_MS) {
      const r = { shapeId, holder, since: now(), ttlMs };
      held.set(shapeId, r);
      return r;
    },
    release(shapeId, holder) { if (get(shapeId)?.holder === holder) held.delete(shapeId); },
    list() { return [...held.keys()].map(get).filter((r): r is LockRecord => !!r); },
  };
}

/** Shape ids a command list touches directly (placeholders like `$0` are new shapes, never locked). */
export function commandIds(cmds: Command[]): ShapeId[] {
  const out = new Set<ShapeId>();
  const add = (r: unknown) => { if (typeof r === 'string' && !r.startsWith('$')) out.add(r); };
  for (const c of cmds) {
    const x = c as { ids?: unknown[]; id?: unknown };
    x.ids?.forEach(add);
    add(x.id);
  }
  return [...out];
}

/** Stable per-id serialization of the commands touching each id (new ids differ from "no previous"). */
function commandSigs(cmds: Command[]): Map<ShapeId, string> {
  const out = new Map<ShapeId, string>();
  cmds.forEach((c, i) => {
    const ids = commandIds([c]);
    if (!ids.length) return;
    // placeholders ($n) resolve by position, so include the index only for them
    const sig = JSON.stringify(c);
    for (const id of ids) out.set(id, (out.get(id) ?? '') + '|' + sig + (sig.includes('"$') ? '@' + i : ''));
  });
  return out;
}

export interface AttachOpts {
  ttlMs?: number;
  /** Called on a human takeover with the toast text, e.g. "You took over from Iris". */
  toast?: (text: string) => void;
}
export interface LocksHandle {
  /** The lock-aware gesture (also installed as `board.gesture`). */
  gesture: BoardKit['gesture'];
  /** Revoke every other actor's lock on `ids`; emits `lock.revoked`. Returns the holders revoked. */
  takeover(ids: ShapeId[], by: ActorId): ActorId[];
  detach(): void;
}

/**
 * Wires the board's locks to its events and gestures. Replaces `board.gesture` with a lock-aware one:
 * - every gesture update acquires/refreshes locks on the shapes it touches (agents and humans);
 * - a human gesture or write on shapes an agent holds revokes that lock (emits `lock.revoked`, aborts the
 *   agent's open gesture after committing its work so far, so nothing vanishes and the human's edit lands on top);
 * - an agent write that lands holds its shapes for 500 ms more.
 */
export function attachLocks(board: BoardKit, o: AttachOpts = {}): LocksHandle {
  const { locks, events, actors } = board;
  const ttl = o.ttlMs ?? ACTIVITY_LOCK_TTL_MS;
  const rawGesture = board.gesture.bind(board);
  const live = new Set<{ actor: ActorId; ids: Set<ShapeId>; kill(): void }>();

  function takeover(ids: ShapeId[], by: ActorId): ActorId[] {
    const byHolder = new Map<ActorId, ShapeId[]>();
    for (const id of ids) {
      const r = locks.list().find((l) => l.shapeId === id);
      if (!r || r.holder === by) continue;
      if (isHuman(r.holder) && !isHuman(by)) continue; // agents never win against humans
      locks.release(id, r.holder);
      byHolder.set(r.holder, [...(byHolder.get(r.holder) ?? []), id]);
    }
    // Humans win even after an agent's short activity lock lapsed: an open agent gesture that touched these shapes
    // would otherwise commit over the human's edit later, so it is taken over too.
    if (isHuman(by)) {
      for (const g of live) {
        if (isHuman(g.actor) || g.actor === by) continue;
        const hit = ids.filter((id) => g.ids.has(id) && !(byHolder.get(g.actor) ?? []).includes(id));
        if (hit.length) byHolder.set(g.actor, [...(byHolder.get(g.actor) ?? []), ...hit]);
      }
    }
    for (const [holder, hit] of byHolder) {
      for (const g of [...live]) if (g.actor === holder && hit.some((id) => g.ids.has(id))) g.kill();
      // `holder` rides along so the revoked agent can tell it was the one (BoardEvent's variant only types ids + by)
      events.emit({ t: 'lock.revoked', actor: by, ids: hit, by, holder } as Parameters<typeof events.emit>[0]);
      if (isHuman(by) && !isHuman(holder)) o.toast?.(`You took over from ${actors.get(holder)?.name ?? holder}`);
    }
    return [...byHolder.keys()];
  }

  const unsub = events.subscribe({ kinds: ['shape.created', 'shape.updated', 'shape.deleted'] }, (e) => {
    const ids = (e as { ids: ShapeId[] }).ids;
    if (isHuman(e.actor)) takeover(ids, e.actor);
    else for (const id of ids) locks.acquire(id, e.actor, IMPLICIT_HOLD_MS);
  });

  board.gesture = (actor, label, opts) => {
    const inner = rawGesture(actor, label, opts);
    const mine = new Set<ShapeId>();
    let revoked = false, done = false;
    const prev = new Map<ShapeId, string>(); // per-id command serialization of the previous frame
    // A takeover keeps what the agent drew so far (commit, not abort): shapes it created inside this gesture exist only
    // here, so aborting would make them vanish under the human's cursor. The human's open gesture replays on top.
    const entry = { actor, ids: mine, kill() { revoked = true; finish(); inner.commit(); } };
    const finish = () => { done = true; live.delete(entry); };
    live.add(entry);
    const g: Gesture = {
      update(cmds) {
        if (revoked || done) return; // revoked: the human's version stays; the agent re-plans
        const ids = commandIds(cmds);
        if (isHuman(actor)) takeover(ids, actor);
        else if (!locks.check(ids, actor).ok) { inner.update(cmds); return; } // gate reports `locked` per command
        // A scripted build re-plans the whole list each frame: only ids whose command changed are "being edited".
        const cur = commandSigs(cmds);
        for (const id of ids) {
          mine.add(id);
          if (isHuman(actor) || prev.get(id) !== cur.get(id)) locks.acquire(id, actor, ttl);
        }
        prev.clear(); cur.forEach((v, k) => prev.set(k, v));
        inner.update(cmds);
      },
      commit() {
        if (revoked) return { ok: false, seq: board.events.seq(), results: [{ ok: false, error: 'locked', message: 'lock revoked by a human takeover' }] };
        finish();
        const r = inner.commit();
        for (const id of mine) isHuman(actor) ? locks.release(id, actor) : locks.acquire(id, actor, IMPLICIT_HOLD_MS);
        return r;
      },
      abort() {
        if (revoked) return;
        finish(); inner.abort();
        for (const id of mine) locks.release(id, actor);
      },
    };
    return g;
  };

  return {
    gesture: board.gesture, takeover,
    detach() { unsub(); board.gesture = rawGesture; },
  };
}
