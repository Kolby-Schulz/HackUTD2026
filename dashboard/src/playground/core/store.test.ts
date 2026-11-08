import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSeqs } from './ids';
import { createDocStore } from './store';
import type { DocStore, Op, Shape } from './types';

const H = 'human-you';
const A = 'agent-k3f9';
const rect = (id: string, over: Partial<Shape> = {}): Op => ({
  t: 'create',
  shape: { id, kind: 'rect', name: id, x: 0, y: 0, w: 10, h: 10, fills: [], parent: null, index: 'V', createdBy: H, ...over },
});
const tick = () => Promise.resolve();
const shape = (s: DocStore, id: string) => s.getState().shapes.get(id)!;

let store: DocStore;
beforeEach(() => { resetSeqs(); store = createDocStore({ boardId: 't' }); });

describe('transactions', () => {
  it('begin + 60 apply + commit is one Tx whose inverse restores the base', () => {
    store.dispatch(H, 'Draw', [rect('a', { x: 5, y: 7 })]);
    const before = store.log().length;
    const h = store.begin(H, 'Move');
    for (let i = 1; i <= 60; i++) h.apply([{ t: 'set', id: 'a', patch: { x: 5 + i, y: 7 + i } }]);
    expect(shape(store, 'a').x).toBe(65); // live while dragging
    expect(store.log().length).toBe(before); // transient frames are not logged
    const tx = h.commit();
    expect(tx).not.toBeNull();
    expect(tx!.ops).toEqual([{ t: 'set', id: 'a', patch: { x: 65, y: 67 } }]);
    expect(tx!.inverse).toEqual([{ t: 'set', id: 'a', patch: { x: 5, y: 7 } }]);
    expect(tx!.produced.map((p) => p.field).sort()).toEqual(['x', 'y']);
    expect(store.log().length).toBe(before + 1);
    store.dispatch(H, 'Undo', tx!.inverse);
    expect([shape(store, 'a').x, shape(store, 'a').y]).toEqual([5, 7]);
  });

  it('abort restores base values and records nothing; created shapes vanish', () => {
    store.dispatch(H, 'Draw', [rect('a')]);
    const logLen = store.log().length;
    const h = store.begin(H, 'Move');
    h.apply([{ t: 'set', id: 'a', patch: { x: 99 } }, rect('b')]);
    expect(store.getState().shapes.has('b')).toBe(true);
    h.abort();
    expect(shape(store, 'a').x).toBe(0);
    expect(store.getState().shapes.has('b')).toBe(false);
    expect(store.log().length).toBe(logLen);
    expect(h.commit()).toBeNull();
  });

  it('commit with zero net change returns null and logs nothing', () => {
    store.dispatch(H, 'Draw', [rect('a', { x: 3 })]);
    const logLen = store.log().length;
    const h = store.begin(H, 'Drag');
    h.apply([{ t: 'set', id: 'a', patch: { x: 50 } }]);
    h.apply([{ t: 'set', id: 'a', patch: { x: 3 } }]);
    expect(h.commit()).toBeNull();
    expect(store.log().length).toBe(logLen);
    expect(shape(store, 'a').x).toBe(3);
    expect(store.dispatch(H, 'noop', [{ t: 'set', id: 'a', patch: { x: 3 } }])).toBeNull();
    expect(store.dispatch(H, 'empty', [])).toBeNull();
  });

  it('a create inside a gesture commits as one create with final geometry', () => {
    const h = store.begin(H, 'Draw rectangle');
    h.apply([rect('n', { w: 1, h: 1 })]);
    h.apply([{ t: 'set', id: 'n', patch: { w: 120, h: 80 } }]);
    const tx = h.commit()!;
    expect(tx.ops).toHaveLength(1);
    expect(tx.ops[0]).toMatchObject({ t: 'create', shape: { id: 'n', w: 120, h: 80 } });
    expect(tx.inverse).toEqual([{ t: 'remove', id: 'n' }]);
    expect(store.log().every((e) => e.tx === tx.id)).toBe(true);
  });

  it('dispatch exposes id, actor, label, ops, inverse and the coalesce key', () => {
    const tx = store.dispatch(H, 'Draw', [rect('a')], { coalesceKey: 'k', causedBy: 'cmd1' })!;
    expect(tx).toMatchObject({ actor: H, label: 'Draw', coalesceKey: 'k', causedBy: 'cmd1' });
    expect(tx.id).toBeTruthy();
    expect(store.log().map((e) => e.tx)).toEqual([tx.id]);
    expect(store.log()[0]).toMatchObject({ actor: H, opId: `${H}:1` });
  });

  it('is all or nothing when an op throws', () => {
    store.dispatch(H, 'Draw', [rect('a')]);
    const rev = store.getState().rev;
    const bad = { t: 'set', id: 'a', get patch(): never { throw new Error('boom'); } } as unknown as Op;
    expect(() => store.dispatch(H, 'x', [{ t: 'set', id: 'a', patch: { x: 9 } }, bad])).toThrow('boom');
    expect(shape(store, 'a').x).toBe(0);
    expect(store.getState().rev).toBe(rev);
  });

  it('refuses a second open transaction for the same actor but allows other actors', () => {
    store.begin(H, 'one');
    expect(() => store.begin(H, 'two')).toThrow();
    expect(() => store.begin(A, 'agent')).not.toThrow();
  });

  it('a remote/committed change during a gesture does not lose the gesture, and abort keeps the remote change', () => {
    store.dispatch(H, 'Draw', [rect('a'), rect('b')]);
    const h = store.begin(H, 'Move');
    h.apply([{ t: 'set', id: 'a', patch: { x: 40 } }]);
    store.dispatch(A, 'Recolor', [{ t: 'set', id: 'b', patch: { name: 'blue' } }]);
    expect(shape(store, 'a').x).toBe(40);
    expect(shape(store, 'b').name).toBe('blue');
    h.abort();
    expect(shape(store, 'a').x).toBe(0);
    expect(shape(store, 'b').name).toBe('blue');
  });
});

describe('notifications', () => {
  it('a 100-op dispatch notifies subscribers once; shape listeners only for their id', async () => {
    const all = vi.fn(), a = vi.fn(), b = vi.fn(), feed = vi.fn();
    store.subscribe(all); store.subscribeShape('s0', a); store.subscribeShape('zzz', b); store.onChange(feed);
    store.dispatch(H, 'Many', Array.from({ length: 100 }, (_, i) => rect(`s${i}`)));
    expect(all).not.toHaveBeenCalled(); // deferred to the microtask
    await tick();
    expect(all).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    expect(feed).toHaveBeenCalledTimes(1);
    expect(feed.mock.calls[0][0]).toHaveLength(100);
  });

  it('batches separate dispatches in one tick and fires subscribeShape only for the touched id', async () => {
    store.dispatch(H, 'Draw', [rect('a'), rect('b')]);
    await tick();
    const a = vi.fn(), b = vi.fn(), all = vi.fn();
    store.subscribeShape('a', a); store.subscribeShape('b', b); store.subscribe(all);
    for (let i = 1; i <= 10; i++) store.dispatch(H, 'nudge', [{ t: 'set', id: 'a', patch: { x: i } }]);
    await tick();
    expect(all).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
  });

  it('unsubscribe stops notifications; gesture frames and abort notify', async () => {
    store.dispatch(H, 'Draw', [rect('a')]);
    await tick();
    const l = vi.fn(), gone = vi.fn();
    store.subscribe(l); store.subscribe(gone)();
    const h = store.begin(H, 'Move');
    h.apply([{ t: 'set', id: 'a', patch: { x: 1 } }]);
    await tick();
    expect(l).toHaveBeenCalledTimes(1);
    h.abort();
    await tick();
    expect(l).toHaveBeenCalledTimes(2);
    expect(gone).not.toHaveBeenCalled();
  });

  it('rev increases with every observable change and not for no-ops', () => {
    const r0 = store.getState().rev;
    store.dispatch(H, 'Draw', [rect('a')]);
    const r1 = store.getState().rev;
    expect(r1).toBeGreaterThan(r0);
    store.dispatch(H, 'noop', [{ t: 'set', id: 'a', patch: { x: 0 } }]);
    expect(store.getState().rev).toBe(r1);
    const h = store.begin(H, 'Move');
    h.apply([{ t: 'set', id: 'a', patch: { x: 5 } }]);
    const r2 = store.getState().rev;
    expect(r2).toBeGreaterThan(r1);
    h.abort();
    expect(store.getState().rev).toBeGreaterThan(r2);
  });
});

describe('snapshot, load, log', () => {
  it('round-trips shapes (with tombstones), lamport and actor seqs', () => {
    store.dispatch(H, 'Draw', [rect('a', { x: 4 }), rect('b')]);
    store.dispatch(A, 'Del', [{ t: 'remove', id: 'b' }]);
    store.dispatch(H, 'Board', [{ t: 'board', patch: { name: 'Mine' } }]);
    const snap = JSON.parse(JSON.stringify(store.snapshot()));
    expect(snap.format).toBe('contract-board');

    resetSeqs();
    const other = createDocStore();
    other.load(snap);
    expect([...other.getState().shapes.keys()].sort()).toEqual(['a', 'b']);
    expect(other.getState().shapes.get('b')!.deleted).toBe(true);
    expect(other.getState().shapes.get('a')).toEqual(store.getState().shapes.get('a'));
    expect(other.getState().children.get(null)).toEqual(['a']);
    expect(other.getState().meta.name).toBe('Mine');
    expect(other.snapshot().lamport).toBe(snap.lamport);
    expect(other.snapshot().seq).toEqual(snap.seq);
    // lamport and seq continue instead of restarting
    const tx = other.dispatch(H, 'More', [{ t: 'set', id: 'a', patch: { x: 9 } }])!;
    const env = other.log().find((e) => e.tx === tx.id)!;
    expect(env.lamport).toBeGreaterThan(snap.lamport);
    expect(env.opId).toBe(`${H}:${snap.seq[H] + 1}`);
  });

  it('load drops open gestures and notifies', async () => {
    store.dispatch(H, 'Draw', [rect('a')]);
    const snap = store.snapshot();
    const h = store.begin(H, 'Move');
    h.apply([{ t: 'set', id: 'a', patch: { x: 77 } }]);
    const l = vi.fn();
    store.subscribe(l);
    store.load(snap);
    await tick();
    expect(l).toHaveBeenCalledTimes(1);
    expect(shape(store, 'a').x).toBe(0);
    expect(h.commit()).toBeNull();
  });

  it('log is append-only, log(from) slices, and applyRemote appends once per opId', () => {
    store.dispatch(H, 'Draw', [rect('a')]);
    const first = store.log();
    store.dispatch(H, 'Move', [{ t: 'set', id: 'a', patch: { x: 2 } }]);
    const second = store.log();
    expect(second.slice(0, first.length)).toEqual(first);
    expect(store.log(first.length)).toHaveLength(second.length - first.length);

    const remote = createDocStore();
    remote.applyRemote([...second]);
    remote.applyRemote([...second]); // duplicate delivery
    expect(remote.log()).toHaveLength(second.length);
    expect(remote.getState().shapes.get('a')!.x).toBe(2);
    expect(remote.dispatch(A, 'next', [{ t: 'set', id: 'a', patch: { y: 1 } }]) &&
      remote.log().at(-1)!.lamport).toBeGreaterThan(Math.max(...second.map((e) => e.lamport)));
  });
});
