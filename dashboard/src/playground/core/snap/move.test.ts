import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { snapMove } from '../snap';
import type { SnapCtx } from '../snap';
import { SpatialIndex } from '../spatial';
import { buildChildren } from '../tree';
import type { TreeView } from '../tree';
import type { Rect, Shape } from '../types';
import { bindSnapSource } from './candidates';
import { resetSnapMemory } from './move';

function mk(id: string, parent: string | null, o: Partial<Shape> = {}): Shape {
  return { id, kind: 'rect', parent, index: 'V', createdBy: 'human-you', name: id, x: 0, y: 0, w: 100, h: 100, fills: [], stamps: {}, ...o } as Shape;
}
function bind(list: Shape[], extra: { zoom?: number; viewport?: Rect; round?: boolean } = {}) {
  const shapes = new Map(list.map((s) => [s.id, s]));
  const view: TreeView = { shapes, children: buildChildren(shapes) };
  const index = new SpatialIndex();
  index.rebuild(view);
  bindSnapSource({
    view, index,
    viewport: extra.viewport ? () => extra.viewport! : undefined,
    zoom: () => extra.zoom ?? 1,
    round: () => extra.round ?? true,
  });
}
const ctx = (o: Partial<SnapCtx> = {}): SnapCtx => ({ actor: 'human-you', ignore: new Set(), thresholdWorld: 5, parent: null, ...o });
const box = (x: number, y: number, w = 50, h = 50): Rect => ({ x, y, w, h });

beforeEach(() => resetSnapMemory());
afterEach(() => bindSnapSource(null));

describe('snapMove', () => {
  it('does nothing when unbound or there are no candidates', () => {
    expect(snapMove(box(0, 0), ctx())).toEqual({ dx: 0, dy: 0, lines: [], gaps: [] });
    bind([]);
    expect(snapMove(box(0, 0), ctx()).lines).toEqual([]);
  });

  it('snaps left edge to left edge (3 px yes, 8 px no at zoom 1)', () => {
    bind([mk('a', null, { x: 200, y: 0 })]);
    const r = snapMove(box(197, 1000), ctx());
    expect(r.dx).toBe(3);
    expect(r.dy).toBe(0);
    expect(snapMove(box(192, 1000), ctx(({ thresholdWorld: 5 })))).toMatchObject({ dx: 0, lines: [] });
  });

  it('snaps edge to opposite edge (right to left)', () => {
    bind([mk('a', null, { x: 200, y: 0 })]);
    const r = snapMove(box(147, 500), ctx()); // right edge 197 -> 200
    expect(r.dx).toBe(3);
    expect(r.lines[0]).toMatchObject({ axis: 'x', at: 200, kind: 'edge' });
  });

  it('snaps center to center', () => {
    bind([mk('a', null, { x: 200, y: 200, w: 100, h: 100 })]); // center 250,250
    const r = snapMove(box(222, 2000), ctx()); // center 247
    expect(r.dx).toBe(3);
    expect(r.lines[0]).toMatchObject({ axis: 'x', at: 250, kind: 'center' });
  });

  it('axes snap independently and both produce coincident guides', () => {
    bind([mk('a', null, { x: 200, y: 300 })]);
    const r = snapMove(box(198, 304), ctx());
    expect(r.dx).toBe(2);
    expect(r.dy).toBe(-4);
    expect(r.lines.map((l) => l.axis).sort()).toEqual(['x', 'y']);
    const only = snapMove(box(198, 900), ctx());
    expect(only.dx).toBe(2);
    expect(only.dy).toBe(0);
    expect(only.lines).toHaveLength(1);
  });

  it('nearest candidate wins; ties go to the closer shape', () => {
    bind([mk('far', null, { x: 204, y: 0 }), mk('near', null, { x: 202, y: 5000 })]);
    expect(snapMove(box(200, 3000), ctx()).dx).toBe(2);
    // equal distance both sides: choose the vertically closer shape
    bind([mk('up', null, { x: 198, y: 0 }), mk('down', null, { x: 202, y: 800 })]);
    expect(snapMove(box(200, 700), ctx()).dx).toBe(2);
    resetSnapMemory();
    expect(snapMove(box(200, 100), ctx()).dx).toBe(-2);
  });

  it('guide extent spans the moving box and every coincident candidate', () => {
    bind([mk('a', null, { x: 200, y: 0, h: 100 }), mk('b', null, { x: 200, y: 400, h: 50 })]);
    const r = snapMove(box(198, 200), ctx());
    expect(r.lines).toEqual([{ axis: 'x', at: 200, from: 0, to: 450, kind: 'edge' }]);
  });

  it('threshold is world units: 5px at zoom 0.1 = 50 units, at zoom 5 = 1 unit', () => {
    bind([mk('a', null, { x: 1000, y: 0 })]);
    expect(snapMove(box(955, 9000, 2, 2), ctx({ thresholdWorld: 5 / 0.1 })).dx).toBe(43);
    expect(snapMove(box(945, 9000, 2, 2), ctx({ thresholdWorld: 5 / 0.1 })).dx).toBe(0);
    expect(snapMove(box(999.2, 9000), ctx({ thresholdWorld: 1 })).dx).toBeCloseTo(0.8, 9);
    resetSnapMemory();
    expect(snapMove(box(998, 9000), ctx({ thresholdWorld: 1 })).dx).toBe(0);
    // agents: 2 world units regardless of zoom
    expect(snapMove(box(998, 9000), ctx({ actor: 'agent-k3f9', thresholdWorld: 2 })).dx).toBe(2);
    expect(snapMove(box(997, 9000), ctx({ actor: 'agent-k3f9', thresholdWorld: 2 })).dx).toBe(0);
  });

  it('hysteresis: a held snap survives threshold + 2 screen px, then releases', () => {
    bind([mk('a', null, { x: 200, y: 0 })], { zoom: 1 });
    expect(snapMove(box(197, 900), ctx()).dx).toBe(3);        // engage
    expect(snapMove(box(193, 900), ctx()).dx).toBe(7);        // 7 away: within 5 + 2
    expect(snapMove(box(192, 900), ctx()).dx).toBe(0);        // 8 away: released
    expect(snapMove(box(193, 900), ctx()).dx).toBe(0);        // not engaged again until inside threshold
    expect(snapMove(box(196, 900), ctx()).dx).toBe(4);
  });

  it('hysteresis margin scales with zoom (2 screen px)', () => {
    bind([mk('a', null, { x: 200, y: 0 })], { zoom: 0.5 });
    const c = ctx({ thresholdWorld: 10 });
    bind([mk('a', null, { x: 200, y: 0, w: 1000 })], { zoom: 0.5 });
    expect(snapMove(box(195, 900, 40, 40), c).dx).toBe(5);
    expect(snapMove(box(187, 900, 40, 40), c).dx).toBe(13); // held: 10 + 2/0.5 = 14
    expect(snapMove(box(185, 900, 40, 40), c).dx).toBe(-5); // released from the edge; a fresh center snap wins
  });

  it('agents have no hysteresis; reset clears it', () => {
    bind([mk('a', null, { x: 200, y: 0 })]);
    const ag = ctx({ actor: 'agent-1', thresholdWorld: 2 });
    expect(snapMove(box(198, 900), ag).dx).toBe(2);
    expect(snapMove(box(196, 900), ag).dx).toBe(0);
    snapMove(box(197, 900), ctx());
    resetSnapMemory('human-you');
    expect(snapMove(box(193, 900), ctx()).dx).toBe(0);
  });

  it('excludes the moving set and its descendants, deleted, hidden, zero-size and non-siblings', () => {
    bind([
      mk('self', null, { x: 200, y: 0 }),
      mk('kid', 'self', { x: 0, y: 0 }),
      mk('gone', null, { x: 200, y: 0, deleted: true }),
      mk('hid', null, { x: 200, y: 0, hidden: true }),
      mk('zero', null, { x: 200, y: 0, w: 0, h: 0 }),
      mk('frame', null, { x: 5000, y: 5000, w: 900, h: 900 }),
      mk('inner', 'frame', { x: 300, y: 0 }),
    ]);
    const r = snapMove(box(197, 9000), ctx({ ignore: new Set(['self']) }));
    expect(r).toEqual({ dx: 0, dy: 0, lines: [], gaps: [] });
    // root move ignores frame children (not siblings); a move inside the frame sees them
    expect(snapMove(box(5303, 9000), ctx({ ignore: new Set(['self']) })).dx).toBe(0);
    resetSnapMemory();
    expect(snapMove(box(5303, 9000), ctx({ ignore: new Set(['self']), parent: 'frame' })).dx).toBe(-3);
  });

  it('descendants of an ignored shape are not candidates even if reported by the index', () => {
    bind([mk('p', null, { x: 0, y: 0, w: 10, h: 10 }), mk('c', 'p', { x: 300, y: 0 })]);
    expect(snapMove(box(297, 50), ctx({ ignore: new Set(['p']), parent: 'p' })).dx).toBe(0);
    expect(snapMove(box(297, 50), ctx({ parent: 'p' })).dx).toBe(3);
  });

  it('snaps moves to the parent frame edges and centre, never to a grandparent', () => {
    bind([
      mk('gp', null, { x: 0, y: 0, w: 1000, h: 1000 }),
      mk('fr', 'gp', { x: 100, y: 100, w: 400, h: 300 }),
      mk('kid', 'fr', { x: 10, y: 10, w: 50, h: 50 }),
    ]);
    // left edge near the frame's left edge (world 100)
    expect(snapMove(box(103, 250), ctx({ ignore: new Set(['kid']), parent: 'fr' })).dx).toBe(-3);
    resetSnapMemory();
    // right edge near the frame's right edge (world 500)
    expect(snapMove(box(447, 250), ctx({ ignore: new Set(['kid']), parent: 'fr' })).dx).toBe(3);
    resetSnapMemory();
    // centre near the frame centre x=300
    const c = snapMove(box(273, 250), ctx({ ignore: new Set(['kid']), parent: 'fr' }));
    expect(c.dx).toBe(2);
    expect(c.lines[0]).toMatchObject({ axis: 'x', at: 300 });
    resetSnapMemory();
    // the grandparent's edge (x=0 / x=1000) is not a candidate
    expect(snapMove(box(997, 600), ctx({ ignore: new Set(['kid']), parent: 'fr' })).dx).toBe(0);
  });

  it('restricts candidates to the viewport', () => {
    bind([mk('in', null, { x: 100, y: 0 }), mk('out', null, { x: 5000, y: 0 })], { viewport: { x: 0, y: 0, w: 1000, h: 800 } });
    expect(snapMove(box(5003, 20), ctx()).dx).toBe(0);
    expect(snapMove(box(103, 20), ctx()).dx).toBe(-3);
  });

  it('multi-selection snaps by its union box', () => {
    bind([mk('a', null, { x: 200, y: 0 })]);
    const union = box(198, 600, 300, 120); // spans three shapes
    expect(snapMove(union, ctx()).dx).toBe(2);
  });

  it('rounds to integers when rounding is on, leaves fractions when off', () => {
    bind([mk('a', null, { x: 200.4, y: 0 })], { round: true });
    const r = snapMove(box(197.3, 900), ctx());
    expect(Number.isInteger(197.3 + r.dx)).toBe(true);
    expect(197.3 + r.dx).toBe(200);
    expect(r.lines[0].at).toBe(200);
    bind([mk('a', null, { x: 200.4, y: 0 })], { round: false });
    const f = snapMove(box(197.3, 900), ctx());
    expect(197.3 + f.dx).toBeCloseTo(200.4, 9);
  });

  it('clamps the center threshold for small moving shapes', () => {
    bind([mk('a', null, { x: 0, y: 0, w: 1000, h: 1000 })]);
    // 8x8 box: center clamp = 2; box center is 4 away from a's center line 500 -> no center snap
    expect(snapMove({ x: 496, y: 3000, w: 8, h: 8 }, ctx({ thresholdWorld: 5 })).dx).toBe(0);
    expect(snapMove({ x: 497, y: 3000, w: 8, h: 8 }, ctx({ thresholdWorld: 5 })).dx).toBe(-1);
  });

  it('rejects bad input safely', () => {
    bind([mk('a', null, { x: 200 })]);
    expect(snapMove({ x: NaN, y: 0, w: 5, h: 5 }, ctx()).lines).toEqual([]);
    expect(snapMove(box(197, 0), ctx({ thresholdWorld: 0 })).dx).toBe(0);
  });

  it('matches a brute-force reference and stays fast with 2,000 candidates', () => {
    let seed = 11;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const list = Array.from({ length: 2000 }, (_, i) =>
      mk(`s${i}`, null, { x: Math.round(rnd() * 8000), y: Math.round(rnd() * 8000), w: 20 + Math.round(rnd() * 100), h: 20 + Math.round(rnd() * 100) }));
    bind(list, { viewport: { x: 0, y: 0, w: 8200, h: 8200 } });
    const t = 5;
    for (let i = 0; i < 50; i++) {
      const b = box(rnd() * 8000, rnd() * 8000, 40, 30);
      resetSnapMemory();
      const r = snapMove(b, ctx({ thresholdWorld: t }));
      // brute force on x with integer rounding off equivalence: smallest |d| over 3x3 lines
      let bestD = Infinity;
      for (const s of list) for (const c of [s.x, s.x + s.w / 2, s.x + s.w]) for (const [k, lim] of [[0, t], [20, Math.min(t, 0.25 * 30)], [40, t]] as const) {
        const d = c - (b.x + k);
        if (Math.abs(d) <= lim && Math.abs(d) < Math.abs(bestD)) bestD = d;
      }
      if (bestD === Infinity) expect(r.dx).toBe(0);
      else expect(Math.abs(b.x + r.dx - Math.round(b.x + bestD))).toBeLessThan(1e-9);
    }
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) snapMove(box(rnd() * 8000, rnd() * 8000, 40, 30), ctx());
    expect((performance.now() - t0) / 200).toBeLessThan(5);
  });
});
