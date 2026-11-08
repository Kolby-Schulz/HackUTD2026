import { describe, expect, it } from 'vitest';
import { isSafeId, isScaffoldRequest, newComboId, normalizeLineage, scaffoldSource, serializeLineage, slugify, uniqueId } from './files.ts';

describe('ids', () => {
  it('accepts kebab ids and rejects paths', () => {
    expect(isSafeId('b2-playful')).toBe(true);
    for (const bad of ['', '../x', 'a/b', 'A', '-x', 'x'.repeat(49), 3]) expect(isSafeId(bad)).toBe(false);
  });

  it('slugs and de-duplicates', () => {
    expect(slugify('  Calm grid, v2! ')).toBe('calm-grid-v2');
    expect(slugify('!!!')).toBe('variant');
    expect(uniqueId('Calm', ['calm', 'calm-2'])).toBe('calm-3');
    expect(newComboId([], 0)).toBe('mix-0');
  });
});

describe('lineage.json', () => {
  it('drops malformed entries and keeps good ones', () => {
    const l = normalizeLineage({
      final: { landing: 'mix-1', '../x': 'a', pricing: 7 },
      combos: [
        { id: 'mix-1', screen: 'landing', title: 'One', parents: ['a', '../b'], picks: { nav: 'a', hero: '../evil' }, createdAt: 't' },
        { id: 'mix-1', screen: 'landing', picks: {} },
        { id: 'bad id', screen: 'landing', picks: {} },
        'nope',
      ],
    });
    expect(l).toEqual({ version: 1, boards: [], final: { landing: 'mix-1' }, combos: [{ id: 'mix-1', screen: 'landing', title: 'One', parents: ['a'], picks: { nav: 'a' }, createdAt: 't' }] });
    expect(normalizeLineage(null)).toEqual({ version: 1, combos: [], boards: [], final: {} });
  });

  it('keeps valid board links and drops bad ones', () => {
    const l = normalizeLineage({
      boards: [
        { id: 'pg-hero', screen: 'landing', title: 'Hero frame', boardId: 'playground', frameId: 's1', mode: 'live', importedAt: 't', shapes: [{ id: 'x' }] },
        { id: 'pg-copy', screen: 'landing', title: '', boardId: 'playground', frameId: 's2', mode: 'copy', importedAt: 't', shapes: [{ id: 's2' }, 7] },
        { id: 'pg-bad', screen: 'landing', boardId: 'playground', frameId: 's3', mode: 'mirror' },
        { id: '../x', screen: 'landing', boardId: 'playground', frameId: 's4', mode: 'live' },
      ],
    });
    expect(l.boards).toEqual([
      { id: 'pg-hero', screen: 'landing', title: 'Hero frame', boardId: 'playground', frameId: 's1', mode: 'live', importedAt: 't' },
      { id: 'pg-copy', screen: 'landing', title: 'pg-copy', boardId: 'playground', frameId: 's2', mode: 'copy', importedAt: 't', shapes: [{ id: 's2' }] },
    ]);
    expect(JSON.parse(serializeLineage(l)).boards).toHaveLength(2);
    expect(JSON.parse(serializeLineage({ ...l, boards: [] })).boards).toBeUndefined();
  });

  it('serialises in a stable order', () => {
    const c = (id: string, screen: string, createdAt: string) => ({ id, screen, title: id, parents: [], picks: {}, createdAt });
    const text = serializeLineage({ version: 1, boards: [], final: { z: 'a', b: 'c' }, combos: [c('m2', 'landing', '2'), c('m1', 'landing', '1'), c('m0', 'about', '9')] });
    const back = JSON.parse(text);
    expect(Object.keys(back)).toEqual(['version', 'final', 'combos']);
    expect(Object.keys(back.final)).toEqual(['b', 'z']);
    expect(back.combos.map((x: { id: string }) => x.id)).toEqual(['m0', 'm1', 'm2']);
    expect(text.endsWith('\n')).toBe(true);
  });
});

describe('scaffold', () => {
  const req = {
    screen: 'landing', id: 'evo', parent: 'mix-1', title: 'Evo "one"', note: 'try rounder',
    slots: [{ slot: 'nav', label: 'Top nav', from: 'a-bold', path: 'src/designs/landing/a-bold' }, { slot: 'cta', label: 'Primary button', from: null }],
  };

  it('validates requests', () => {
    expect(isScaffoldRequest(req)).toBe(true);
    expect(isScaffoldRequest({ ...req, id: '../x' })).toBe(false);
    expect(isScaffoldRequest({ ...req, slots: [{ slot: 'a b', label: '' }] })).toBe(false);
  });

  it('writes a child that extends its parent with no overrides', () => {
    const src = scaffoldSource(req);
    expect(src).toContain(`extends: "mix-1",`);
    expect(src).toContain(`title: "Evo \\"one\\"",`);
    expect(src).toContain(`note: "try rounder",`);
    expect(src).toContain('//   nav   Top nav         from a-bold  (src/designs/landing/a-bold)');
    expect(src).toContain('// cta: Cta,');
    expect(src).toContain(`import { defineVariant } from '../../../variants/define.ts';`);
  });
});
