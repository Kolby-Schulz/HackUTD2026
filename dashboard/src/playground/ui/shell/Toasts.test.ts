import { describe, expect, it } from 'vitest';
import { mergeHeld, visibleToasts } from './Toasts';
import type { Toast } from '../../core/toast';

const t = (id: number, text = `t${id}`, variant: Toast['variant'] = 'info'): Toast => ({ id, text, variant, ttlMs: 1, at: 0 });

describe('visibleToasts', () => {
  it('keeps only the newest 3', () => {
    expect(visibleToasts([t(1), t(2), t(3), t(4), t(5)]).map((x) => x.id)).toEqual([3, 4, 5]);
  });
  it('collapses repeats to the newest', () => {
    expect(visibleToasts([t(1, 'a'), t(2, 'b'), t(3, 'a')]).map((x) => x.id)).toEqual([2, 3]);
  });
  it('keeps same text with different variants', () => {
    expect(visibleToasts([t(1, 'a'), t(2, 'a', 'error')])).toHaveLength(2);
  });
});

describe('mergeHeld', () => {
  it('keeps dropped toasts and orders by id', () => {
    expect(mergeHeld([t(1), t(2)], [t(2), t(3)]).map((x) => x.id)).toEqual([1, 2, 3]);
  });
});
