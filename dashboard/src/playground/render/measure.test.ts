import { beforeEach, describe, expect, it } from 'vitest';
import { fitSize, measureText, resolveStyle, setMeasureEnv, type MeasureEnv } from './measure';

// Fake: every char is size/2 wide; wrapping breaks on spaces greedily.
let calls = 0;
const fake: MeasureEnv = {
  lineWidth: (l, s) => (calls++, Array.from(l).length * (s.size / 2 + s.ls)),
  wrap(text, s, width) {
    calls++;
    const per = s.size / 2 + s.ls, max = Math.max(1, Math.floor(width / per)), out: string[] = [];
    for (const para of text.split('\n')) {
      let cur = '';
      for (const w of para.split(' ')) {
        const next = cur ? `${cur} ${w}` : w;
        if (next.length > max && cur) { out.push(cur); cur = w; } else cur = next;
      }
      out.push(cur);
    }
    return out;
  },
};
beforeEach(() => { calls = 0; setMeasureEnv(fake); });

describe('measureText', () => {
  it('defaults line height to 1.2 x size', () => {
    expect(resolveStyle({ fontSize: 10 }).lh).toBe(12);
    expect(resolveStyle({ lineHeight: 30 }).lh).toBe(30);
  });
  it('auto-w: widest line, explicit newlines only', () => {
    const m = measureText('abcd\nab', { fontSize: 20 }, 'auto-w', 5);
    expect(m).toEqual({ w: 40, h: 48, lines: ['abcd', 'ab'] });
  });
  it('auto-h wraps at width and keeps w', () => {
    const m = measureText('aaa bbb ccc', { fontSize: 10 }, 'auto-h', 30);
    expect(m.lines).toEqual(['aaa', 'bbb', 'ccc']);
    expect(m).toMatchObject({ w: 30, h: 36 });
  });
  it('fixed measures content like auto-h', () => {
    expect(measureText('aaa bbb', { fontSize: 10 }, 'fixed', 100).lines).toEqual(['aaa bbb']);
  });
  it('is independent of zoom: no camera input, same result twice', () => {
    expect(measureText('x y', { fontSize: 10 }, 'auto-h', 20)).toBe(measureText('x y', { fontSize: 10 }, 'auto-h', 20));
  });
  it('caches by style+text and measures 1k strings fast', () => {
    const t0 = performance.now();
    for (let p = 0; p < 2; p++) for (let i = 0; i < 1000; i++) measureText(`string number ${i}`, { fontSize: 14 }, 'auto-w');
    expect(calls).toBe(1000);
    expect(performance.now() - t0).toBeLessThan(50);
  });
  it('style change busts the cache', () => {
    measureText('a', { fontSize: 10 }); measureText('a', { fontSize: 11 }); measureText('a', { fontSize: 10, letterSpacing: 1 });
    expect(calls).toBe(3);
  });
});

describe('fitSize', () => {
  it('fixed keeps stored size', () => expect(fitSize({ text: 'a', textMode: 'fixed', w: 10, h: 10 })).toBeNull());
  it('auto-w ceils width and height', () => {
    expect(fitSize({ text: 'abc', textMode: 'auto-w', fontSize: 15, w: 0, h: 0 })).toEqual({ w: 23, h: 18 });
  });
  it('auto-h keeps width', () => {
    expect(fitSize({ text: 'aaa bbb', textMode: 'auto-h', fontSize: 10, w: 30, h: 0 })).toEqual({ w: 30, h: 24 });
  });
});
