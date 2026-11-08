import { describe, expect, it } from 'vitest';
import { boardFromShapes, boardNode, listFrames, matchSlots, parseBoard, PLAYGROUND_AVAILABLE, snapshot } from './boards.ts';
import type { BoardRef } from './types.ts';

const shape = (id: string, kind: string, parent: string | null, index: string, extra: Record<string, unknown> = {}) => ({
  id, kind, parent, index, name: id, x: 0, y: 0, w: 100, h: 50, fills: [], createdBy: 'agent-iris', stamps: {}, ...extra,
});
const SHAPES = [
  shape('f1', 'frame', null, 'a0', { name: 'Landing v3', w: 1280, h: 900 }),
  shape('nav', 'frame', 'f1', 'a0', { name: 'Top nav' }),
  shape('hero', 'frame', 'f1', 'a1', { name: 'HERO' }),
  shape('t1', 'text', 'hero', 'a0', { text: 'Hi' }),
  shape('misc', 'rect', 'f1', 'a2', { name: 'Decoration' }),
  shape('gone', 'rect', 'f1', 'a3', { name: 'Footer', deleted: true }),
  shape('f2', 'frame', null, 'a1', { name: 'Mobile card', w: 390, h: 600 }),
  shape('loose', 'rect', null, 'a2'),
];
const SLOTS = { nav: 'Top nav', hero: 'Hero', footer: 'Footer' };
const save = (shapes: unknown[]) => JSON.stringify({ format: 'contract-board', v: 1, boardId: 'playground', meta: { name: 'Board' }, savedAt: 5, lamport: 1, seq: {}, shapes });

// Parsing uses the playground's own core/persist.ts, which only exists where the board is in the build.
describe.skipIf(!PLAYGROUND_AVAILABLE)('reading the playground save', () => {
  it('parses a save, drops tombstones and orders children', () => {
    const b = parseBoard(save(SHAPES))!;
    expect(b.savedAt).toBe(5);
    expect(b.shapes.has('gone')).toBe(false);
    expect(b.kids.get('f1')).toEqual(['nav', 'hero', 'misc']);
    expect(parseBoard(null)).toBeNull();
    expect(parseBoard('{not json')).toBeNull();
  });

  it('lists only top-level frames', () => {
    const b = parseBoard(save(SHAPES))!;
    expect(listFrames(b)).toEqual([
      { id: 'f1', name: 'Landing v3', w: 1280, h: 900, layers: 4, author: 'agent-iris' },
      { id: 'f2', name: 'Mobile card', w: 390, h: 600, layers: 0, author: 'agent-iris' },
    ]);
  });
});

describe.skipIf(PLAYGROUND_AVAILABLE)('without the playground in the build', () => {
  it('stays dormant: nothing to read', () => {
    expect(parseBoard(save(SHAPES))).toBeNull();
  });
});

describe('frames as designs', () => {
  const b = boardFromShapes('playground', SHAPES);

  it('matches child layers to parts by name or label, ignoring case and spaces', () => {
    expect(matchSlots(b, 'f1', SLOTS)).toEqual({ nav: 'nav', hero: 'hero' });
    expect(matchSlots(b, 'f2', SLOTS)).toEqual({});
  });

  it('snapshots a frame with its descendants and no edit stamps', () => {
    const snap = snapshot(b, 'f1');
    expect(snap.map((s) => s.id)).toEqual(['f1', 'nav', 'hero', 't1', 'misc']);
    expect(snap.every((s) => !('stamps' in s))).toBe(true);
    expect(snapshot(b, 'nope')).toEqual([]);
  });

  it('builds graph nodes for live links, copies, and missing frames', () => {
    const ref = (over: Partial<BoardRef>): BoardRef => ({ id: 'pg-1', screen: 'landing', title: 'Landing v3', boardId: 'playground', frameId: 'f1', mode: 'live', importedAt: 't', ...over });
    const live = boardNode(ref({}), b, SLOTS);
    expect(live.info).toMatchObject({ own: ['nav', 'hero'], source: 'live', whole: false });
    const whole = boardNode(ref({ frameId: 'f2' }), b, SLOTS);
    expect(whole.info.whole).toBe(true);
    const deleted = boardNode(ref({ frameId: 'zzz' }), b, SLOTS);
    expect(deleted.frame).toBeNull();
    expect(deleted.info.note).toMatch(/deleted/);
    const copy = boardNode(ref({ mode: 'copy', shapes: snapshot(b, 'f1') }), null, SLOTS);
    expect(copy.info).toMatchObject({ own: ['nav', 'hero'], source: 'copy' });
    expect(boardNode(ref({}), null, SLOTS).info.note).toMatch(/no playground board/);
  });
});
