import { describe, expect, it } from 'vitest';
import { createBoard } from '../core/commands';
import type { BoardEvent } from '../core/types';
import { CONTENTION_THRESHOLD, DEFAULT_CLAIM_TTL_MS, attachClaims, createClaims } from './claims';

function setup() {
  let t = 1000;
  const board = createBoard({ now: () => t });
  const toasts: string[] = [];
  attachClaims(board, { toast: (s) => toasts.push(s), sweepMs: 0 });
  board.actors.spawn({ id: 'agent-iris', kind: 'agent', name: 'Iris' });
  board.actors.spawn({ id: 'agent-juno', kind: 'agent', name: 'Juno' });
  const events: BoardEvent[] = [];
  board.subscribe({ kinds: ['claim.granted', 'claim.denied', 'claim.released', 'conflict.opened'] }, (e) => events.push(e));
  let n = 0;
  const run = (actor: string, commands: any[]) => board.exec({ actor, opId: `op${++n}`, commands });
  expect(run('human-you', [
    { t: 'shape.create', kind: 'frame', props: { x: 0, y: 0, w: 300, h: 300, name: 'Profile card' }, id: 'f1' },
    { t: 'shape.create', kind: 'rect', props: { x: 10, y: 10, w: 50, h: 50 }, parent: 'f1', id: 'child' },
    { t: 'shape.create', kind: 'rect', props: { x: 500, y: 0, w: 50, h: 50 }, id: 'free' },
  ]).ok).toBe(true);
  const move = (actor: string, id: string) => run(actor, [{ t: 'shape.translate', ids: [id], dx: 1, dy: 0 }]);
  const claimFrame = (actor: string) => run(actor, [{ t: 'claim.acquire', target: { kind: 'frame', id: 'f1' }, reason: 'Profile card' }]);
  return { board, events, toasts, run, move, claimFrame, tick: (ms: number) => { t += ms; } };
}

describe('claims', () => {
  it('blocks another agent inside a claimed frame and its descendants, not the holder, not outside', () => {
    const { board, move, claimFrame, events } = setup();
    expect(claimFrame('agent-iris').ok).toBe(true);
    expect(events.map((e) => e.t)).toContain('claim.granted');
    const r = move('agent-juno', 'child');
    expect(r.ok).toBe(false);
    expect(r.results[0]).toMatchObject({ ok: false, error: 'claimed_by', holder: 'agent-iris' });
    expect(move('agent-juno', 'f1').results[0]).toMatchObject({ error: 'claimed_by' });
    expect(move('agent-juno', 'free').ok).toBe(true);
    expect(move('agent-iris', 'child').ok).toBe(true);
    expect(board.claims.list()).toHaveLength(1);
  });

  it('creating a shape inside the claimed frame is denied for others', () => {
    const { run, claimFrame } = setup();
    claimFrame('agent-iris');
    const r = run('agent-juno', [{ t: 'shape.create', kind: 'rect', props: { x: 0, y: 0, w: 5, h: 5 }, parent: 'f1' }]);
    expect(r.results[0]).toMatchObject({ error: 'claimed_by' });
  });

  it('humans are never blocked and get a soft toast', () => {
    const { move, claimFrame, toasts } = setup();
    claimFrame('agent-iris');
    expect(move('human-you', 'child').ok).toBe(true);
    expect(toasts).toEqual(['Iris is working here']);
  });

  it('expires after the TTL, emitting claim.released; the former blocker can then write', () => {
    const { board, move, claimFrame, events, tick } = setup();
    claimFrame('agent-iris');
    tick(DEFAULT_CLAIM_TTL_MS + 1);
    expect(move('agent-juno', 'child').ok).toBe(true);
    expect(board.claims.list()).toHaveLength(0);
    expect(events.filter((e) => e.t === 'claim.released')).toHaveLength(1);
  });

  it('auto-extends while the holder writes', () => {
    const { board, move, claimFrame, tick } = setup();
    claimFrame('agent-iris');
    tick(DEFAULT_CLAIM_TTL_MS - 1000);
    expect(move('agent-iris', 'child').ok).toBe(true);
    tick(DEFAULT_CLAIM_TTL_MS - 1000);
    expect(board.claims.list()).toHaveLength(1);
    expect(move('agent-juno', 'child').ok).toBe(false);
  });

  it('the third denial opens one claim_contention conflict', () => {
    const { board, move, claimFrame, events, tick } = setup();
    claimFrame('agent-iris');
    for (let i = 0; i < CONTENTION_THRESHOLD; i++) { move('agent-juno', 'child'); tick(500); }
    expect(board.claims.conflicts()).toHaveLength(1);
    expect(board.claims.conflicts()[0]).toMatchObject({ kind: 'claim_contention', state: 'open', actors: ['agent-iris', 'agent-juno'] });
    expect(events.filter((e) => e.t === 'claim.denied')).toHaveLength(3);
    expect(events.filter((e) => e.t === 'conflict.opened')).toHaveLength(1);
    move('agent-juno', 'child'); tick(500); move('agent-juno', 'child');
    expect(board.claims.conflicts()).toHaveLength(1); // no duplicate
  });

  it('denials far apart do not accumulate into a conflict', () => {
    const { board, move, claimFrame, tick } = setup();
    claimFrame('agent-iris');
    for (let i = 0; i < 4; i++) { move('agent-juno', 'child'); tick(20_000); board.claims.touch('agent-iris'); }
    expect(board.claims.conflicts()).toHaveLength(0);
  });

  it('rect claims block overlapping shapes only', () => {
    const { board, move } = setup();
    board.claims.acquire('agent-iris', { kind: 'rect', x: 480, y: -10, w: 100, h: 100 });
    expect(move('agent-juno', 'free').results[0]).toMatchObject({ error: 'claimed_by' });
    expect(move('agent-juno', 'child').ok).toBe(true);
  });

  it('tryAcquire refuses an overlapping target of another holder; same holder refreshes', () => {
    const { board, claimFrame } = setup();
    claimFrame('agent-iris');
    expect(board.claims.tryAcquire('agent-juno', { kind: 'shape', id: 'child' })).toMatchObject({ ok: false, holder: 'agent-iris' });
    const a = board.claims.tryAcquire('agent-iris', { kind: 'frame', id: 'f1' });
    expect(a.ok).toBe(true);
    expect(board.claims.list()).toHaveLength(1);
    expect(board.claims.tryAcquire('agent-juno', { kind: 'shape', id: 'free' }).ok).toBe(true);
  });

  it('release, releaseAll and a stopped agent free the claims', () => {
    const { board, claimFrame, move } = setup();
    claimFrame('agent-iris');
    board.exec({ actor: 'agent-iris', opId: 'st', commands: [{ t: 'status.set', state: 'stopped' }] });
    board.presence.flush(); // presence is delivered in batches
    expect(board.claims.list()).toHaveLength(0);
    expect(move('agent-juno', 'child').ok).toBe(true);
    const c = board.claims.acquire('agent-iris', { kind: 'shape', id: 'free' });
    expect(board.claims.release(c.id)).toBe(true);
    expect(board.claims.release(c.id)).toBe(false);
  });

  it('works unbound (no document): exact id only', () => {
    const c = createClaims(() => 0);
    c.acquire('agent-a', { kind: 'frame', id: 'f' });
    expect(c.check(['x'], 'agent-b')).toEqual({ ok: true });
    expect(c.check(['f'], 'agent-b')).toMatchObject({ ok: false, error: 'claimed_by' });
    expect(c.check(['f'], 'human-you')).toEqual({ ok: true });
  });
});
