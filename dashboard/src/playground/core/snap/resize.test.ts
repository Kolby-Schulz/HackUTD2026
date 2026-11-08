import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { snapCreate, snapResize } from '../snap';
import type { SnapCtx } from '../snap';
import { SpatialIndex } from '../spatial';
import { buildChildren } from '../tree';
import type { TreeView } from '../tree';
import type { Rect, Shape } from '../types';
import { bindSnapSource } from './candidates';
import { resetSnapMemory } from './move';
import { parentCandidate } from './parent';
import { resetResizeSnapMemory } from './resize';

function mk(id: string, parent: string | null, o: Partial<Shape> = {}): Shape {
  return { id, kind: 'rect', parent, index: 'V', createdBy: 'human-you', name: id, x: 0, y: 0, w: 100, h: 100, fills: [], stamps: {}, ...o } as Shape;
}
function bind(list: Shape[], extra: { zoom?: number; viewport?: Rect; round?: boolean } = {}) {
  const shapes = new Map(list.map((s) => [s.id, s]));
  const view: TreeView = { shapes, children: buildChildren(shapes) };
  const index = new SpatialIndex();
  index.rebuild(view);
  bindSnapSource({ view, index, viewport: extra.viewport ? () => extra.viewport! : undefined, zoom: () => extra.zoom ?? 1, round: () => extra.round ?? true });
  return { view, index };
}
const ctx = (o: Partial<SnapCtx> = {}): SnapCtx => ({ actor: 'human-you', ignore: new Set(), thresholdWorld: 5, parent: null, ...o });
const box = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

beforeEach(() => { resetSnapMemory(); resetResizeSnapMemory(); });
afterEach(() => bindSnapSource(null));

describe('snapResize: dragged edges only', () => {
  it('does nothing when unbound or without candidates', () => {
    expect(snapResize(box(0, 0, 100, 50), 'e', ctx())).toEqual({ dx: 0, dy: 0, lines: [], gaps: [] });
    bind([]);
    expect(snapResize(box(0, 0, 100, 50), 'e', ctx()).lines).toEqual([]);
  });

  it('east handle snaps only the east edge (west is never a source)', () => {
    // other shape: left 200, right 300. Resized box west edge at 202 would snap if it were a source.
    bind([mk('a', null, { x: 200, y: 1000, w: 100 })]);
    const r = snapResize(box(202, 0, 95, 50), 'e', ctx()); // east edge 297 -> 300
    expect(r.dx).toBe(3);
    expect(r.dy).toBe(0);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({ axis: 'x', at: 300, kind: 'edge' });
    // west edge alone near a line does not snap on an east drag
    expect(snapResize(box(202, 0, 40, 50), 'e', ctx())).toMatchObject({ dx: 0, lines: [] });
  });

  it('west handle snaps the west edge; east edge is the anchor', () => {
    bind([mk('a', null, { x: 200, y: 1000, w: 100 })]);
    const r = snapResize(box(197, 0, 200, 50), 'w', ctx()); // west 197 -> 200
    expect(r.dx).toBe(3);
    expect(r.lines[0]).toMatchObject({ axis: 'x', at: 200 });
  });

  it('north and south handles snap only y', () => {
    bind([mk('a', null, { x: 1000, y: 300, h: 100 })]);
    expect(snapResize(box(0, 0, 50, 297), 's', ctx())).toMatchObject({ dx: 0, dy: 3 });
    const n = snapResize(box(0, 302, 50, 200), 'n', ctx());
    expect(n).toMatchObject({ dx: 0, dy: -2 });
    expect(n.lines[0]).toMatchObject({ axis: 'y', at: 300 });
  });

  it('corner handle snaps one x edge and one y edge independently', () => {
    bind([mk('a', null, { x: 200, y: 300 })]);
    const r = snapResize(box(0, 0, 198, 304), 'se', ctx());
    expect(r.dx).toBe(2);
    expect(r.dy).toBe(-4);
    expect(r.lines.map((l) => l.axis).sort()).toEqual(['x', 'y']);
    const nw = snapResize(box(198, 304, 500, 500), 'nw', ctx());
    expect(nw).toMatchObject({ dx: 2, dy: -4 });
  });

  it('corner handle only snapping one axis leaves the other untouched', () => {
    bind([mk('a', null, { x: 200, y: 300 })]);
    const r = snapResize(box(0, 0, 198, 900), 'se', ctx());
    expect(r.dx).toBe(2);
    expect(r.dy).toBe(0);
    expect(r.lines).toHaveLength(1);
  });

  it('snaps the moving edge to a candidate centre line', () => {
    bind([mk('a', null, { x: 200, y: 1000, w: 100 })]); // centre 250
    const r = snapResize(box(0, 0, 247, 50), 'e', ctx());
    expect(r.dx).toBe(3);
    expect(r.lines[0]).toMatchObject({ axis: 'x', at: 250, kind: 'center' });
  });

  it('respects the threshold: 5 world units yes, 6 no', () => {
    bind([mk('a', null, { x: 200, y: 1000 })]);
    expect(snapResize(box(0, 0, 195, 50), 'e', ctx()).dx).toBe(5);
    resetResizeSnapMemory();
    expect(snapResize(box(0, 0, 194, 50), 'e', ctx()).dx).toBe(0);
  });

  it('guide spans the resized box and the matching shape', () => {
    bind([mk('a', null, { x: 200, y: 400, w: 100, h: 100 })]);
    const r = snapResize(box(0, 0, 198, 50), 'e', ctx());
    expect(r.lines[0]).toMatchObject({ at: 200, from: 0, to: 500 });
  });

  it('ignores shapes in ctx.ignore and their descendants', () => {
    bind([mk('a', null, { x: 200 }), mk('kid', 'a', { x: 0, y: 0, w: 10, h: 10 })]);
    expect(snapResize(box(0, 0, 197, 50), 'e', ctx({ ignore: new Set(['a']) }))).toMatchObject({ dx: 0, lines: [] });
  });

  it('agent threshold 2 and no hysteresis; rounding optional', () => {
    bind([mk('a', null, { x: 200.5 })], { round: false });
    const r = snapResize(box(0, 0, 199, 50), 'e', ctx({ actor: 'agent-iris', thresholdWorld: 2 }));
    expect(r.dx).toBeCloseTo(1.5);
    expect(snapResize(box(0, 0, 197, 50), 'e', ctx({ actor: 'agent-iris', thresholdWorld: 2 })).dx).toBe(0);
  });

  it('rounds the snapped edge to an integer and the guide follows', () => {
    bind([mk('a', null, { x: 200.4 })]);
    const r = snapResize(box(0, 0, 198, 50), 'e', ctx());
    expect(r.dx).toBe(2);
    expect(r.lines[0].at).toBe(200);
  });

  it('never snaps below the 1 unit minimum size', () => {
    bind([mk('a', null, { x: 100, y: 1000 })]); // line at 100
    // west drag: anchor (east) at 100.5; moving edge near 99 would snap to 100 -> width 0.5 < 1
    const r = snapResize(box(99, 0, 1.5, 50), 'w', ctx());
    expect(r.lines.filter((l) => l.axis === 'x')).toEqual([]);
  });
});

describe('snapResize: flipped resizes', () => {
  it('signed box (negative w): east drag past the anchor still snaps the pointer-side edge', () => {
    bind([mk('a', null, { x: 100, y: 1000, w: 50 })]); // lines 100,125,150
    // anchor x=200, pointer at 103 (w = -97). Moving edge is x + w.
    const r = snapResize(box(200, 0, -97, 50), 'e', ctx());
    expect(r.dx).toBe(-3);
    expect(r.lines[0]).toMatchObject({ axis: 'x', at: 100 });
    // guide spans the normalised box, not a negative interval
    expect(r.lines[0].from).toBeLessThanOrEqual(r.lines[0].to);
  });

  it('signed box (negative h) south drag flips over the anchor', () => {
    bind([mk('a', null, { x: 1000, y: 100, h: 50 })]);
    const r = snapResize(box(0, 300, 50, -197), 's', ctx()); // pointer y = 103 -> 100
    expect(r.dy).toBe(-3);
    expect(r.lines[0]).toMatchObject({ axis: 'y', at: 100 });
  });

  it('normalised box with the mirrored handle gives the same answer', () => {
    bind([mk('a', null, { x: 100, y: 1000, w: 50 })]);
    const signed = snapResize(box(200, 0, -97, 50), 'e', ctx());
    resetResizeSnapMemory();
    const mirrored = snapResize(box(103, 0, 97, 50), 'w', ctx());
    expect(mirrored.dx).toBe(signed.dx);
    expect(mirrored.lines[0].at).toBe(signed.lines[0].at);
  });

  it('flipped on both axes with a corner handle', () => {
    bind([mk('a', null, { x: 100, y: 100 })]);
    const r = snapResize(box(300, 300, -197, -198), 'se', ctx()); // pointer (103,102)
    expect(r.dx).toBe(-3);
    expect(r.dy).toBe(-2);
  });

  it('flip must not snap the moving edge onto the anchor', () => {
    bind([mk('a', null, { x: 200, y: 1000 })]); // line at 200 == anchor
    const r = snapResize(box(200, 0, -2, 50), 'e', ctx()); // moving edge 198 -> 200 would be width 0
    expect(r.lines).toEqual([]);
  });
});

describe('snapResize: zoom levels', () => {
  // The facade is called with thresholdWorld = 5 / z, so engine behaviour follows ctx.thresholdWorld.
  it.each([[0.1, 50], [1, 5], [5, 1]])('zoom %s: threshold %s world units', (z, tw) => {
    bind([mk('a', null, { x: 1000, y: 5000 })], { zoom: z });
    const c = ctx({ thresholdWorld: 5 / z });
    expect(5 / z).toBe(tw);
    expect(snapResize(box(0, 0, 1000 - tw, 50), 'e', c).dx).toBe(tw);
    resetResizeSnapMemory();
    expect(snapResize(box(0, 0, 1000 - tw - 2, 50), 'e', c).dx).toBe(0);
  });

  it('human hysteresis holds a snap 2 screen px past the threshold, agents do not', () => {
    for (const z of [1, 4]) {
      bind([mk('a', null, { x: 200, y: 1000 })], { zoom: z });
      const t = 5 / z, extra = 2 / z;
      const human = ctx({ thresholdWorld: t });
      expect(snapResize(box(0, 0, 200 - 1 / z, 50), 'e', human).dx).toBeCloseTo(1 / z, 5); // engage
      const held = snapResize(box(0, 0, 200 - t - extra * 0.5, 50), 'e', human);
      expect(held.lines).toHaveLength(1); // still held
      expect(snapResize(box(0, 0, 200 - t - extra * 2, 50), 'e', human).lines).toEqual([]); // released
      resetResizeSnapMemory();
      const agent = ctx({ actor: 'agent-iris', thresholdWorld: t });
      expect(snapResize(box(0, 0, 200 - 1 / z, 50), 'e', agent).lines.length).toBeGreaterThan(0);
      expect(snapResize(box(0, 0, 200 - t - extra * 0.5, 50), 'e', agent).lines).toEqual([]);
      resetResizeSnapMemory();
    }
  });

  it('viewport culls far candidates', () => {
    bind([mk('a', null, { x: 5000, y: 0 })], { viewport: box(0, 0, 1000, 1000) });
    expect(snapResize(box(0, 0, 4998, 50), 'e', ctx()).lines).toEqual([]);
  });
});

describe('parent frame (ALIGN-8)', () => {
  const frame = () => mk('f', null, { kind: 'frame', x: 100, y: 100, w: 400, h: 300 });

  it('east edge snaps to the parent right edge and to its centre (children positions are parent-local)', () => {
    bind([frame(), mk('c', 'f', { x: 10, y: 10, w: 50, h: 50 })]);
    // frame world: x 100..500, centre 300. Child resized in world space.
    const r = snapResize(box(150, 150, 348, 40), 'e', ctx({ parent: 'f', ignore: new Set(['c']) })); // east 498 -> 500
    expect(r.dx).toBe(2);
    expect(r.lines[0]).toMatchObject({ axis: 'x', at: 500 });
    resetResizeSnapMemory();
    const c = snapResize(box(150, 150, 148, 40), 'e', ctx({ parent: 'f', ignore: new Set(['c']) })); // east 298 -> centre 300
    expect(c.dx).toBe(2);
    expect(c.lines[0]).toMatchObject({ axis: 'x', at: 300, kind: 'center' });
  });

  it('parent centre guide spans the full frame height; edge snap flush to the frame', () => {
    bind([frame(), mk('c', 'f')]);
    const r = snapResize(box(120, 150, 178, 40), 'e', ctx({ parent: 'f', ignore: new Set(['c']) }));
    expect(r.lines[0]).toMatchObject({ axis: 'x', at: 300, from: 100, to: 400 });
    resetResizeSnapMemory();
    const w = snapResize(box(103, 150, 300, 40), 'w', ctx({ parent: 'f', ignore: new Set(['c']) }));
    expect(w.dx).toBe(-3);
    expect(w.lines[0]).toMatchObject({ axis: 'x', at: 100 });
  });

  it('y axis: top, middle and bottom of the parent', () => {
    bind([frame(), mk('c', 'f')]);
    const c = ctx({ parent: 'f', ignore: new Set(['c']) });
    expect(snapResize(box(150, 150, 40, 247), 's', c).dy).toBe(3); // bottom 397 -> 400
    resetResizeSnapMemory();
    const mid = snapResize(box(150, 150, 40, 48), 's', c); // 198 -> 250
    expect(mid.dy).toBe(0); // 52 away: outside the threshold
    const near = snapResize(box(150, 150, 40, 98), 's', c); // 248 -> 250
    expect(near.dy).toBe(2);
    expect(near.lines[0]).toMatchObject({ axis: 'y', at: 250, kind: 'center' });
  });

  it('works for flipped resizes inside a frame', () => {
    bind([frame(), mk('c', 'f')]);
    const r = snapResize(box(400, 150, -297, 40), 'e', ctx({ parent: 'f', ignore: new Set(['c']) })); // pointer 103 -> 100
    expect(r.dx).toBe(-3);
    expect(r.lines[0]).toMatchObject({ at: 100 });
  });

  it('only the immediate parent counts, not the grandparent', () => {
    bind([
      mk('g', null, { kind: 'frame', x: 0, y: 0, w: 1000, h: 1000 }),
      mk('f', 'g', { kind: 'frame', x: 100, y: 100, w: 400, h: 300 }),
      mk('c', 'f'),
    ]);
    // grandparent right edge is 1000; world x near 997 must not snap from inside f
    const r = snapResize(box(150, 150, 847, 40), 'e', ctx({ parent: 'f', ignore: new Set(['c']) }));
    expect(r.lines).toEqual([]);
  });

  it('no parent snapping at root, and a deleted, hidden or ignored parent is skipped', () => {
    const { view, index } = bind([frame(), mk('c', 'f')]);
    const src = { view, index };
    expect(parentCandidate(src, null, new Set())).toBeNull();
    expect(parentCandidate(src, 'f', new Set(['f']))).toBeNull();
    expect(parentCandidate(src, 'f', new Set())?.box).toEqual({ x: 100, y: 100, w: 400, h: 300 });
    bind([{ ...frame(), hidden: true } as Shape, mk('c', 'f')]);
    expect(snapResize(box(150, 150, 348, 40), 'e', ctx({ parent: 'f', ignore: new Set(['c']) })).lines).toEqual([]);
  });

  it('parent beats nothing special: nearest line wins between sibling and parent', () => {
    bind([frame(), mk('c', 'f'), mk('s', 'f', { x: 380, y: 200, w: 10, h: 10 })]); // sibling world x 480..490
    const r = snapResize(box(150, 150, 331, 40), 'e', ctx({ parent: 'f', ignore: new Set(['c']) })); // east 481 -> 480 (d=-1) vs 500
    expect(r.dx).toBe(-1);
    expect(r.lines[0].at).toBe(480);
  });
});

describe('snapCreate', () => {
  it('snaps a point on both axes to a neighbour edge', () => {
    bind([mk('a', null, { x: 200, y: 300, w: 100, h: 100 })]);
    const r = snapCreate({ x: 298, y: 403 }, ctx());
    expect(r.dx).toBe(2);
    expect(r.dy).toBe(-3);
    expect(r.lines.map((l) => l.axis).sort()).toEqual(['x', 'y']);
  });

  it('draw start lands exactly on the bottom edge; far corner snaps to the right edge', () => {
    bind([mk('a', null, { x: 200, y: 300, w: 100, h: 100 })]);
    const start = snapCreate({ x: 1000, y: 402 }, ctx());
    expect(start).toMatchObject({ dx: 0, dy: -2 });
    resetResizeSnapMemory();
    const corner = snapCreate({ x: 297, y: 900 }, ctx());
    expect(corner).toMatchObject({ dx: 3, dy: 0 });
  });

  it('snaps to a centre line and respects threshold', () => {
    bind([mk('a', null, { x: 200, y: 300, w: 100, h: 100 })]);
    expect(snapCreate({ x: 252, y: 9000 }, ctx()).lines[0]).toMatchObject({ axis: 'x', at: 250, kind: 'center' });
    resetResizeSnapMemory();
    expect(snapCreate({ x: 244, y: 9000 }, ctx()).lines).toEqual([]);
  });

  it('snaps to the parent frame edges and centre, and does nothing unbound', () => {
    expect(snapCreate({ x: 1, y: 1 }, ctx())).toEqual({ dx: 0, dy: 0, lines: [], gaps: [] });
    bind([mk('f', null, { kind: 'frame', x: 100, y: 100, w: 400, h: 300 })]);
    const r = snapCreate({ x: 302, y: 98 }, ctx({ parent: 'f' }));
    expect(r.dx).toBe(-2);
    expect(r.dy).toBe(2);
    expect(r.lines.find((l) => l.axis === 'x')).toMatchObject({ at: 300, from: 100, to: 400 });
  });

  it('threshold scales with zoom (10%: 50 world units)', () => {
    bind([mk('a', null, { x: 1000, y: 5000 })], { zoom: 0.1 });
    expect(snapCreate({ x: 955, y: 0 }, ctx({ thresholdWorld: 50 })).dx).toBe(45);
    resetResizeSnapMemory();
    expect(snapCreate({ x: 945, y: 0 }, ctx({ thresholdWorld: 50 })).dx).toBe(0);
  });
});
