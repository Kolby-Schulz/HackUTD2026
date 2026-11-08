// Claims on frames, shapes and world rects (AGENT-11, AGENT-13). A claim says "this region is mine for the next minutes".
// `createClaims` is the pure table (TTL, auto-extend, descendants, contention). `attachClaims` wires it to a board:
// document lookups for descendants, events (claim.granted/denied/released, conflict.opened), human toast, stopped agents.
// Humans are never blocked: `check` always allows them (the gate also skips humans).
import { isHuman } from '../core/actors';
import { intersects } from '../core/geom';
import { ancestors, worldBounds } from '../core/tree';
import type { TreeView } from '../core/tree';
import type { ActorId, Claim, ClaimTarget, Conflict, ShapeId } from '../core/types';
import type { BoardKit } from '../core/commands';

export const DEFAULT_CLAIM_TTL_MS = 120_000;   // AGENT-11 (Contract's default is 300 s)
export const CONTENTION_WINDOW_MS = 30_000;    // AGENT-13: denials are counted over this window
export const CONTENTION_THRESHOLD = 3;         // the third denial opens a claim_contention conflict
const DENIAL_DEDUPE_MS = 200;                  // a gesture replays its commands every frame: count one attempt, not 60

export type ClaimCheck = { ok: true } | { ok: false; error: 'claimed_by'; holder: ActorId };
export type ClaimAcquire = { ok: true; claim: Claim } | { ok: false; error: 'claimed_by'; holder: ActorId };

/** What the table reports to the outside (the board's event bus, via attachClaims). */
export type ClaimNote =
  | { t: 'claim.granted' | 'claim.released'; actor: ActorId; claimId: string; holder: ActorId }
  | { t: 'claim.denied'; actor: ActorId; claimId: string; holder: ActorId }
  | { t: 'conflict.opened'; actor: ActorId; conflictId: string };

export interface Claims {
  /** Gate calls this before a write by `actor` touching `ids`. Humans always win. */
  check(ids: ShapeId[], actor: ActorId): ClaimCheck;
  acquire(holder: ActorId, target: ClaimTarget, o?: { ttlMs?: number; reason?: string }): Claim;
  release(claimId: string): boolean;
  list(): Claim[];
  // ---- additions (all optional-to-use; the signatures above are unchanged) ----
  /** Like `acquire`, but refuses when another holder's live claim overlaps the target. */
  tryAcquire(holder: ActorId, target: ClaimTarget, o?: { ttlMs?: number; reason?: string }): ClaimAcquire;
  /** Refresh the TTL of every claim `holder` has (the holder is active). */
  touch(holder: ActorId): void;
  /** Release every claim `holder` has (agent stopped). Returns how many. */
  releaseAll(holder: ActorId): number;
  /** Live claims covering shape `id` (the claim on it or on an ancestor, or a rect over it). */
  covering(id: ShapeId): Claim[];
  conflicts(): Conflict[];
  dismissConflict(conflictId: string): boolean;
  /** Called on every change (grant, release, expiry, conflict). Returns the unsubscribe. */
  subscribe(cb: () => void): () => void;
  /** Wire the document (for descendants and rect overlap) and an event sink. Done by attachClaims. */
  bind(b: { doc?: () => TreeView; notify?: (n: ClaimNote) => void }): void;
}

interface Rec { claim: Claim; ttlMs: number }

export function createClaims(now: () => number = Date.now, o: { doc?: () => TreeView } = {}): Claims {
  const held = new Map<string, Rec>();
  const open: Conflict[] = [];
  const denials = new Map<string, number[]>(); // `${claimId}|${denied}` -> timestamps
  const subs = new Set<() => void>();
  let docOf = o.doc;
  let notify: ((n: ClaimNote) => void) | undefined;
  let n = 0, cn = 0;

  const changed = () => { for (const f of [...subs]) f(); };

  /** Drop expired claims (emitting claim.released). */
  function prune() {
    const t = now();
    let any = false;
    for (const [id, r] of [...held]) {
      if (t < r.claim.expiresAt) continue;
      held.delete(id);
      any = true;
      notify?.({ t: 'claim.released', actor: r.claim.holder, claimId: id, holder: r.claim.holder });
    }
    if (any) changed();
  }

  function covers(c: Claim, id: ShapeId): boolean {
    const t = c.target;
    if (t.kind !== 'rect') {
      if (t.id === id) return true;
      const view = docOf?.();
      return !!view && ancestors(view, id).includes(t.id);
    }
    const view = docOf?.();
    const b = view ? worldBounds(view, id) : null;
    return !!b && intersects(b, t);
  }

  /** Do two targets overlap (for exclusivity between different holders)? */
  function overlap(a: ClaimTarget, b: ClaimTarget): boolean {
    const view = docOf?.();
    const box = (t: ClaimTarget) => (t.kind === 'rect' ? { x: t.x, y: t.y, w: t.w, h: t.h } : view ? worldBounds(view, t.id) : null);
    if (a.kind !== 'rect' && b.kind !== 'rect') {
      if (a.id === b.id) return true;
      return !!view && (ancestors(view, a.id).includes(b.id) || ancestors(view, b.id).includes(a.id));
    }
    const ra = box(a), rb = box(b);
    return !!ra && !!rb && intersects(ra, rb);
  }

  const sameTarget = (a: ClaimTarget, b: ClaimTarget) =>
    a.kind === 'rect' ? b.kind === 'rect' && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h : b.kind !== 'rect' && a.id === b.id;

  function grant(holder: ActorId, target: ClaimTarget, o: { ttlMs?: number; reason?: string } = {}): Claim {
    const ttlMs = o.ttlMs ?? DEFAULT_CLAIM_TTL_MS;
    for (const r of held.values()) { // the holder re-claims the same target: refresh it
      if (r.claim.holder === holder && sameTarget(r.claim.target, target)) {
        r.ttlMs = ttlMs;
        r.claim.expiresAt = now() + ttlMs;
        if (o.reason !== undefined) r.claim.reason = o.reason;
        changed();
        return { ...r.claim };
      }
    }
    const claim: Claim = { id: `claim-${++n}`, holder, target, expiresAt: now() + ttlMs, ...(o.reason !== undefined ? { reason: o.reason } : {}) };
    held.set(claim.id, { claim, ttlMs });
    notify?.({ t: 'claim.granted', actor: holder, claimId: claim.id, holder });
    changed();
    return { ...claim };
  }

  /** Record a denial; the third within the window opens a claim_contention conflict (once per claim + pair). */
  function contend(c: Claim, denied: ActorId) {
    const t = now();
    const key = `${c.id}|${denied}`;
    const list = (denials.get(key) ?? []).filter((x) => t - x < CONTENTION_WINDOW_MS);
    if (list.length && t - list[list.length - 1] < DENIAL_DEDUPE_MS) { denials.set(key, list); return; }
    list.push(t);
    denials.set(key, list);
    notify?.({ t: 'claim.denied', actor: denied, claimId: c.id, holder: c.holder });
    if (list.length < CONTENTION_THRESHOLD) return;
    const dup = open.some((k) => k.state === 'open' && sameTarget(k.target, c.target) && k.actors.includes(denied) && k.actors.includes(c.holder));
    if (dup) return;
    const k: Conflict = { id: `conflict-${++cn}`, kind: 'claim_contention', actors: [c.holder, denied], target: c.target, state: 'open' };
    open.push(k);
    notify?.({ t: 'conflict.opened', actor: denied, conflictId: k.id });
    changed();
  }

  const touch = (holder: ActorId) => {
    for (const r of held.values()) if (r.claim.holder === holder) r.claim.expiresAt = now() + r.ttlMs;
  };

  return {
    check(ids, actor) {
      if (isHuman(actor)) return { ok: true };
      prune();
      let mine = false;
      for (const r of held.values()) {
        if (!ids.some((id) => covers(r.claim, id))) continue;
        if (r.claim.holder === actor) { mine = true; continue; }
        contend(r.claim, actor);
        return { ok: false, error: 'claimed_by', holder: r.claim.holder };
      }
      if (mine) touch(actor); // auto-extend while the holder is writing inside its claim
      return { ok: true };
    },
    acquire: grant,
    tryAcquire(holder, target, o = {}) {
      prune();
      for (const r of held.values()) {
        if (r.claim.holder !== holder && overlap(r.claim.target, target)) {
          contend(r.claim, holder);
          return { ok: false, error: 'claimed_by', holder: r.claim.holder };
        }
      }
      return { ok: true, claim: grant(holder, target, o) };
    },
    release(id) {
      const r = held.get(id);
      if (!r) return false;
      held.delete(id);
      notify?.({ t: 'claim.released', actor: r.claim.holder, claimId: id, holder: r.claim.holder });
      changed();
      return true;
    },
    releaseAll(holder) {
      const mine = [...held.values()].filter((r) => r.claim.holder === holder);
      for (const r of mine) {
        held.delete(r.claim.id);
        notify?.({ t: 'claim.released', actor: holder, claimId: r.claim.id, holder });
      }
      if (mine.length) changed();
      return mine.length;
    },
    list() { prune(); return [...held.values()].map((r) => ({ ...r.claim })); },
    covering(id) { prune(); return [...held.values()].filter((r) => covers(r.claim, id)).map((r) => ({ ...r.claim })); },
    touch,
    conflicts: () => open.map((k) => ({ ...k })),
    dismissConflict(id) {
      const i = open.findIndex((k) => k.id === id);
      if (i < 0) return false;
      open.splice(i, 1);
      changed();
      return true;
    },
    subscribe(cb) { subs.add(cb); return () => { subs.delete(cb); }; },
    bind(b) {
      if (b.doc) docOf = b.doc;
      notify = b.notify;
    },
  };
}

export interface AttachClaimsOpts {
  /** Soft warning for a human writing inside an agent's claim, e.g. "Iris is working here". */
  toast?: (text: string) => void;
  /** How often to look for expired claims so `claim.released` fires without a write (default 1000 ms; 0 = off). */
  sweepMs?: number;
}

/**
 * Wires `board.claims` to the board: descendants resolve through the live document, claim events go on the event bus,
 * a holder's own shape writes extend its claims, a stopped agent's claims are released, humans get a toast.
 * Call once after createBoard(). Returns detach.
 */
export function attachClaims(board: BoardKit, o: AttachClaimsOpts = {}): () => void {
  const { claims, events, actors } = board;
  claims.bind({
    doc: () => board.doc.getState(),
    notify: (n) => events.emit(n as Parameters<typeof events.emit>[0]),
  });
  const warned = new Map<string, number>();
  const offShapes = events.subscribe({ kinds: ['shape.created', 'shape.updated', 'shape.deleted'] }, (e) => {
    if (!isHuman(e.actor)) { claims.touch(e.actor); return; }
    const ids = (e as { ids: ShapeId[] }).ids;
    for (const id of ids) {
      for (const c of claims.covering(id)) {
        if (isHuman(c.holder)) continue;
        const last = warned.get(c.id) ?? -Infinity;
        if (e.at - last < 10_000) continue;
        warned.set(c.id, e.at);
        o.toast?.(`${actors.get(c.holder)?.name ?? c.holder} is working here`);
      }
    }
  });
  // status.set publishes presence (not an event): a stopped agent lets go of its claims
  const offStatus = board.presence.subscribe((all) => {
    for (const p of all.values()) if (p.state === 'stopped') claims.releaseAll(p.actor);
  });
  const offEvents = events.subscribe({ kinds: ['status.changed'] }, (e) => {
    const s = e as { who: ActorId; state?: string };
    if (s.state === 'stopped') claims.releaseAll(s.who);
  });
  const sweep = o.sweepMs ?? 1000;
  const timer = sweep > 0 ? setInterval(() => { claims.list(); }, sweep) : undefined;
  (timer as { unref?: () => void } | undefined)?.unref?.();
  return () => { offShapes(); offStatus(); offEvents(); if (timer) clearInterval(timer); claims.bind({}); };
}
