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

import { classifyClipboardText, pasteText, uniqueName } from './clipboard';
describe('clipboard WP-78', () => {
  it('pastes into a selected frame at the same relative offset, parent set, one undo', () => {
    const [f, a] = make();
    const p = copyShapes(b, [a])!;
    const r = b.exec({ actor: H, opId: 'f2', commands: [{ t: 'shape.create', kind: 'frame', props: { name: 'B', x: 500, y: 0, w: 300, h: 300 } }] });
    const bid = r.results[0].ok ? r.results[0].id! : '';
    const res = pastePayload(b, p, { at: { x: 0, y: 0 }, intoFrame: bid });
    expect(res.ok).toBe(true);
    const s = b.doc.getState().shapes.get(res.ids[0])!;
    expect(s.parent).toBe(bid);
    expect([s.x, s.y]).toEqual([10, 20]);
    expect(f).toBeTruthy();
    b.undo(H);
    expect(b.doc.getState().shapes.get(res.ids[0])?.deleted ?? true).toBe(true);
  });
  it('clamps a fully outside offset back into the target frame', () => {
    make();
    const r = b.exec({ actor: H, opId: 'o', commands: [{ t: 'shape.create', kind: 'rect', props: { x: 900, y: 900, w: 50, h: 50 } }, { t: 'shape.create', kind: 'frame', props: { x: 0, y: 0, w: 100, h: 100 } }] });
    const [rid, fid] = r.results.map((x) => (x.ok ? x.id! : ''));
    const res = pastePayload(b, copyShapes(b, [rid])!, { intoFrame: fid });
    const s = b.doc.getState().shapes.get(res.ids[0])!;
    expect([s.x, s.y]).toEqual([50, 50]);
  });
  it('makes unique names', () => {
    expect(uniqueName('Card', new Set(['Card']))).toBe('Card copy');
    expect(uniqueName('Card', new Set(['Card', 'Card copy']))).toBe('Card copy 2');
    expect(uniqueName('Card', new Set(['x']))).toBe('Card');
  });
  it('classifies clipboard text', () => {
    expect(classifyClipboardText('  ').kind).toBe('empty');
    expect(classifyClipboardText('hello').kind).toBe('text');
    expect(classifyClipboardText(JSON.stringify({ format: 'contract-board-clip', v: 2, items: [] })).kind).toBe('newer');
    expect(classifyClipboardText('x'.repeat(5 * 1024 * 1024 + 1)).kind).toBe('toolarge');
    const [f] = make();
    expect(classifyClipboardText(serializePayload(copyShapes(b, [f])!)).kind).toBe('payload');
  });
  it('pastes text as a layer, truncates, replaces selected text, ignores blanks', () => {
    expect(pasteText(b, '   ', { at: { x: 0, y: 0 } }).ok).toBe(false);
    const r = pasteText(b, 'Hello\nworld', { at: { x: 40, y: 50 } });
    const s = b.doc.getState().shapes.get(r.id!)!;
    expect(s).toMatchObject({ kind: 'text', text: 'Hello\nworld', name: 'Hello', fontSize: 18, x: 40, y: 50 });
    const rep = pasteText(b, 'Bye', { at: { x: 0, y: 0 }, replace: r.id });
    expect(rep.replaced).toBe(true);
    expect(b.doc.getState().shapes.get(r.id!)!.text).toBe('Bye');
    const big = pasteText(b, 'a'.repeat(10001), { at: { x: 0, y: 0 } });
    expect(big.truncated).toBe(true);
    expect(b.doc.getState().shapes.get(big.id!)!.text!.length).toBe(10000);
    b.undo(H);
    expect(b.doc.getState().shapes.get(big.id!)?.deleted ?? true).toBe(true);
  });
});
