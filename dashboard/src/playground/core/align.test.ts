import { describe, expect, it } from 'vitest';
import { ALIGN_MODES, alignCommands, canAlign, distributeCommands } from './align';
import { buildChildren } from './tree';
import type { TreeView } from './tree';
import type { Command, Kind, Shape } from './types';

function mk(id: string, parent: string | null, o: Partial<Shape> & { kind?: Kind } = {}): Shape {
  return { id, kind: 'rect', parent, index: 'V', createdBy: 'human-you', name: id, x: 0, y: 0, w: 10, h: 10, fills: [], stamps: {}, ...o } as Shape;
}
function view(list: Shape[]): TreeView {
  const shapes = new Map(list.map((s) => [s.id, s]));
  return { shapes, children: buildChildren(shapes) };
}
/** Apply translate commands and return resulting x/y per id. */
function apply(v: TreeView, cmds: Command[]) {
  const out = new Map([...v.shapes].map(([id, s]) => [id, { x: s.x, y: s.y }]));
  for (const c of cmds) if (c.t === 'shape.translate') for (const id of c.ids) { const p = out.get(id)!; p.x += c.dx; p.y += c.dy; }
  return out;
}

const three = view([
  mk('a', null, { x: 10, y: 5, w: 20, h: 30 }),
  mk('b', null, { x: 50, y: 40, w: 40, h: 10 }),
  mk('c', null, { x: 100, y: 20, w: 10, h: 60 }),
]);
const ids = ['a', 'b', 'c'];

describe('alignCommands', () => {
  it('aligns three shapes in every mode', () => {
    const l = apply(three, alignCommands(three, ids, 'left'));
    expect([...ids].map((i) => l.get(i)!.x)).toEqual([10, 10, 10]);
    const r = apply(three, alignCommands(three, ids, 'right'));
    expect(ids.map((i) => r.get(i)!.x + three.shapes.get(i)!.w)).toEqual([110, 110, 110]);
    const hc = apply(three, alignCommands(three, ids, 'hcenter'));
    expect(ids.map((i) => hc.get(i)!.x + three.shapes.get(i)!.w / 2)).toEqual([60, 60, 60]);
    const t = apply(three, alignCommands(three, ids, 'top'));
    expect(ids.map((i) => t.get(i)!.y)).toEqual([5, 5, 5]);
    const b = apply(three, alignCommands(three, ids, 'bottom'));
    expect(ids.map((i) => b.get(i)!.y + three.shapes.get(i)!.h)).toEqual([80, 80, 80]);
    const vc = apply(three, alignCommands(three, ids, 'vcenter'));
    const cs = ids.map((i) => vc.get(i)!.y + three.shapes.get(i)!.h / 2);
    expect(Math.max(...cs) - Math.min(...cs)).toBeLessThanOrEqual(1);
  });
  it('returns one flat batch of translates (callers exec it once)', () => {
    for (const m of ALIGN_MODES) expect(alignCommands(three, ids, m).every((c) => c.t === 'shape.translate')).toBe(true);
  });
  it('skips locked shapes and nested members', () => {
    const v = view([mk('f', null, { x: 0, y: 0, w: 100, h: 100, kind: 'frame' }), mk('k', 'f', { x: 5 }), mk('a', null, { x: 200 }), mk('l', null, { x: 300, locked: true })]);
    const cmds = alignCommands(v, ['f', 'k', 'a', 'l'], 'left');
    expect(cmds).toEqual([{ t: 'shape.translate', ids: ['a'], dx: -200, dy: 0 }]);
  });
  it('one shape aligns to its parent frame; at the root it does nothing', () => {
    const v = view([mk('f', null, { x: 100, y: 100, w: 200, h: 200, kind: 'frame' }), mk('k', 'f', { x: 10, y: 10, w: 20, h: 20 })]);
    expect(alignCommands(v, ['k'], 'right')).toEqual([{ t: 'shape.translate', ids: ['k'], dx: 170, dy: 0 }]);
    expect(canAlign(v, ['k'])).toBe(true);
    expect(canAlign(three, ['a'])).toBe(false);
    expect(alignCommands(three, ['a'], 'left')).toEqual([]);
  });
});

describe('distributeCommands', () => {
  it('equalises gaps and keeps the outer two in place', () => {
    const v = view([mk('a', null, { x: 0, w: 10 }), mk('b', null, { x: 50, w: 30 }), mk('c', null, { x: 400, w: 10 })]);
    const r = apply(v, distributeCommands(v, ['a', 'b', 'c'], 'h'));
    expect(r.get('a')!.x).toBe(0);
    expect(r.get('c')!.x).toBe(400);
    const gap1 = r.get('b')!.x - 10, gap2 = 400 - (r.get('b')!.x + 30);
    expect(Math.abs(gap1 - gap2)).toBeLessThanOrEqual(1);
  });
  it('needs 3 shapes', () => {
    expect(distributeCommands(three, ['a', 'b'], 'h')).toEqual([]);
  });
});

describe('WP-72 target, distribute, match', () => {
  const frame = view([
    mk('f', null, { kind: 'frame', x: 0, y: 0, w: 200, h: 100 }),
    mk('a', 'f', { x: 0, y: 0, w: 20, h: 10 }),
    mk('b', 'f', { x: 50, y: 20, w: 40, h: 30 }),
    mk('c', 'f', { x: 100, y: 40, w: 10, h: 60 }),
    mk('d', 'f', { x: 160, y: 5, w: 30, h: 10 }),
  ]);
  it('parent mode aligns every shape flush right to its frame', async () => {
    const { alignCommands: ac } = await import('./align');
    const r = apply(frame, ac(frame, ['a', 'b', 'c'], 'right', 'parent'));
    expect(['a', 'b', 'c'].map((i) => r.get(i)!.x + frame.shapes.get(i)!.w)).toEqual([200, 200, 200]);
  });
  it('key mode aligns to the first selected and leaves it put', async () => {
    const { alignCommands: ac } = await import('./align');
    const cmds = ac(frame, ['b', 'a', 'c'], 'left', 'key', 'b');
    const r = apply(frame, cmds);
    expect(['a', 'b', 'c'].map((i) => r.get(i)!.x)).toEqual([50, 50, 50]);
    expect(cmds.length).toBe(2);
  });
  it('distributes 4 shapes with equal gaps in one batch', () => {
    const r = apply(frame, distributeCommands(frame, ['a', 'b', 'c', 'd'], 'h'));
    const o = ['a', 'b', 'c', 'd'].map((i) => ({ x: r.get(i)!.x, w: frame.shapes.get(i)!.w }));
    const gaps = o.slice(1).map((s, i) => s.x - (o[i]!.x + o[i]!.w));
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1);
    expect(o[0]!.x).toBe(0); expect(o[3]!.x).toBe(160);
  });
  it('blocks distribute for 2 shapes or mixed parents', async () => {
    const m = await import('./align');
    expect(m.distributeBlocked(frame, ['a', 'b'])).toMatch(/3\+/);
    expect(m.distributeBlocked(frame, ['a', 'b', 'f'])).toBeTruthy();
  });
  it('matches width/height to the key, keeping top-left', async () => {
    const m = await import('./align');
    const cmds = m.matchSizeCommands(frame, ['b', 'a', 'c'], 'w');
    expect(cmds).toEqual([
      { t: 'shape.resize', id: 'a', box: { x: 0, y: 0, w: 40, h: 10 } },
      { t: 'shape.resize', id: 'c', box: { x: 100, y: 40, w: 40, h: 60 } },
    ]);
    expect(m.matchSizeCommands(frame, ['b'], 'h')).toEqual([]);
  });
});
