// Ephemeral presence bus (MULTI-18). In memory, never touches the DocStore.
// publish() merges into per-actor rows at once; subscribers get ONE batch per flush.
import type { ActorId, Presence, PresenceBus } from '../core/types';

export interface PresenceBusOpts {
  now?: () => number;
  ttlMs?: number;                                  // row expires after this long without a publish (10 s)
  schedule?: (flush: () => void) => void;          // default: requestAnimationFrame if present, else setTimeout 16
}
export interface MemoryPresenceBus extends PresenceBus {
  flush(): void;                                   // deliver pending batch now
  expire(): ActorId[];                             // drop stale rows; returns removed actors
  remove(actor: ActorId): void;                    // instant removal (beforeunload, actor.left)
}

const defaultSchedule = (f: () => void) => {
  const raf = (globalThis as { requestAnimationFrame?: (f: () => void) => number }).requestAnimationFrame;
  if (raf) raf(f); else setTimeout(f, 16);
};

export function createPresenceBus(o: PresenceBusOpts = {}): MemoryPresenceBus {
  const now = o.now ?? Date.now;
  const ttl = o.ttlMs ?? 10_000;
  const schedule = o.schedule ?? defaultSchedule;
  const rows = new Map<ActorId, Presence>();
  const beat = new Map<ActorId, number>();
  const subs = new Set<(all: ReadonlyMap<ActorId, Presence>) => void>();
  let pending = false;

  function flush() {
    if (!pending) return;
    pending = false;
    const snap: ReadonlyMap<ActorId, Presence> = new Map(rows);
    for (const cb of [...subs]) cb(snap);
  }
  function mark() {
    if (pending) return;
    pending = true;
    schedule(flush);
  }
  return {
    publish(p) {
      const t = now();
      const prev = rows.get(p.actor);
      rows.set(p.actor, { ...prev, ...p, lastInputAt: p.lastInputAt ?? prev?.lastInputAt ?? t });
      beat.set(p.actor, t);
      mark();
    },
    get: (a) => rows.get(a),
    subscribe(cb) { subs.add(cb); return () => { subs.delete(cb); }; },
    flush,
    expire() {
      const t = now();
      const gone = [...beat].filter(([, at]) => t - at > ttl).map(([a]) => a);
      for (const a of gone) { rows.delete(a); beat.delete(a); }
      if (gone.length) mark();
      return gone;
    },
    remove(a) { if (rows.delete(a)) { beat.delete(a); mark(); } },
  };
}
