import { beforeEach, describe, expect, it } from 'vitest';
import { resetSeqs } from './ids';
import { createDocStore } from './store';
import { createUndo, type UndoManager } from './undo';
import type { DocStore, Op, Shape } from './types';

const H = 'human-you';
const A = 'agent-k3f9';
const rect = (id: string, over: Partial<Shape> = {}): Op => ({
  t: 'create',
  shape: { id, kind: 'rect', name: id, x: 0, y: 0, w: 10, h: 10, fills: [], parent: null, index: 'V', createdBy: H, ...over },
});
const get = (id: string) => store.getState().shapes.get(id)!;

let store: DocStore;
let um: UndoManager;
let t = 0;
beforeEach(() => {
  resetSeqs(); t = 0;
  store = createDocStore({ boardId: 't' });
  um = createUndo(store, { now: () => t });
});
const run = (actor: string, label: string, ops: Op[], key?: string) => {
  const tx = store.dispatch(actor, label, ops, key ? { coalesceKey: key } : {})!;
  um.record(tx);
  return tx;
};

describe('skip superseded fields', () => {
  it('human moves, agent recolours, human undo moves back and keeps the colour', () => {
    run(H, 'make', [rect('a')]);
    const move = run(H, 'move', [{ t: 'set', id: 'a', patch: { x: 50 } }]);
    run(A, 'colour', [{ t: 'set', id: 'a', patch: { fills: [{ type: 'solid', color: 'red' }] } }]);
    const r = um.undo(H);
    expect(r.ok).toBe(true);
    expect(get('a').x).toBe(0);
    expect(get('a').fills).toEqual([{ type: 'solid', color: 'red' }]);
    expect(move.id).toBeTruthy();
  });

  it('every field superseded: ok false, reports the superseding actor, entry removed', () => {
    run(H, 'make', [rect('a')]);
    run(H, 'move', [{ t: 'set', id: 'a', patch: { x: 50 } }]);
    run(A, 'move', [{ t: 'set', id: 'a', patch: { x: 70 } }]);
    const r = um.undo(H);
    expect(r.ok).toBe(false);
    expect(r.skipped).toEqual([{ id: 'a', field: 'x', by: A }]);
    expect(get('a').x).toBe(70);
    expect(um.canUndo(H)).toBe(true); // the create is still there
    expect(um.undo(H).ok).toBe(true);
  });

  it('empty stack returns ok false with no tx', () => {
    expect(um.undo(H)).toEqual({ ok: false, tx: null, skipped: [] });
    expect(um.redo(H).ok).toBe(false);
  });

  it('stacks are per actor', () => {
    run(A, 'card', [rect('c')]);
    run(H, 'rect', [rect('r')]);
    um.undo(H);
    expect(get('r').deleted).toBe(true);
    expect(get('c').deleted).toBeUndefined();
    expect(um.undo(H).ok).toBe(false);
    expect(um.canUndo(A)).toBe(true);
  });
});

describe('create, delete, redo', () => {
  it('undo create removes, redo restores the same id', () => {
    run(H, 'make', [rect('a', { x: 4 })]);
    um.undo(H);
    expect(get('a').deleted).toBe(true);
    expect(um.canRedo(H)).toBe(true);
    expect(um.redo(H).ok).toBe(true);
    expect(get('a').deleted).toBeUndefined();
    expect(get('a').x).toBe(4);
    um.undo(H);
    expect(get('a').deleted).toBe(true);
  });

  it('undo of delete restores children and order', () => {
    run(H, 'make', [rect('f', { kind: 'frame' }), rect('c1', { parent: 'f', index: 'a' }), rect('c2', { parent: 'f', index: 'b' })]);
    run(H, 'del', [{ t: 'remove', id: 'f' }, { t: 'remove', id: 'c1' }, { t: 'remove', id: 'c2' }]);
    expect(get('c1').deleted).toBe(true);
    um.undo(H);
    expect(store.getState().children.get('f')).toEqual(['c1', 'c2']);
    um.redo(H);
    expect(get('f').deleted).toBe(true);
  });

  it('delete by someone else makes undo of an edit a harmless no-op', () => {
    run(H, 'make', [rect('a')]);
    run(H, 'move', [{ t: 'set', id: 'a', patch: { x: 9 } }]);
    run(A, 'del', [{ t: 'remove', id: 'a' }]);
    const r = um.undo(H);
    expect(r.ok).toBe(false);
    expect(r.skipped[0]).toMatchObject({ id: 'a', by: A });
    expect(get('a').deleted).toBe(true);
  });

  it('undo of frame create lifts foreign children out instead of deleting them', () => {
    run(H, 'make', [rect('f', { kind: 'frame', x: 100, y: 100 })]);
    run(A, 'child', [rect('k', { parent: 'f', x: 5, y: 6, createdBy: A })]);
    um.undo(H);
    expect(get('f').deleted).toBe(true);
    expect(get('k').deleted).toBeUndefined();
    expect(get('k').parent).toBeNull();
    expect([get('k').x, get('k').y]).toEqual([105, 106]);
    expect(store.getState().children.get(null)).toContain('k');
  });

  it('new record clears redo', () => {
    run(H, 'make', [rect('a')]);
    um.undo(H);
    run(H, 'again', [rect('b')]);
    expect(um.canRedo(H)).toBe(false);
  });
});

describe('redo after skip', () => {
  it('redo re-applies only what undo wrote', () => {
    run(H, 'make', [rect('a')]);
    run(H, 'edit', [{ t: 'set', id: 'a', patch: { x: 5, y: 6 } }]);
    run(A, 'y', [{ t: 'set', id: 'a', patch: { y: 99 } }]);
    um.undo(H); // x back, y skipped
    expect([get('a').x, get('a').y]).toEqual([0, 99]);
    um.redo(H);
    expect([get('a').x, get('a').y]).toEqual([5, 99]);
  });
});

describe('coalescing and revert', () => {
  it('nudges with one key within the window are one entry', () => {
    run(H, 'make', [rect('a')]);
    for (let i = 1; i <= 5; i++) { t += 200; run(H, 'nudge', [{ t: 'set', id: 'a', patch: { x: i } }], 'nudge:a'); }
    expect(get('a').x).toBe(5);
    um.undo(H);
    expect(get('a').x).toBe(0);
    um.undo(H); // the create
    expect(um.canUndo(H)).toBe(false);
  });

  it('a pause longer than the window starts a new entry', () => {
    run(H, 'make', [rect('a')]);
    run(H, 'n', [{ t: 'set', id: 'a', patch: { x: 1 } }], 'k');
    t += 2000;
    run(H, 'n', [{ t: 'set', id: 'a', patch: { x: 2 } }], 'k');
    um.undo(H);
    expect(get('a').x).toBe(1);
  });

  it('does not coalesce across another actor writing the same field', () => {
    run(H, 'make', [rect('a')]);
    run(H, 'n', [{ t: 'set', id: 'a', patch: { x: 1 } }], 'k');
    run(A, 'n', [{ t: 'set', id: 'a', patch: { x: 7 } }]);
    run(H, 'n', [{ t: 'set', id: 'a', patch: { x: 8 } }], 'k');
    um.undo(H);
    expect(get('a').x).toBe(7);
  });

  it('cap drops the oldest entries', () => {
    const small = createUndo(store, { now: () => t, cap: 2 });
    for (const id of ['a', 'b', 'c']) small.record(store.dispatch(H, 'm', [rect(id)])!);
    expect(small.undo(H).ok).toBe(true);
    expect(small.undo(H).ok).toBe(true);
    expect(small.undo(H).ok).toBe(false);
  });

  it('revert undoes another actor tx by id with the same filter', () => {
    run(H, 'make', [rect('a')]);
    const mv = run(A, 'move', [{ t: 'set', id: 'a', patch: { x: 30, y: 40 } }]);
    run(H, 'y', [{ t: 'set', id: 'a', patch: { y: 77 } }]);
    const r = um.revert(H, mv.id);
    expect(r.ok).toBe(true);
    expect([get('a').x, get('a').y]).toEqual([0, 77]);
    expect(r.skipped).toEqual([{ id: 'a', field: 'y', by: H }]);
    expect(um.canUndo(A)).toBe(false);
    expect(um.canRedo(H)).toBe(false);
    expect(um.revert(H, mv.id).ok).toBe(false);
  });

  it('forget drops stacks', () => {
    run(H, 'make', [rect('a')]);
    um.forget(H);
    expect(um.canUndo(H)).toBe(false);
  });
});

describe('selection and reparent', () => {
  it('undo reselects before; redo reselects after (live shapes only)', () => {
    run(H, 'make', [rect('a')]);
    const tx = store.dispatch(H, 'edit', [{ t: 'set', id: 'a', patch: { x: 3 } }])!;
    tx.sel = { before: ['a'], after: ['a', 'gone'] };
    um.record(tx);
    const r = um.undo(H);
    expect(r.tx!.sel!.after).toEqual(['a']);
  });

  it('undo of reparent restores parent and index', () => {
    run(H, 'make', [rect('f', { kind: 'frame' }), rect('a', { index: 'm' })]);
    run(H, 'drop', [{ t: 'place', id: 'a', parent: 'f', index: 'z' }]);
    um.undo(H);
    expect([get('a').parent, get('a').index]).toEqual([null, 'm']);
  });
});
