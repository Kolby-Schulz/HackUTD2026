import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parentContext, parseScreen } from '../src/repo.ts';
import { variantId } from '../src/live.ts';

describe('screens', () => {
  it('reads the literal title and slots, one line or several', () => {
    expect(parseScreen('landing', `title: 'Landing page',\n  slots: { nav: 'Top nav', cta: "Primary button" },`))
      .toEqual({ id: 'landing', title: 'Landing page', slots: { nav: 'Top nav', cta: 'Primary button' } });
    expect(parseScreen('w', `title: "W",\nslots: {\n  side: 'Agents side bar',\n  map: 'Code map',\n},`).slots).toEqual({ side: 'Agents side bar', map: 'Code map' });
    expect(() => parseScreen('x', 'export default 1')).toThrow(/no literal title and slots/);
  });
});

describe('parent context', () => {
  it('follows extends chains and mixes to the folders that supply the look', () => {
    const repo = mkdtempSync(join(tmpdir(), 'variants-'));
    const dir = (id: string, index: string) => {
      mkdirSync(join(repo, 'dashboard/src/designs/landing', id), { recursive: true });
      writeFileSync(join(repo, 'dashboard/src/designs/landing', id, 'index.tsx'), index);
    };
    dir('a-bold', 'bold');
    dir('b-calm', 'calm');
    dir('b2-playful', "extends: 'b-calm'");
    const files = parentContext(repo, 'landing', 'mix-1', (id) => (id === 'mix-1' ? ['b2-playful', 'a-bold'] : undefined));
    expect(Object.keys(files)).toEqual([
      'dashboard/src/designs/landing/b2-playful/index.tsx',
      'dashboard/src/designs/landing/a-bold/index.tsx',
      'dashboard/src/designs/landing/b-calm/index.tsx',
    ]);
    expect(parentContext(repo, 'landing', null, () => undefined)).toEqual({});
  });
});

describe('variant ids', () => {
  it('slugs the brief and avoids taken names', () => {
    expect(variantId('Rounder buttons, please!', new Set())).toBe('gen-rounder-buttons-please');
    expect(variantId('Rounder buttons', new Set(['gen-rounder-buttons']))).toBe('gen-rounder-buttons-2');
    expect(variantId('!!!', new Set())).toBe('gen-variant');
  });
});
