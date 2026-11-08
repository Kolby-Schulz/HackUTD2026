import { describe, expect, it } from 'vitest';
import { ACTOR_COLORS, actorKind, createActorRegistry, isAgent, makeActorId } from './actors';

describe('actors', () => {
  it('ids follow kind-short and kind is queryable', () => {
    expect(makeActorId('agent')).toMatch(/^agent-[0-9a-z]{4}$/);
    expect(isAgent('agent-k3f9')).toBe(true);
    expect(isAgent('human-you')).toBe(false);
    expect(actorKind('you')).toBeUndefined();
  });
  it('first 12 colours are unique', () => {
    const r = createActorRegistry();
    const colors = Array.from({ length: 12 }, (_, i) => r.spawn({ kind: 'agent', name: `A${i}` }).color);
    expect(new Set(colors).size).toBe(12);
    expect(colors).toEqual([...ACTOR_COLORS]);
    expect(r.list()).toHaveLength(12);
  });
  it('caps and removal', () => {
    const r = createActorRegistry();
    const a = r.spawn({ kind: 'api', name: 'obs', caps: ['read'] });
    expect(r.can(a.id, 'write')).toBe(false);
    let n = 0; r.subscribe(() => n++);
    r.remove(a.id);
    expect(n).toBe(1);
    expect(r.get(a.id)).toBeUndefined();
  });
});
