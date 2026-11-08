// Event bus (AGENT-5). Pure TS. Stamps seq + at, filters per subscriber, delivers in seq order.
import type { ActorId, BoardEvent, Filter } from './types';

// Distributive Omit so each event variant keeps its own fields.
type Draft<T> = T extends unknown ? Omit<T, 'seq' | 'at'> & { at?: number } : never;
export type EventDraft = Draft<BoardEvent>;

export interface SubscribeOpts { self?: ActorId } // events made by `self` are skipped (agents opt in by omitting)
export interface EventBus {
  emit(e: EventDraft): BoardEvent;
  subscribe(f: Filter, cb: (e: BoardEvent) => void, o?: SubscribeOpts): () => void;
  seq(): number;
}

export function matches(f: Filter, e: BoardEvent): boolean {
  if (f.actors && !f.actors.includes(e.actor)) return false;
  if (f.kinds && !f.kinds.includes(e.t)) return false;
  if (f.addressedTo) {
    const to = (e as { to?: ActorId[] }).to;
    if (!to || !to.includes(f.addressedTo)) return false;
  }
  if (f.shapeIds) {
    const ids = (e as { ids?: string[] }).ids;
    if (!ids || !ids.some((id) => f.shapeIds!.includes(id))) return false;
  }
  return true;
}

export function createEventBus(now: () => number = Date.now): EventBus {
  let seq = 0;
  const subs = new Set<{ f: Filter; cb: (e: BoardEvent) => void; o?: SubscribeOpts }>();
  const queue: BoardEvent[] = [];
  let draining = false;

  function drain() {
    if (draining) return; // reentrant emit from a handler just queues, so order stays by seq
    draining = true;
    try {
      while (queue.length) {
        const e = queue.shift()!;
        for (const s of [...subs]) {
          if (s.o?.self && e.actor === s.o.self) continue;
          if (!subs.has(s) || !matches(s.f, e)) continue;
          try { s.cb(e); } catch (err) { console.error('event subscriber threw', err); }
        }
      }
    } finally { draining = false; }
  }

  return {
    emit(d) {
      const e = { ...d, seq: ++seq, at: d.at ?? now() } as BoardEvent;
      queue.push(e);
      drain();
      return e;
    },
    subscribe(f, cb, o) {
      const s = { f, cb, o };
      subs.add(s);
      return () => { subs.delete(s); };
    },
    seq: () => seq,
  };
}
