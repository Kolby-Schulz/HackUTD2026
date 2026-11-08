import { describe, expect, it } from 'vitest';

describe('listActions snapshot', () => {
  it('returns the same array until the registry changes (stable for useSyncExternalStore)', async () => {
    const m = await import('./actions');
    const a = m.listActions();
    expect(m.listActions()).toBe(a);
    const off = m.registerAll([{ id: 'test.snapshot', title: 'T', group: 'Help', contexts: ['canvas'], run: () => {} } as never]);
    const b = m.listActions();
    expect(b).not.toBe(a);
    expect(b.some((x) => x.id === 'test.snapshot')).toBe(true);
    off();
    expect(m.listActions().some((x) => x.id === 'test.snapshot')).toBe(false);
  });
});
