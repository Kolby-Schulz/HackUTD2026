import { describe, expect, it } from 'vitest';
import type { Shape } from '../core/types';
import { boxStyle, fillsCss, paintStyle, radiusCss, shapeStyle, textStyle, withOpacity } from './style';

const base: Shape = { id: 's1', kind: 'rect', name: 'R', x: 10, y: 20, w: 100, h: 50, fills: [], parent: null, index: 'a0', createdBy: 'human-x', stamps: {} };
const S = (p: Partial<Shape>): Shape => ({ ...base, ...p });

describe('render/style', () => {
  it('box: translate, rotation, flip, opacity, hidden', () => {
    expect(boxStyle(base)).toMatchObject({ transform: 'translate(10px, 20px)', width: 100, height: 50, opacity: undefined, display: undefined });
    expect(boxStyle(S({ rotation: 45, flipX: true, opacity: 0.5, hidden: true }))).toMatchObject({
      transform: 'translate(10px, 20px) rotate(45deg) scale(-1, 1)', opacity: 0.5, display: 'none',
    });
  });

  it('fills: single solid, opacity, hidden, stacked top-most first', () => {
    expect(fillsCss([])).toBeUndefined();
    expect(fillsCss([{ type: 'solid', color: '#fff' }])).toBe('#fff');
    expect(withOpacity('#000', 0.25)).toBe('color-mix(in srgb, #000 25%, transparent)');
    expect(fillsCss([{ type: 'solid', color: '#f00', hidden: true }])).toBeUndefined();
    expect(fillsCss([{ type: 'solid', color: '#111' }, { type: 'solid', color: '#222' }])).toBe('linear-gradient(#222, #222), linear-gradient(#111, #111)');
  });

  it('radius, strokes, effects and clip', () => {
    expect(radiusCss(S({ kind: 'ellipse', radius: 4 }))).toBe('50%');
    expect(radiusCss(S({ radius: [1, 2, 3, 4] }))).toBe('1px 2px 3px 4px');
    const p = paintStyle(S({
      strokes: [{ color: '#00f', width: 2 }, { color: '#0f0', width: 4, align: 'center' }],
      effects: [{ type: 'drop', x: 0, y: 2, blur: 4, color: 'rgba(0,0,0,.2)' }, { type: 'blur', x: 0, y: 0, blur: 3, color: '' }],
    }));
    expect(p.boxShadow).toBe('inset 0 0 0 2px #00f, inset 0 0 0 2px #0f0, 0 0 0 2px #0f0, 0px 2px 4px 0px rgba(0,0,0,.2)');
    expect(p.filter).toBe('blur(3px)');
    expect(paintStyle(S({ kind: 'frame' })).overflow).toBe('hidden');
    expect(paintStyle(S({ kind: 'frame', clip: false })).overflow).toBeUndefined();
  });

  it('text fields', () => {
    const t = textStyle(S({ kind: 'text', fontFamily: 'Inter', fontSize: 20, fontWeight: 700, lineHeight: 24, letterSpacing: 1, textAlign: 'center', textVAlign: 'middle', color: '#123', textMode: 'fixed' }));
    expect(t).toMatchObject({ fontFamily: 'Inter', fontSize: 20, fontWeight: 700, lineHeight: '24px', letterSpacing: '1px', textAlign: 'center', justifyContent: 'center', display: 'flex', color: '#123', height: 50 });
    expect(textStyle(S({ kind: 'text' }))).toMatchObject({ fontSize: 16, lineHeight: 1.2, height: 'auto', minHeight: 50 });
    expect(shapeStyle(S({ kind: 'text', fontSize: 12 })).fontSize).toBe(12);
  });
});
