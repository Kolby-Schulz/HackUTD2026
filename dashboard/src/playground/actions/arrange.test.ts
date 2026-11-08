import { beforeEach, describe, expect, it } from 'vitest';
import { createBoard } from '../core/commands';
import type { BoardKit } from '../core/commands';
import { findConflicts } from '../core/actions';
import { resetSeqs } from '../core/ids';
import { actions, groupSelection, nudge, reorder, ungroupSelection } from './arrange';

const H = 'human-you';
let b: BoardKit;
let n = 0;
const run = (commands: any[]) => b.exec({ actor: H, opId: `op-${++n}`, commands });
const live = () => [...b.doc.getState().shapes.values()].filter((s) => !s.deleted);
const get = (id: string) => b.doc.getState().shapes.get(id)!;
const sel = () => [...b.selection.get(H).ids];
const pick = (...ids: string[]) => run([{ t: 'selection.set', ids }]);
const mk = (props: object = {}, parent?: string, kind = 'rect') => {
  const r = run([{ t: 'shape.create', kind, props: { x: 0, y: 0, w: 10, h: 10, ...props }, ...(parent ? { parent } : {}) }]);
  return (r.results[0] as any).id as string;
};
const kids = (p: string | null) => b.doc.getState().children.get(p) ?? [];

beforeEach(() => { resetSeqs(); n = 0; b = createBoard(); });

describe('nudge', () => {
  it('moves by 1 and 10 and a burst is one undo entry', () => {
    const a = mk({ x: 100, y: 50 });
    pick(a);
    nudge(b, 1, 0); nudge(b, 1, 0); nudge(b, 1, 0);
    expect(get(a).x).toBe(103);
    nudge(b, 10, 0);
    expect(get(a).x).toBe(113);
    expect(b.undo(H)).toBe(true);
    expect(get(a).x).toBe(100);           // all four nudges undone together
    expect(b.undo(H)).toBe(true);         // next undo is the create
    expect(live().length).toBe(0);
  });
  it('does not move a selected child twice and ignores empty selection', () => {
    const f = mk({ x: 10, y: 10, w: 100, h: 100 }, undefined, 'frame');
    const c = mk({ x: 5, y: 5 }, f);
    pick(f, c);
    nudge(b, 5, 5);
    expect(get(f).x).toBe(15);
    expect(get(c).x).toBe(5);
    pick();
    expect(nudge(b, 1, 0)).toBe(false);
  });
});

describe('z-order', () => {
  it('forward / back / front / back, and no history entry when already there', () => {
    const [x, y, z] = [mk(), mk(), mk()];
    pick(x); reorder(b, 'forward');
    expect(kids(null)).toEqual([y, x, z]);
    reorder(b, 'front');
    expect(kids(null)).toEqual([y, z, x]);
    pick(x);
    expect(run([{ t: 'shape.reorder', ids: [x], to: 'front' }]).tx).toBeUndefined(); // already on top: no history entry
    pick(z); reorder(b, 'backward'); reorder(b, 'back');
    expect(kids(null)).toEqual([z, y, x]);
  });
});

describe('group / ungroup / frame', () => {
  it('groups 3 shapes at the topmost index, selects the group, ungroup restores', () => {
    const [a, c, d] = [mk({ x: 0, y: 0 }), mk({ x: 50, y: 20 }), mk({ x: 20, y: 90 })];
    const top = mk({ x: 500 });
    pick(a, c, d);
    expect(groupSelection(b)).toBe(true);
    const g = sel()[0];
    expect(get(g).kind).toBe('group');
    expect(get(g).name).toBe('Group 1');
    expect(kids(g)).toEqual([a, c, d]);
    expect(kids(null)).toEqual([g, top]);
    expect(get(c).x).toBe(50);            // local to group at 0,0
    expect(ungroupSelection(b)).toBe(true);
    expect(sel().sort()).toEqual([a, c, d].sort());
    expect(live().some((s) => s.kind === 'group')).toBe(false);
    expect(kids(null)).toEqual([a, c, d, top]);
  });
  it('frame selection hugs the union with clip and white fill', () => {
    const a = mk({ x: 100, y: 100 }), c = mk({ x: 150, y: 140 });
    pick(a, c);
    groupSelection(b, 'frame');
    const f = get(sel()[0]);
    expect(f.kind).toBe('frame');
    expect([f.x, f.y, f.w, f.h]).toEqual([100, 100, 60, 50]);
    expect(f.clip).toBe(true);
    expect(f.fills).toEqual([{ type: 'solid', color: '#ffffff' }]);
    expect(get(a).parent).toBe(f.id);
    expect(b.undo(H)).toBe(true);         // whole wrap is one entry
    expect(live().some((s) => s.kind === 'frame')).toBe(false);
  });
  it('mixed parents group under the topmost item parent keeping world position', () => {
    const loose = mk({ x: 0, y: 0 });
    const fr = mk({ x: 100, y: 100, w: 200, h: 200 }, undefined, 'frame');
    const inside = mk({ x: 10, y: 10 }, fr);
    pick(loose, inside);
    expect(groupSelection(b)).toBe(true);
    const g = get(sel()[0]);
    expect(g.parent).toBe(fr);
    expect(kids(g.id).length).toBe(2);
    const wl = get(loose); // loose at world 0,0 -> frame-local -100,-100 -> group-local relative to its box
    expect(g.x + wl.x).toBe(-100);
  });
  it('ungroup with nothing groupable is a no-op', () => {
    pick(mk());
    expect(ungroupSelection(b)).toBe(false);
  });
});

describe('registry', () => {
  it('has the fixed ids and no binding conflicts', () => {
    expect(actions.map((a) => a.id).sort()).toEqual(['arrange.back', 'arrange.backward', 'arrange.forward', 'arrange.frameSelection', 'arrange.front', 'arrange.group', 'arrange.nudge', 'arrange.ungroup']);
    expect(findConflicts(actions, 'mac')).toEqual([]);
    expect(findConflicts(actions, 'win')).toEqual([]);
  });
});
