import { describe, expect, it } from 'vitest';
import { createBoard } from '../core/commands';
import type { BoardEvent } from '../core/types';
import { attachLocks, createLocks } from './locks';

function setup() {
  let t = 1000;
  const board = createBoard({ now: () => t });
  const toasts: string[] = [];
  const lk = attachLocks(board, { toast: (s) => toasts.push(s) });
  board.actors.spawn({ id: 'agent-iris', kind: 'agent', name: 'Iris' });
  board.actors.spawn({ id: 'agent-bolt', kind: 'agent', name: 'Bolt' });
  const events: BoardEvent[] = [];
  board.subscribe({ kinds: ['lock.revoked'] }, (e) => events.push(e));
  const make = () => {
    const r = board.exec({ actor: 'human-you', opId: 'mk' + Math.random(), commands: [{ t: 'shape.create', kind: 'rect', props: { x: 0, y: 0, w: 50, h: 50 }, id: 's1' }] });
    expect(r.ok).toBe(true);
  };
  return { board, lk, toasts, events, make, tick: (ms: number) => { t += ms; } };
}
const move = (actor: string, opId: string) => ({ actor, opId, commands: [{ t: 'shape.translate' as const, ids: ['s1'], dx: 5, dy: 0 }] });

describe('soft locks', () => {
  it('agent command on a shape locked by another agent fails with locked + holder', () => {
    const { board, make } = setup();
    make();
    board.locks.acquire('s1', 'agent-iris');
    const r = board.exec(move('agent-bolt', 'a1'));
    expect(r.ok).toBe(false);
    expect(r.results[0]).toMatchObject({ ok: false, error: 'locked', holder: 'agent-iris' });
    expect(board.exec(move('agent-iris', 'a2')).ok).toBe(true); // the holder is fine
  });

  it('human command succeeds on an agent-locked shape, revokes the lock and emits lock.revoked', () => {
    const { board, make, events, toasts } = setup();
    make();
    board.locks.acquire('s1', 'agent-iris');
    expect(board.exec(move('human-you', 'h1')).ok).toBe(true);
    expect(board.locks.list()).toHaveLength(0);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ t: 'lock.revoked', ids: ['s1'], by: 'human-you', actor: 'human-you', holder: 'agent-iris' });
    expect(toasts).toEqual(['You took over from Iris']);
  });

  it('open agent gesture acquires a lock; a human gesture takes it over, keeping the agent work so far', () => {
    const { board, make, events } = setup();
    make();
    const g = board.gesture('agent-iris', 'draw');
    g.update([{ t: 'shape.translate', ids: ['s1'], dx: 40, dy: 0 }]);
    expect(board.locks.list()[0]).toMatchObject({ shapeId: 's1', holder: 'agent-iris' });
    expect(board.exec(move('agent-bolt', 'b1')).results[0]).toMatchObject({ error: 'locked' });

    const h = board.gesture('human-you', 'drag');
    h.update([{ t: 'shape.translate', ids: ['s1'], dx: 7, dy: 0 }]);
    expect(events).toHaveLength(1);
    g.update([{ t: 'shape.translate', ids: ['s1'], dx: 99, dy: 0 }]); // ignored, revoked
    expect(g.commit().ok).toBe(false);
    h.commit();
    expect(board.doc.getState().shapes.get('s1')!.x).toBe(47); // agent's +40 was kept, the human's +7 lands on top
    expect(board.locks.list()).toHaveLength(0);
  });

  it('a shape an agent is still creating survives a human takeover', () => {
    const { board } = setup();
    const g = board.gesture('agent-iris', 'build');
    g.update([{ t: 'shape.create', kind: 'rect', props: { x: 10, y: 10, w: 80, h: 40 }, id: 'new1' }]);
    expect(board.doc.getState().shapes.get('new1')).toBeTruthy(); // visible while the agent draws
    const h = board.gesture('human-you', 'drag');
    h.update([{ t: 'shape.translate', ids: ['new1'], dx: 5, dy: 0 }]);
    expect(g.commit().ok).toBe(false); // the agent's gesture was revoked
    h.commit();
    const s = board.doc.getState().shapes.get('new1');
    expect(s && !s.deleted).toBe(true); // it did not vanish
    expect(s!.x).toBe(15);
    expect(board.undo('agent-iris')).toBe(true); // the agent's partial build is its own undo entry
  });

  it('an agent write holds the shape for 500 ms', () => {
    const { board, make } = setup();
    make();
    expect(board.exec(move('agent-iris', 'a1')).ok).toBe(true);
    expect(board.locks.list()[0]).toMatchObject({ holder: 'agent-iris', ttlMs: 500 });
  });
});

describe('createLocks ttl', () => {
  it('locks expire after their TTL', () => {
    let t = 0;
    const l = createLocks(() => t);
    l.acquire('s', 'agent-a', 1000);
    expect(l.check(['s'], 'agent-b')).toMatchObject({ ok: false, holder: 'agent-a', retryAfterMs: 1000 });
    t = 999;
    expect(l.check(['s'], 'agent-b').ok).toBe(false);
    t = 1000;
    expect(l.check(['s'], 'agent-b').ok).toBe(true);
    expect(l.list()).toHaveLength(0);
  });
  it('humans are never blocked; release only by holder', () => {
    const l = createLocks(() => 0);
    l.acquire('s', 'agent-a');
    expect(l.check(['s'], 'human-you').ok).toBe(true);
    l.release('s', 'agent-b');
    expect(l.list()).toHaveLength(1);
  });
});
