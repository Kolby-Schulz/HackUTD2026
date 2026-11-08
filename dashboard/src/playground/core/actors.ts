// Actor registry and ids (AGENT-3). Ids are `${kind}-${short}`. Pure TS.
import { PALETTE, pickColor } from '../presence/colors';
import type { Actor, ActorId, ActorKind, ActorRegistry, Cap } from './types';

export const ACTOR_COLORS = PALETTE;

export const DEFAULT_CAPS: Record<ActorKind, Cap[]> = {
  human: ['read', 'write', 'comment', 'claim', 'spawn', 'admin'],
  agent: ['read', 'write', 'comment', 'claim'],
  api: ['read', 'write', 'comment', 'claim'],
  system: ['read', 'write', 'comment', 'claim', 'spawn', 'admin'],
};

const KINDS: ActorKind[] = ['human', 'agent', 'api', 'system'];
const SHORT = '0123456789abcdefghijklmnopqrstuvwxyz';

export function makeActorId(kind: ActorKind, short?: string): ActorId {
  if (!short) {
    short = '';
    for (let i = 0; i < 4; i++) short += SHORT[Math.floor(Math.random() * SHORT.length)];
  }
  return `${kind}-${short}`;
}
/** Kind from the id prefix; undefined for ids that do not follow the scheme. */
export function actorKind(id: ActorId): ActorKind | undefined {
  const k = id.split('-')[0] as ActorKind;
  return KINDS.includes(k) && id.length > k.length + 1 ? k : undefined;
}
export const isAgent = (id: ActorId) => actorKind(id) === 'agent';
export const isHuman = (id: ActorId) => actorKind(id) === 'human';

export function createActorRegistry(): ActorRegistry & { nextColor(): string; spawn(a: Partial<Actor> & { kind: ActorKind; name: string }): Actor; can(id: ActorId, cap: Cap): boolean } {
  const actors = new Map<ActorId, Actor>();
  const subs = new Set<() => void>();
  const notify = () => subs.forEach((cb) => cb());
  const reg = {
    get: (id: ActorId) => actors.get(id),
    list: () => [...actors.values()],
    register(a: Actor) { actors.set(a.id, a); notify(); },
    remove(id: ActorId) { if (actors.delete(id)) notify(); },
    subscribe(cb: () => void) { subs.add(cb); return () => { subs.delete(cb); }; },
    /** Least-used palette colour (see presence/colors.ts); beyond 12 actors a generated hue. */
    nextColor(): string {
      return pickColor([...actors.values()].map((a) => a.color));
    },
    /** Create + register with a fresh id (unique), default caps and an unused colour. */
    spawn(p: Partial<Actor> & { kind: ActorKind; name: string }): Actor {
      let id = p.id ?? makeActorId(p.kind);
      while (!p.id && actors.has(id)) id = makeActorId(p.kind);
      const a: Actor = { caps: DEFAULT_CAPS[p.kind], color: reg.nextColor(), ...p, id };
      reg.register(a);
      return a;
    },
    can: (id: ActorId, cap: Cap) => !!actors.get(id)?.caps.includes(cap),
  };
  return reg;
}
