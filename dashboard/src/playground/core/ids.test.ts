import { beforeEach, describe, expect, it } from 'vitest';
import { exportSeqs, newId, opId, parseOpId, resetSeqs, restoreSeqs } from './ids';

describe('ids', () => {
  beforeEach(resetSeqs);

  it('100k ids are unique and token-safe', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100_000; i++) seen.add(newId('s'));
    expect(seen.size).toBe(100_000);
    expect([...seen][0]).toMatch(/^[A-Za-z][A-Za-z0-9-]*$/);
  });

  it('ids sort by creation time', () => {
    const a = newId('s'), b = newId('s');
    expect(a < b).toBe(true);
  });

  it('opId counts per actor and survives restore', () => {
    expect(opId('human-you')).toBe('human-you:1');
    expect(opId('human-you')).toBe('human-you:2');
    expect(opId('agent-k3f9')).toBe('agent-k3f9:1');
    const saved = exportSeqs();
    resetSeqs();
    restoreSeqs(saved);
    expect(opId('human-you')).toBe('human-you:3');
    restoreSeqs({ 'human-you': 1 }); // a stale save never rewinds
    expect(opId('human-you')).toBe('human-you:4');
    expect(parseOpId('agent-k3f9:12')).toEqual({ actor: 'agent-k3f9', seq: 12 });
    expect(parseOpId('nonsense')).toBeNull();
  });
});
