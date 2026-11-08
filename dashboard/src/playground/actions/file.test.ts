import { beforeEach, describe, expect, it } from 'vitest';
import { createBoard } from '../core/commands';
import type { BoardKit } from '../core/commands';
import { resetSeqs } from '../core/ids';
import { MAX_IMPORT_BYTES, exportFileName, parseImport, toFileText } from '../core/persist';
import { applyImport } from './file';

const H = 'human-you';
let b: BoardKit;
let n = 0;
const run = (commands: any[]) => b.exec({ actor: H, opId: `op-${++n}`, commands });
const live = () => [...b.doc.getState().shapes.values()].filter((s) => !s.deleted);
const seed = () => run([
  { t: 'shape.create', kind: 'frame', props: { name: 'F', x: 10, y: 20, w: 200, h: 100 } },
  { t: 'shape.create', kind: 'rect', props: { name: 'R', x: 5, y: 6, w: 30, h: 40 }, parent: '$0' },
  { t: 'shape.create', kind: 'text', props: { name: 'T', x: 300, y: 0, w: 50, h: 20, text: 'hi' } },
]);
const fileOf = (board: BoardKit) => toFileText(JSON.stringify(board.doc.snapshot()));
const tree = (board: BoardKit) => {
  const st = board.doc.getState();
  return [...st.shapes.values()].filter((s) => !s.deleted).map((s) => `${s.kind}|${s.name}|${s.x}|${s.y}|${s.w}|${s.h}|${st.shapes.get(s.parent ?? '')?.name ?? '-'}`).sort();
};

beforeEach(() => { resetSeqs(); n = 0; b = createBoard(); });

describe('parseImport', () => {
  it('rejects garbage, wrong format, future versions and huge files', () => {
    expect(parseImport('nope')).toMatchObject({ ok: false });
    expect(parseImport('{"a":1}')).toMatchObject({ ok: false });
    expect(parseImport('{"format":"contract-board","v":99,"shapes":[]}')).toMatchObject({ ok: false, error: expect.stringContaining('newer') });
    expect(parseImport('{"format":"contract-board","v":1}')).toMatchObject({ ok: false });
    expect(parseImport('{}', MAX_IMPORT_BYTES + 1)).toMatchObject({ ok: false, error: expect.stringContaining('too large') });
    expect(parseImport('{"format":"contract-board","v":1,"shapes":[]}')).toMatchObject({ ok: false });
  });
  it('drops damaged and tombstoned shapes', () => {
    const text = JSON.stringify({ format: 'contract-board', v: 1, shapes: [
      { id: 'a', kind: 'rect', x: 0, y: 0, w: 1, h: 1 }, { id: 'b', kind: 'nope', x: 0, y: 0, w: 1, h: 1 },
      { id: 'c', kind: 'rect', x: 0, y: 0, w: 1, h: 1, deleted: true }, { id: 'a', kind: 'rect', x: 0, y: 0, w: 1, h: 1 }] });
    const r = parseImport(text);
    expect(r.ok && r.shapes.map((s) => s.id)).toEqual(['a']);
    expect(r.ok && r.dropped).toBe(2);
  });
});

describe('exportFileName', () => {
  it('adds the date and extension and cleans the name', () => {
    expect(exportFileName('a/b', new Date('2026-01-02T00:00:00Z'))).toBe('a-b-2026-01-02.contract.json');
  });
});

describe('round trip', () => {
  it('replace into a clean board gives an identical tree, with new ids', () => {
    seed();
    const text = fileOf(b);
    const p = parseImport(text);
    if (!p.ok) throw new Error(p.error);
    const before = tree(b), oldIds = live().map((s) => s.id);
    const other = createBoard(); b = other;
    expect(applyImport(other, p.shapes, 'replace').created).toBe(3);
    expect(tree(other)).toEqual(before);
    expect(live().some((s) => oldIds.includes(s.id))).toBe(false);
  });
  it('replace is one undo step and restores the old board', () => {
    seed();
    const before = tree(b);
    const p = parseImport(JSON.stringify({ format: 'contract-board', v: 1, shapes: [{ id: 'z', kind: 'rect', name: 'Z', x: 0, y: 0, w: 9, h: 9 }] }));
    if (!p.ok) throw new Error(p.error);
    expect(applyImport(b, p.shapes, 'replace').ok).toBe(true);
    expect(tree(b)).toHaveLength(1);
    expect(b.undo(H)).toBe(true);
    expect(tree(b)).toEqual(before);
  });
  it('merge adds beside existing content without touching it', () => {
    seed();
    const p = parseImport(fileOf(b));
    if (!p.ok) throw new Error(p.error);
    const oldIds = live().map((s) => s.id);
    expect(applyImport(b, p.shapes, 'merge').created).toBe(3);
    expect(live()).toHaveLength(6);
    const added = live().filter((s) => !oldIds.includes(s.id) && s.parent === null);
    expect(Math.min(...added.map((s) => s.x))).toBeGreaterThanOrEqual(350 + 80);
    expect(b.undo(H)).toBe(true);
    expect(live()).toHaveLength(3);
  });
  it('orphans and parent loops become roots', () => {
    const p = parseImport(JSON.stringify({ format: 'contract-board', v: 1, shapes: [
      { id: 'a', kind: 'rect', parent: 'ghost', x: 0, y: 0, w: 1, h: 1 },
      { id: 'b', kind: 'frame', parent: 'c', x: 0, y: 0, w: 1, h: 1 }, { id: 'c', kind: 'frame', parent: 'b', x: 0, y: 0, w: 1, h: 1 }] }));
    if (!p.ok) throw new Error(p.error);
    expect(applyImport(b, p.shapes, 'replace').created).toBe(3);
  });
});
