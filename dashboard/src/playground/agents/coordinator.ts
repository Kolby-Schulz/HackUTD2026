// Scripted coordinator (AGENT-13). Pure TS, no React. Mirrors Contract's `claim_contention` conflict: when presence/claims
// opens a conflict (the third denial in 30 s), the coordinator rules (the holder keeps the target, the other agent is sent
// to another slot), posts a conflict card in the General thread, emits `conflict.ruled` so agents adapt, and lets the
// human overrule (swap the holder). A human among the actors always wins, with no slot move. `decide()` can replace
// `rule()` later; the shape of `Ruling` is the contract.
import { isHuman } from '../core/actors';
import type { BoardKit } from '../core/commands';
import type { ActorId, ClaimTarget, Conflict } from '../core/types';
import { GENERAL } from '../chat/store';
import type { ChatMsg, ChatStore } from '../chat/store';

export const COORDINATOR_ID: ActorId = 'system-coordinator';
export const COORDINATOR_NAME = 'Coordinator';
export const COORDINATOR_COLOR = '#6b7280';

export interface Ruling {
  conflictId: string;
  target: ClaimTarget;
  /** Keeps the target. */
  holder: ActorId;
  /** Denied; sent to `slot` (0-based) unless the holder is a human. */
  loser: ActorId;
  slot: number | null;
  human: boolean;
  /** How many times the human overruled (swapped) this ruling. */
  overruled: number;
  messageId: string;
  text: string;
}

export interface CoordinatorDeps {
  board: Pick<BoardKit, 'events' | 'claims' | 'actors' | 'doc'>;
  chat: Pick<ChatStore, 'post' | 'update'>;
  /** Next free work slot, 0-based (the runtime's slot grid). Default: a counter from 0. */
  pickSlot?: () => number;
  /** Give a slot back (an overrule moves the other agent). */
  freeSlot?: (slot: number) => void;
  /** Tell the loser to go elsewhere (the runtime restarts its task in `slot`). */
  onRedirect?: (agent: ActorId, slot: number, ruling: Ruling) => void;
  /** Agent's own chat line; default posts into General as that agent. */
  say?: (agent: ActorId, text: string) => void;
}

export interface Coordinator {
  rulings(): Ruling[];
  ruling(conflictId: string): Ruling | undefined;
  /** Rule on an open conflict now (also called automatically on `conflict.opened`). */
  rule(conflictId: string): Ruling | undefined;
  /** The human swaps the holder. Returns the new ruling, or undefined when not allowed. */
  overrule(conflictId: string): Ruling | undefined;
  subscribe(cb: () => void): () => void;
  dispose(): void;
}

const same = (a: ClaimTarget, b: ClaimTarget) =>
  a.kind === 'rect' ? b.kind === 'rect' && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h : b.kind !== 'rect' && a.id === b.id;

export function createCoordinator(d: CoordinatorDeps): Coordinator {
  const { board, chat } = d;
  const byId = new Map<string, Ruling>();
  const subs = new Set<() => void>();
  let next = 0;
  const changed = () => { for (const f of [...subs]) f(); };
  const pickSlot = d.pickSlot ?? (() => next++);
  const nameOf = (id: ActorId) => board.actors.get(id)?.name ?? id;
  const colorOf = (id: ActorId) => board.actors.get(id)?.color ?? COORDINATOR_COLOR;

  function targetName(t: ClaimTarget): string {
    if (t.kind === 'rect') return 'that area';
    return board.doc.getState().shapes.get(t.id)?.name || 'that layer';
  }

  function sentence(r: { holder: ActorId; loser: ActorId; slot: number | null; human: boolean }, target: ClaimTarget): string {
    const what = targetName(target);
    if (r.human) return `${nameOf(r.holder)} keeps ${what} (human edits win); ${nameOf(r.loser)} steps back`;
    return `${nameOf(r.holder)} keeps ${what}; ${nameOf(r.loser)} moves to slot ${(r.slot ?? 0) + 1}`;
  }

  function sayAs(agent: ActorId, text: string) {
    if (d.say) { d.say(agent, text); return; }
    chat.post({ thread: GENERAL, from: agent, name: nameOf(agent), color: colorOf(agent), body: { kind: 'text', text } });
  }

  function open(id: string): Conflict | undefined {
    return board.claims.conflicts().find((k) => k.id === id && k.state === 'open');
  }

  function rule(conflictId: string): Ruling | undefined {
    const had = byId.get(conflictId);
    if (had) return had;
    const k = open(conflictId);
    if (!k || k.actors.length < 2) return undefined;
    // claims lists [holder, denied]; a human among them always holds
    let [holder, loser] = k.actors;
    if (isHuman(loser) && !isHuman(holder)) [holder, loser] = [loser, holder];
    const human = isHuman(holder);
    const slot = human || isHuman(loser) ? null : pickSlot();
    const r: Ruling = { conflictId, target: k.target, holder, loser, slot, human, overruled: 0, messageId: '', text: '' };
    r.text = sentence(r, k.target);
    const msg = chat.post({ thread: GENERAL, from: COORDINATOR_ID, name: COORDINATOR_NAME, color: COORDINATOR_COLOR, body: { kind: 'conflict', conflictId }, text: r.text });
    r.messageId = msg.id;
    byId.set(conflictId, r);
    board.events.emit({ t: 'conflict.ruled', actor: COORDINATOR_ID, conflictId });
    if (slot !== null) {
      sayAs(loser, `Understood, ${nameOf(holder)} has ${targetName(k.target)}. I'll take slot ${slot + 1}.`);
      d.onRedirect?.(loser, slot, r);
    }
    changed();
    return r;
  }

  function overrule(conflictId: string): Ruling | undefined {
    const r = byId.get(conflictId);
    if (!r || r.human) return undefined;
    const oldHolder = r.holder, oldLoser = r.loser;
    // the claim moves: the old holder lets go, the old loser takes the target
    for (const c of board.claims.list()) if (c.holder === oldHolder && same(c.target, r.target)) board.claims.release(c.id);
    board.claims.acquire(oldLoser, r.target, { reason: 'Coordinator ruling (overruled)' });
    if (r.slot !== null) d.freeSlot?.(r.slot);
    r.holder = oldLoser;
    r.loser = oldHolder;
    r.slot = pickSlot();
    r.overruled += 1;
    r.text = sentence(r, r.target) + ' (you overruled)';
    chat.update(r.messageId, { text: r.text });
    board.events.emit({ t: 'conflict.ruled', actor: COORDINATOR_ID, conflictId });
    sayAs(r.loser, `Understood, ${nameOf(r.holder)} has ${targetName(r.target)} now. I'll take slot ${r.slot + 1}.`);
    d.onRedirect?.(r.loser, r.slot, r);
    changed();
    return r;
  }

  const off = board.events.subscribe({ kinds: ['conflict.opened'] }, (e) => {
    rule((e as { conflictId: string }).conflictId);
  });

  return {
    rulings: () => [...byId.values()],
    ruling: (id) => byId.get(id),
    rule, overrule,
    subscribe(cb) { subs.add(cb); return () => { subs.delete(cb); }; },
    dispose() { off(); subs.clear(); },
  };
}

// The page starts one coordinator (useBoot); the conflict card finds it here. StrictMode safe: the last start wins.
let active: Coordinator | null = null;
export function startCoordinator(d: CoordinatorDeps): () => void {
  const c = createCoordinator(d);
  active = c;
  return () => { c.dispose(); if (active === c) active = null; };
}
export const activeCoordinator = () => active;

export type { ChatMsg };
