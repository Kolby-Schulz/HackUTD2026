// Soft locks (MULTI). STUB: check always allows. Final signatures for the WP-08 gate.
import type { ActorId, LockRecord, ShapeId } from '../core/types';

export type LockCheck = { ok: true } | { ok: false; error: 'locked'; holder: ActorId };
export interface Locks {
  /** Gate calls this before a write by `actor` touching `ids`. Humans always win. */
  check(ids: ShapeId[], actor: ActorId): LockCheck;
  acquire(shapeId: ShapeId, holder: ActorId, ttlMs?: number): LockRecord;
  release(shapeId: ShapeId, holder: ActorId): void;
  list(): LockRecord[];
}

export function createLocks(now: () => number = Date.now): Locks {
  const held = new Map<ShapeId, LockRecord>();
  return {
    check: () => ({ ok: true }), // stub
    acquire(shapeId, holder, ttlMs = 5000) {
      const r = { shapeId, holder, since: now(), ttlMs };
      held.set(shapeId, r);
      return r;
    },
    release(shapeId, holder) { if (held.get(shapeId)?.holder === holder) held.delete(shapeId); },
    list: () => [...held.values()],
  };
}
