// The gate (AGENT-1, AGENT-3): one place that decides whether an actor may run a command on some shapes.
// Composes actor capabilities + soft locks + claims. Humans win: a human is never stopped by a lock or claim.
// Frozen after WP-08: change only through the orchestrator.
import { DEFAULT_CAPS, actorKind, isHuman } from './actors';
import type { ActorId, ActorRegistry, Cap, Result, ShapeId } from './types';
import type { Claims } from '../presence/claims';
import type { Locks } from '../presence/locks';

export type Denied = Extract<Result, { ok: false }>;
export interface Gate {
  /** True when `actor` holds `cap` (registered actors by their caps, unregistered `kind-short` ids by kind defaults). */
  can(actor: ActorId, cap: Cap): boolean;
  /** Null when allowed; otherwise the failed Result (`forbidden`, `locked` or `claimed_by`). */
  check(actor: ActorId, cap: Cap, ids: readonly ShapeId[]): Denied | null;
}

export function createGate(d: { actors: ActorRegistry; locks: Locks; claims: Claims }): Gate {
  const can = (actor: ActorId, cap: Cap): boolean => {
    const a = d.actors.get(actor);
    if (a) return a.caps.includes(cap);
    const kind = actorKind(actor);
    return kind !== undefined && DEFAULT_CAPS[kind].includes(cap);
  };
  return {
    can,
    check(actor, cap, ids) {
      if (!can(actor, cap)) return { ok: false, error: 'forbidden', message: `${actor} lacks the "${cap}" capability` };
      if (isHuman(actor) || ids.length === 0) return null;
      // read through d.locks / d.claims on every call so a replaced `check` takes effect
      const lock = d.locks.check([...ids], actor);
      if (!lock.ok) return { ok: false, error: 'locked', holder: lock.holder, message: `locked by ${lock.holder}` };
      const claim = d.claims.check([...ids], actor);
      if (!claim.ok) return { ok: false, error: 'claimed_by', holder: claim.holder, message: `claimed by ${claim.holder}` };
      return null;
    },
  };
}
