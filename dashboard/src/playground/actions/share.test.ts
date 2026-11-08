import { describe, expect, it } from 'vitest';
import { copyText, exportFileName } from './share';

describe('exportFileName', () => {
  it('uses the layer name and @Nx suffix', () => {
    expect(exportFileName(['Hero'], 2)).toBe('Hero@2x.png');
    expect(exportFileName(['Hero'], 1)).toBe('Hero.png');
  });
  it('counts several layers and strips path characters', () => {
    expect(exportFileName(['a', 'b'], 3)).toBe('2 layers@3x.png');
    expect(exportFileName(['a/b:c'], 1)).toBe('a-b-c.png');
  });
});

describe('copyText fallback order', () => {
  it('uses the clipboard API first', async () => {
    const calls: string[] = [];
    const ok = await copyText('x', { writeText: async () => { calls.push('api'); }, execCopy: () => { calls.push('exec'); return true; } });
    expect(ok).toBe(true); expect(calls).toEqual(['api']);
  });
  it('falls back to execCommand when the API rejects', async () => {
    const calls: string[] = [];
    const ok = await copyText('x', { writeText: async () => { calls.push('api'); throw new Error('NotAllowedError'); }, execCopy: () => { calls.push('exec'); return true; } });
    expect(ok).toBe(true); expect(calls).toEqual(['api', 'exec']);
  });
  it('reports failure when both fail', async () => {
    expect(await copyText('x', { writeText: async () => { throw new Error('no'); }, execCopy: () => false })).toBe(false);
    expect(await copyText('x', { writeText: async () => { throw new Error('no'); }, execCopy: () => { throw new Error('no'); } })).toBe(false);
  });
});
