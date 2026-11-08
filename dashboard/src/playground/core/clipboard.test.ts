import { beforeEach, describe, expect, it } from 'vitest';
import { copyShapes, parsePayload, pastePayload, serializePayload } from './clipboard';
import { createBoard } from './commands';
import type { BoardKit } from './commands';
import { resetSeqs } from './ids';
import { absRect } from './tree';

const H = 'human-you';
let b: BoardKit;
const live = () => [...b.doc.getState().shapes.values()].filter((s) => !s.deleted);
const make = () => {
  const r = b.exec({ actor: H, opId: 'seed', commands: [
    { t: 'shape.create', kind: 'frame', props: { name: 'Card', x: 100, y: 100, w: 200, h: 200 } },
    { t: 'shape.create', kind: 'rect', props: { name: 'A', x: 10, y: 20, w: 50, h: 50 }, parent: '$0' },
    { t: 'shape.create', kind: 'rect', props: { name: 'B', x: 70, y: 80, w: 50, h: 50 }, parent: '$0' },
  ] });
  return r.results.map((x) => (x.ok ? x.id! : ''));
};

beforeEach(() => { resetSeqs(); b = createBoard(); });

describe('clipboard', () => {
  it('pastes a frame subtree with new ids, same structure and relative positions', () => {
    const [f, a, c] = make();
    const p = copyShapes(b, [f])!;
    const r = pastePayload(b, p, { at: { x: 1000, y: 1000 } });
    expect(r.ok).toBe(true);
    expect(live().length).toBe(6);
    const st = b.doc.getState();
    const nf = r.ids[0];
    expect([f, a, c]).not.toContain(nf);
    const kids = st.children.get(nf)!;
    expect(kids.length).toBe(2);
    expect(kids.map((k) => st.shapes.get(k)!.name)).toEqual(['A', 'B']);
    expect(st.shapes.get(kids[0])!.x).toBe(10);
    expect(st.shapes.get(kids[1])!.y).toBe(80);
    const box = absRect(st, nf)!; // centered on the pointer
    expect(box.x + box.w / 2).toBe(1000);
    expect(box.y + box.h / 2).toBe(1000);
    expect(st.shapes.get(nf)!.name).toBe('Card copy');
  });

  it('paste in place lands on the source; one undo removes the whole paste', () => {
    const [f] = make();
    const p = copyShapes(b, [f])!;
    const r = pastePayload(b, p, { inPlace: true });
    const box = absRect(b.doc.getState(), r.ids[0])!;
    expect([box.x, box.y]).toEqual([100, 100]);
    expect(b.undo(H)).toBe(true);
    expect(live().length).toBe(3);
  });

  it('consecutive pastes at the same anchor stack by +16', () => {
    const [f] = make();
    const p = copyShapes(b, [f])!;
    const a = pastePayload(b, p, { at: { x: 500, y: 500 } }).ids[0];
    const c = pastePayload(b, p, { at: { x: 500, y: 500 } }).ids[0];
    const st = b.doc.getState();
    expect(absRect(st, c)!.x - absRect(st, a)!.x).toBe(16);
  });

  it('pastes into the frame under the pointer, keeping the world position', () => {
    const [f, , c] = make();
    const p = copyShapes(b, [c])!; // B, 50x50
    const r = pastePayload(b, p, { at: { x: 200, y: 200 } });
    const st = b.doc.getState();
    expect(st.shapes.get(r.ids[0])!.parent).toBe(f);
    const box = absRect(st, r.ids[0])!;
    expect([box.x + 25, box.y + 25]).toEqual([200, 200]);
  });

  it('copy skips children of a copied ancestor and ignores empty selection', () => {
    const [f, a] = make();
    expect(copyShapes(b, [f, a])!.items.length).toBe(3);
    expect(copyShapes(b, [])).toBeNull();
  });

  it('round-trips through JSON and rejects junk', () => {
    const [f] = make();
    const p = copyShapes(b, [f])!;
    const q = parsePayload(serializePayload(p))!;
    expect(q.items.length).toBe(3);
    expect(parsePayload('hello')).toBeNull();
    expect(parsePayload(JSON.stringify({ format: 'contract-board-clip', v: 1, items: [{ kind: 'rect', parent: 5, props: {} }] }))).toBeNull();
  });
});
