import { describe, expect, it } from 'vitest';
import { buildGraph, childrenOf, comboTitle, makeCombo, parentsOf, problems, resolveAll, resolveSlot, singleSource, treeRows, withNode } from './model.ts';
import type { CodeInfo } from './model.ts';
import type { Combo } from './types.ts';

const SLOTS = ['nav', 'hero', 'cta', 'grid', 'footer'];
const ALL = [...SLOTS];
const code: CodeInfo[] = [
  { id: 'a-bold', title: 'Bold', own: ALL },
  { id: 'b-calm', title: 'Calm', own: ALL },
  { id: 'b2-playful', title: 'Playful', extends: 'b-calm', own: ['cta', 'grid'] },
];
const mix = (id: string, picks: Record<string, string>, createdAt = '2026-11-08T10:00:00.000Z'): Combo => ({
  id, screen: 'landing', title: id, parents: parentsOf(SLOTS, picks), picks, createdAt,
});
const AB = { nav: 'a-bold', hero: 'b-calm', cta: 'a-bold', grid: 'b-calm', footer: 'b-calm' };

describe('resolution', () => {
  const g = buildGraph('landing', SLOTS, code, [mix('mix-1', AB)]);

  it('a code variant renders its own slots', () => {
    expect(resolveSlot(g, 'a-bold', 'nav')).toBe('a-bold');
  });

  it('a child inherits unfilled slots from the variant it extends', () => {
    expect(resolveAll(g, 'b2-playful').sources).toEqual({ nav: 'b-calm', hero: 'b-calm', cta: 'b2-playful', grid: 'b2-playful', footer: 'b-calm' });
  });

  it('a mix takes each slot from its pick', () => {
    expect(resolveAll(g, 'mix-1')).toEqual({ sources: AB, missing: [] });
  });

  it('a code child of a mix starts from the mix', () => {
    const g2 = buildGraph('landing', SLOTS, [...code, { id: 'evo', title: 'Evo', extends: 'mix-1', own: ['hero'] }], [mix('mix-1', AB)]);
    expect(resolveAll(g2, 'evo').sources).toEqual({ ...AB, hero: 'evo' });
  });

  it('a mix of mixes resolves through both', () => {
    const g2 = buildGraph('landing', SLOTS, code, [
      mix('mix-1', AB),
      mix('mix-2', { nav: 'mix-1', hero: 'mix-1', cta: 'b2-playful', grid: 'b2-playful', footer: 'a-bold' }, '2026-11-08T11:00:00.000Z'),
    ]);
    expect(resolveAll(g2, 'mix-2').sources).toEqual({ nav: 'a-bold', hero: 'b-calm', cta: 'b2-playful', grid: 'b2-playful', footer: 'a-bold' });
  });

  it('cycles and gaps resolve to null and are reported', () => {
    const g2 = buildGraph('landing', SLOTS, [
      { id: 'x', title: 'X', extends: 'y', own: ['nav'] },
      { id: 'y', title: 'Y', extends: 'x', own: [] },
    ], []);
    expect(resolveSlot(g2, 'y', 'nav')).toBe('x');
    expect(resolveSlot(g2, 'y', 'hero')).toBeNull();
    expect(problems(g2).some((p) => p.startsWith('x: nothing fills'))).toBe(true);
  });

  it('flags unknown parents and picks', () => {
    const g2 = buildGraph('landing', SLOTS, [{ id: 'z', title: 'Z', extends: 'gone', own: ALL }], [mix('mix-9', { ...AB, nav: 'gone' })]);
    expect(problems(g2)).toEqual(expect.arrayContaining(['z: parent "gone" does not exist', 'mix-9: slot "nav" comes from missing "gone"']));
  });

  it('ignores mixes for other screens, and code wins an id clash', () => {
    const other = { ...mix('mix-x', AB), screen: 'pricing' };
    const clash = mix('a-bold', AB);
    const g2 = buildGraph('landing', SLOTS, code, [other, clash]);
    expect(g2.nodes.has('mix-x')).toBe(false);
    expect(g2.nodes.get('a-bold')!.kind).toBe('code');
  });

  it('withNode previews a draft without touching the graph', () => {
    const draft = withNode(g, { id: '~draft', kind: 'combo', title: 'draft', parents: ['a-bold'], own: [], picks: { ...AB, grid: 'b2-playful' } });
    expect(resolveSlot(draft, '~draft', 'grid')).toBe('b2-playful');
    expect(g.nodes.has('~draft')).toBe(false);
  });
});

describe('mix creation', () => {
  const g = buildGraph('landing', SLOTS, code, []);

  it('orders parents by how many slots they give', () => {
    expect(parentsOf(SLOTS, AB)).toEqual(['b-calm', 'a-bold']);
    expect(parentsOf(SLOTS, { nav: 'a-bold', hero: 'b-calm' })).toEqual(['a-bold', 'b-calm']);
  });

  it('detects a pick that is really just one variant', () => {
    expect(singleSource(SLOTS, Object.fromEntries(SLOTS.map((s) => [s, 'a-bold'])))).toBe('a-bold');
    expect(singleSource(SLOTS, AB)).toBeNull();
    expect(singleSource(SLOTS, { nav: 'a-bold' })).toBeNull();
  });

  it('builds a titled mix with every slot', () => {
    const c = makeCombo(g, AB, { id: 'mix-1', now: new Date('2026-11-08T12:00:00Z') });
    expect(c).toEqual({ id: 'mix-1', screen: 'landing', title: 'Calm: hero, grid, footer · Bold: nav, cta', parents: ['b-calm', 'a-bold'], picks: AB, createdAt: '2026-11-08T12:00:00.000Z' });
    expect(makeCombo(g, AB, { id: 'm', title: '  Final  ', note: ' ok ' })).toMatchObject({ title: 'Final', note: 'ok' });
    expect(comboTitle(g, { nav: 'a-bold' })).toBe('Bold: nav');
    expect(comboTitle(g, { nav: 'a-bold', cta: 'a-bold' }, { nav: 'Top nav', cta: 'Primary button' })).toBe('Bold: Top nav, Primary button');
  });
});

describe('tree', () => {
  it('nests children under their first parent and lists other parents as extras', () => {
    const g = buildGraph('landing', SLOTS, code, [mix('mix-1', AB)]);
    expect(treeRows(g)).toEqual([
      { id: 'a-bold', depth: 0, extra: [] },
      { id: 'b-calm', depth: 0, extra: [] },
      { id: 'b2-playful', depth: 1, extra: [] },
      { id: 'mix-1', depth: 1, extra: ['a-bold'] },
    ]);
    expect(childrenOf(g, 'a-bold')).toEqual(['mix-1']);
    expect(childrenOf(g, 'mix-1')).toEqual([]);
  });

  it('still lists every node when parents form a cycle', () => {
    const g = buildGraph('landing', SLOTS, [{ id: 'x', title: 'X', extends: 'y', own: ALL }, { id: 'y', title: 'Y', extends: 'x', own: ALL }], []);
    expect(treeRows(g).map((r) => r.id).sort()).toEqual(['x', 'y']);
  });
});
