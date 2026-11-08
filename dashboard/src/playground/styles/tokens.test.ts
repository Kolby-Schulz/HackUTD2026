// SHELL-6: every colour in styles/*.css comes from a --pg-* token; only tokens.css holds raw colours.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dir = new URL('.', import.meta.url);
const sheets = readdirSync(dir).filter((f) => f.endsWith('.css'));
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const RAW = /#[0-9a-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklch|oklab)\(|(?<![-\w])(?:white|black)(?![-\w])/gi;

describe('styles', () => {
  it('has the token and base sheets', () => {
    expect(sheets).toContain('tokens.css');
    expect(sheets).toContain('base.css');
  });
  for (const f of sheets.filter((s) => s !== 'tokens.css')) {
    it(`${f} has no raw colour literal`, () => {
      expect(strip(readFileSync(new URL(f, dir), 'utf8')).match(RAW) ?? []).toEqual([]);
    });
  }
  it('every var(--pg-*) used is defined in tokens.css', () => {
    const tokens = new Set(strip(readFileSync(new URL('tokens.css', dir), 'utf8')).match(/--pg-[\w-]+(?=\s*:)/g));
    // runtime vars written by components (not tokens)
    const runtime = new Set(['--pg-zi']);
    for (const f of sheets) {
      for (const m of strip(readFileSync(new URL(f, dir), 'utf8')).matchAll(/var\((--pg-[\w-]+)/g)) {
        expect(tokens.has(m[1]) || runtime.has(m[1]), `${f}: ${m[1]}`).toBe(true);
      }
    }
  });
});
