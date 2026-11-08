import { describe, expect, it } from 'vitest';
import { createPresenceBus } from './bus';
import { createSelectionStore } from './selection';
import { createLocks } from './locks';
import { createClaims } from './claims';
import type { ActorId, Presence } from '../core/types';

describe('presence bus', () => {
  it('50 actors in one frame arrive as one batch', () => {
    let flush = () => {};
    const bus = createPresenceBus({ schedule: (f) => { flush = f; } });
    const batches: ReadonlyMap<ActorId, Presence>[] = [];
    bus.subscribe((all) => batches.push(all));
    for (let i = 0; i < 50; i++) bus.publish({ actor: `agent-${i}`, x: i, y: i });
    bus.publish({ actor: 'agent-0', x: 99 });
    expect(batches).toHaveLength(0);
    flush();
    expect(batches).toHaveLength(1);
    expect(batches[0].size).toBe(50);
    expect(batches[0].get('agent-0')).toMatchObject({ x: 99, y: 0 });
  });
  it('expires rows after the ttl and removes instantly', () => {
    let t = 0;
    const bus = createPresenceBus({ now: () => t, schedule: () => {} });
    bus.publish({ actor: 'a' });
    t = 5000; bus.publish({ actor: 'b' });
    t = 10_500;
    expect(bus.expire()).toEqual(['a']);
    expect(bus.get('a')).toBeUndefined();
    bus.remove('b');
    expect(bus.get('b')).toBeUndefined();
  });
});

describe('selection', () => {
  it('is per actor and does not leak', () => {
    const s = createSelectionStore();
    s.set('human-you', ['a', 'b']);
    s.set('agent-x', ['c']);
    s.set('human-you', ['b']);
    expect(s.get('agent-x').ids).toEqual(['c']);
    expect(s.get('human-you').ids).toEqual(['b']);
  });
  it('prunes deleted ids and only notifies on change', () => {
    const s = createSelectionStore();
    let n = 0; s.subscribe(() => n++);
    s.set('human-you', ['a', 'b'], 'f');
    s.set('human-you', ['a', 'b']);
    expect(n).toBe(1);
    expect(s.prune((id) => id !== 'a' && id !== 'f')).toEqual(['human-you']);
    expect(s.get('human-you')).toEqual({ ids: ['b'], scope: null });
  });
});

describe('lock and claim stubs', () => {
  it('check allows', () => {
    expect(createLocks().check(['a'], 'agent-x')).toEqual({ ok: true });
    expect(createClaims().check(['a'], 'agent-x')).toEqual({ ok: true });
  });
});
