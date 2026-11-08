import { describe, expect, it } from 'vitest';
import type { Shape } from '../../../core/types';
import { sizePatch } from './Layout';

const box = (o: Partial<Shape>) => ({ kind: 'rect', w: 100, h: 50, ...o }) as Shape;

describe('sizePatch', () => {
  it('free resize changes one side', () => expect(sizePatch(box({}), 'w', 200)).toEqual({ w: 200 }));
  it('lock ratio: W=200 on 100x50 gives H=100', () => expect(sizePatch(box({ lockRatio: true }), 'w', 200)).toEqual({ w: 200, h: 100 }));
  it('lock ratio: H drives W', () => expect(sizePatch(box({ lockRatio: true }), 'h', 100)).toEqual({ h: 100, w: 200 }));
  it('clamps to 0.01', () => expect(sizePatch(box({}), 'h', -5)).toEqual({ h: 0.01 }));
  it('text: W fixes width, H fixes box', () => {
    expect(sizePatch(box({ kind: 'text', textMode: 'auto-w' }), 'w', 80)).toMatchObject({ textMode: 'auto-h' });
    expect(sizePatch(box({ kind: 'text', textMode: 'auto-w' }), 'h', 80)).toMatchObject({ textMode: 'fixed' });
  });
});
