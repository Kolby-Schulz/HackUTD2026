import { describe, expect, it } from 'vitest';
import { buildChildren } from '../core/tree';
import type { TreeView } from '../core/tree';
import type { Shape } from '../core/types';
import { createThreadStore } from './threads';

function mk(id: string, parent: string | null, o: Partial<Shape> = {}): Shape {
  return { id, kind: 'frame', parent, index: 'V', createdBy: 'a', name: id, x: 0, y: 0, w: 100, h: 100, fills: [], stamps: {}, ...o } as Shape;
}
function view(list: Shape[]): TreeView {
  const shapes = new Map(list.map((s) => [s.id, s]));
  return { shapes, children: buildChildren(shapes) };
}
const opt = { chat: 'iris', color: '#f0f' };

describe('comment threads', () => {
  const base = [mk('f', null, { x: 100, y: 50, w: 400, h: 400 }), mk('b', 'f', { x: 10, y: 20, w: 200, h: 100 })];

  it('anchors with fractions through absRect, follows moves and resizes', () => {
    const s = createThreadStore();
    const t = s.addOnLayer(view(base), 'b', { x: 160, y: 90 }, opt)!;
    expect(t.anchor).toMatchObject({ fx: 0.25, fy: 0.2 });
    expect(s.place(view(base), t.id)).toMatchObject({ x: 160, y: 90, orphan: false });
    const moved = view([mk('f', null, { x: 0, y: 0, w: 400, h: 400 }), mk('b', 'f', { x: 10, y: 20, w: 400, h: 200 })]);
    expect(s.place(moved, t.id)).toMatchObject({ x: 110, y: 60 });
  });

  it('point pins stay put', () => {
    const s = createThreadStore();
    const t = s.addAtPoint({ x: 5, y: 6 }, opt);
    expect(s.place(view(base), t.id)).toEqual({ x: 5, y: 6, orphan: false, hidden: false });
  });

  it('orphans at the last position when the layer or its frame is deleted; undo re-anchors', () => {
    const s = createThreadStore();
    const t = s.addOnLayer(view(base), 'b', { x: 160, y: 90 }, opt)!;
    s.place(view(base), t.id);
    const gone = view([mk('f', null, { x: 100, y: 50, w: 400, h: 400, deleted: true }), mk('b', 'f', { x: 10, y: 20, w: 200, h: 100 })]);
    expect(s.place(gone, t.id)).toEqual({ x: 160, y: 90, orphan: true, hidden: false });
    expect(s.place(view(base), t.id)).toMatchObject({ x: 160, y: 90, orphan: false });
    s.resolveOrphans(gone);
    expect(s.get(t.id)!.state).toBe('resolved');
  });

  it('hidden layer hides the pin', () => {
    const s = createThreadStore();
    const t = s.addOnLayer(view(base), 'b', { x: 160, y: 90 }, opt)!;
    const h = view([base[0], mk('b', 'f', { x: 10, y: 20, w: 200, h: 100, hidden: true })]);
    expect(s.place(h, t.id)!.hidden).toBe(true);
  });

  it('replies, resolve, reopen; reply on resolved reopens', () => {
    const s = createThreadStore();
    const t = s.addAtPoint({ x: 0, y: 0 }, opt);
    s.reply(t.id, { from: 'you', name: 'You', color: '#000', text: 'hi' });
    s.markAnswered(t.id);
    expect(s.get(t.id)!.state).toBe('answered');
    s.resolve(t.id);
    expect(s.get(t.id)!.state).toBe('resolved');
    s.reopen(t.id);
    expect(s.get(t.id)!.state).toBe('open');
    s.resolve(t.id);
    s.reply(t.id, { from: 'you', name: 'You', color: '#000', text: 'again' });
    expect(s.get(t.id)!.state).toBe('open');
    expect(s.get(t.id)!.messages).toHaveLength(2);
  });

  it('discardEmpty, anchorTo, JSON round trip keeps numbers stable', () => {
    const s = createThreadStore();
    const a = s.addAtPoint({ x: 150, y: 100 }, opt);
    const b = s.addAtPoint({ x: 1, y: 1 }, opt);
    s.reply(a.id, { from: 'you', name: 'You', color: '#000', text: 'x' });
    s.discardEmpty();
    expect(s.list().map((t) => t.id)).toEqual([a.id]);
    s.anchorTo(view(base), a.id, 'f');
    expect(s.get(a.id)!.anchor).toMatchObject({ kind: 'layer', shapeId: 'f', fx: 0.125, fy: 0.125 });
    const s2 = createThreadStore();
    s2.load(JSON.parse(JSON.stringify(s.toJSON())));
    expect(s2.list()).toEqual(s.list());
    expect(s2.addAtPoint({ x: 0, y: 0 }, opt).n).toBe(b.n + 1);
  });
});

describe('comment list filters and re-anchor', () => {
  const v = view([mk('f', null, { w: 400, h: 400 }), mk('b', 'f', { x: 10, y: 20, w: 200, h: 100 })]);
  it('filters combine and orphans re-anchor', () => {
    const s = createThreadStore();
    const a = s.addOnLayer(v, 'b', { x: 20, y: 30 }, { chat: 'iris', color: '#f0f' })!;
    const b = s.addAtPoint({ x: 5, y: 5 }, { chat: 'juno', color: '#0ff' });
    s.reply(a.id, { from: 'you', name: 'Me', color: '#000', text: 'hi' });
    s.resolve(b.id);
    expect(s.filter({ state: 'open' }).map((t) => t.id)).toEqual([a.id]);
    expect(s.filter({ state: 'resolved' }).map((t) => t.id)).toEqual([b.id]);
    expect(s.filter({ mine: true, agents: ['juno'] })).toEqual([]);
    const gone = view([mk('f', null, { w: 400, h: 400 }), mk('b', 'f', { x: 10, y: 20, w: 200, h: 100, deleted: true })]);
    expect(s.filter({ orphaned: true }, gone).map((t) => t.id)).toEqual([a.id]);
    expect(s.place(gone, a.id)?.orphan).toBe(true);
    expect(s.reanchor(gone, a.id, 'f', { x: 100, y: 100 })).toBe(true);
    expect(s.place(gone, a.id)).toMatchObject({ x: 100, y: 100, orphan: false });
  });
});
