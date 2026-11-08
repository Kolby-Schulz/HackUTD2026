import { beforeEach, describe, expect, it } from 'vitest';
import { createBoard } from '../core/commands';
import type { BoardKit } from '../core/commands';
import { resetSeqs } from '../core/ids';
import { deleteSelection, duplicateSelection, redoMine, selectAll, undoMine } from './edit';

const H = 'human-you';
const A = 'agent-k3f9';
let b: BoardKit;
let n = 0;
const run = (actor: string, commands: any[]) => b.exec({ actor, opId: `op-${++n}`, commands });
const live = () => [...b.doc.getState().shapes.values()].filter((s) => !s.deleted);
const sel = () => [...b.selection.get(H).ids];
const mk = (actor: string, props: object = {}) => {
  const r = run(actor, [{ t: 'shape.create', kind: 'rect', props: { x: 0, y: 0, w: 10, h: 10, ...props } }]);
  return r.results[0].ok ? (r.results[0] as any).id as string : '';
};
const pick = (...ids: string[]) => run(H, [{ t: 'selection.set', ids }]);

beforeEach(() => { resetSeqs(); n = 0; b = createBoard(); b.actors.spawn({ id: A, kind: 'agent', name: 'A' }); });

describe('undo / redo keys', () => {
  it('undo only touches the human; redo brings the same id back', () => {
    const a = mk(H);
    const g = mk(A);
    expect(undoMine(b)).toBe(true);
    expect(b.doc.getState().shapes.get(a)!.deleted).toBe(true);
    expect(b.doc.getState().shapes.get(g)!.deleted).toBeFalsy();
    expect(redoMine(b)).toBe(true);
    expect(b.doc.getState().shapes.get(a)!.deleted).toBeFalsy();
    expect(undoMine(b) && undoMine(b)).toBe(false); // empty stack: no error
  });
});

describe('delete', () => {
  it('removes a frame with children; undo restores the ids and reselects', () => {
    const r = run(H, [{ t: 'shape.create', kind: 'frame', props: { w: 100, h: 100 } }, { t: 'shape.create', kind: 'rect', props: { w: 5, h: 5 }, parent: '$0' }]);
    const f = (r.results[0] as any).id as string;
    pick(f);
    expect(deleteSelection(b)).toBe(true);
    expect(live().length).toBe(0);
    expect(sel()).toEqual([]);
    undoMine(b);
    expect(live().length).toBe(2);
    expect(sel()).toEqual([f]);
  });
  it('empty selection is a no-op', () => { expect(deleteSelection(b)).toBe(false); });
});

describe('duplicate', () => {
  it('offsets +16, selects the copy, repeats the moved delta, one undo removes it', () => {
    const a = mk(H, { x: 10, y: 10 });
    pick(a);
    expect(duplicateSelection(b)).toBe(true);
    const copy = sel()[0];
    expect(copy).not.toBe(a);
    expect(b.doc.getState().shapes.get(copy)).toMatchObject({ x: 26, y: 26 });
    run(H, [{ t: 'shape.translate', ids: [copy], dx: 200, dy: 0 }]);
    duplicateSelection(b);
    const third = sel()[0];
    expect(b.doc.getState().shapes.get(third)).toMatchObject({ x: 426, y: 26 });
    undoMine(b);
    expect(live().length).toBe(2);
  });
  it('duplicating a frame clones its children with new ids', () => {
    const r = run(H, [{ t: 'shape.create', kind: 'frame', props: { w: 100, h: 100 } }, { t: 'shape.create', kind: 'rect', props: { w: 5, h: 5 }, parent: '$0' }]);
    pick((r.results[0] as any).id);
    duplicateSelection(b);
    expect(live().length).toBe(4);
    expect(sel().length).toBe(1);
  });
});

describe('select all', () => {
  it('selects siblings in scope, skipping hidden and locked', () => {
    const a = mk(H), c = mk(H), hid = mk(H, { hidden: true }), lk = mk(H, { locked: true });
    selectAll(b);
    expect(sel().sort()).toEqual([a, c].sort());
    expect(sel()).not.toContain(hid);
    expect(sel()).not.toContain(lk);
  });
  it('inside a frame, selects that frame\'s children', () => {
    const r = run(H, [{ t: 'shape.create', kind: 'frame', props: { w: 100, h: 100 } }, { t: 'shape.create', kind: 'rect', props: {}, parent: '$0' }, { t: 'shape.create', kind: 'rect', props: {}, parent: '$0' }]);
    const kids = [(r.results[1] as any).id, (r.results[2] as any).id];
    mk(H);
    pick(kids[0]);
    selectAll(b);
    expect(sel().sort()).toEqual(kids.sort());
  });
});
