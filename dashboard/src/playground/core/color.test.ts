import { describe, expect, it } from 'vitest';
import { contrast, hexToHsv, hsvToHex, hsvToRgb, normalizeHex, parseColor, rgbToHsv, toHexA } from './color';

describe('parseColor', () => {
  it('accepts 3, 4, 6 and 8 digits with or without #', () => {
    expect(parseColor('#f00')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColor('0f0')).toEqual({ r: 0, g: 255, b: 0, a: 1 });
    expect(parseColor('#0000ff')).toEqual({ r: 0, g: 0, b: 255, a: 1 });
    expect(parseColor('#ff000080')?.a).toBeCloseTo(128 / 255);
    expect(parseColor('#f008')?.a).toBeCloseTo(0x88 / 255);
  });
  it('rejects invalid input', () => {
    for (const bad of ['', '#', '#12', '#12345', '#1234567', '#gggggg', 'notacolour', '#ff 00 00']) expect(parseColor(bad)).toBeNull();
  });
  it('takes names, case and spaces', () => {
    expect(normalizeHex(' Red ')).toBe('#ff0000');
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
    expect(parseColor('transparent')?.a).toBe(0);
  });
});

describe('hsv', () => {
  it('round-trips every 7th-ish hex through HSV', () => {
    for (let r = 0; r < 256; r += 15) for (let g = 0; g < 256; g += 17) for (let b = 0; b < 256; b += 13) {
      const hex = `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
      expect(hsvToHex(hexToHsv(hex)!)).toBe(hex);
    }
  });
  it('known values', () => {
    expect(rgbToHsv({ r: 255, g: 0, b: 0 })).toEqual({ h: 0, s: 1, v: 1 });
    expect(rgbToHsv({ r: 0, g: 0, b: 255 }).h).toBe(240);
    expect(hsvToRgb({ h: 120, s: 1, v: 1 })).toEqual({ r: 0, g: 255, b: 0 });
    expect(rgbToHsv({ r: 128, g: 128, b: 128 }).s).toBe(0);
  });
  it('wraps hue and clamps', () => {
    expect(hsvToRgb({ h: 360, s: 1, v: 1 })).toEqual({ r: 255, g: 0, b: 0 });
    expect(hsvToRgb({ h: -120, s: 2, v: 2 })).toEqual({ r: 0, g: 0, b: 255 });
  });
});

describe('misc', () => {
  it('8-digit output only when translucent', () => {
    expect(toHexA({ r: 255, g: 0, b: 0, a: 1 })).toBe('#ff0000');
    expect(toHexA({ r: 255, g: 0, b: 0, a: 0.5 })).toBe('#ff000080');
  });
  it('contrast black/white is 21', () => { expect(contrast('#000', '#fff')).toBeCloseTo(21); });
});
