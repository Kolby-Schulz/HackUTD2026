import { describe, expect, it } from 'vitest';
import { snapCreate, snapMove, snapResize, snapResult } from './snap';

const ctx = { actor: 'human-you', ignore: new Set<string>(), thresholdWorld: 5, parent: null };
describe('snap facade stubs', () => {
  it('return the input unchanged with no guides', () => {
    const none = { dx: 0, dy: 0, lines: [], gaps: [] };
    expect(snapMove({ x: 1, y: 2, w: 3, h: 4 }, ctx)).toEqual(none);
    expect(snapResize({ x: 1, y: 2, w: 3, h: 4 }, 'se', ctx)).toEqual(none);
    expect(snapCreate({ x: 1, y: 2 }, ctx)).toEqual(none);
  });
  it('snapResult store notifies', () => {
    let n = 0;
    const off = snapResult.subscribe(() => n++);
    snapResult.set({ dx: 1, dy: 0, lines: [], gaps: [] });
    snapResult.clear();
    off();
    expect(n).toBe(2);
    expect(snapResult.get().dx).toBe(0);
  });
});
