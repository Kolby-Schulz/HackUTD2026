// Claims on frames/shapes/rects (AGENT). STUB: check always allows. Final signatures for the WP-08 gate.
import type { ActorId, Claim, ClaimTarget, ShapeId } from '../core/types';

export type ClaimCheck = { ok: true } | { ok: false; error: 'claimed_by'; holder: ActorId };
export interface Claims {
  /** Gate calls this before a write by `actor` touching `ids`. Humans always win. */
  check(ids: ShapeId[], actor: ActorId): ClaimCheck;
  acquire(holder: ActorId, target: ClaimTarget, o?: { ttlMs?: number; reason?: string }): Claim;
  release(claimId: string): boolean;
  list(): Claim[];
}

export function createClaims(now: () => number = Date.now): Claims {
  const held = new Map<string, Claim>();
  let n = 0;
  return {
    check: () => ({ ok: true }), // stub
    acquire(holder, target, o = {}) {
      const c: Claim = { id: `claim-${++n}`, holder, target, expiresAt: now() + (o.ttlMs ?? 30_000), reason: o.reason };
      held.set(c.id, c);
      return c;
    },
    release: (id) => held.delete(id),
    list: () => [...held.values()],
  };
}
