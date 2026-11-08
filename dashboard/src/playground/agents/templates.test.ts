import { describe, expect, it } from 'vitest';
import { TEMPLATES, childProps, frameProps, resolveColor } from './templates';

describe('templates', () => {
  it('has the four templates', () => {
    expect(TEMPLATES.map((t) => t.name)).toEqual(['Profile card', 'Mobile · Tasks', 'Stat widget', 'Hero section']);
    expect(TEMPLATES.map((t) => t.children.length + 1)).toEqual([10, 17, 12, 11]);
  });

  it('every child sits inside the frame (frame-relative coordinates)', () => {
    for (const t of TEMPLATES) for (const el of t.children) {
      expect(el.x).toBeGreaterThanOrEqual(0);
      expect(el.y).toBeGreaterThanOrEqual(0);
      expect(el.x + el.w).toBeLessThanOrEqual(t.w);
      expect(el.y + el.h).toBeLessThanOrEqual(t.h);
    }
  });

  it('resolves accent markers', () => {
    expect(resolveColor('A', '#f24e1e')).toBe('#f24e1e');
    expect(resolveColor('a', '#f24e1e')).toBe('#f24e1e29');
    expect(resolveColor('#fff', '#f24e1e')).toBe('#fff');
    expect(resolveColor(undefined, '#f24e1e')).toBeUndefined();
  });

  it('frameProps places the frame in the world on white', () => {
    expect(frameProps(TEMPLATES[0], 90, 40)).toMatchObject({ name: 'Profile card', x: 90, y: 40, w: 320, h: 400, radius: 16, fills: [{ type: 'solid', color: '#ffffff' }] });
    expect(frameProps(TEMPLATES[0], 90, 40, { w: 1, h: 1 })).toMatchObject({ w: 1, h: 1 });
  });

  it('childProps: shapes use fills, text layers have no fill and a text colour', () => {
    const avatar = TEMPLATES[0].children[0];
    expect(childProps(avatar, '#f24e1e')).toMatchObject({ x: 24, y: 24, w: 64, h: 64, fills: [{ type: 'solid', color: '#f24e1e29' }] });
    const name = TEMPLATES[0].children[1];
    expect(childProps(name, '#f24e1e', { typed: 'Ad' })).toMatchObject({ text: 'Ad', fills: [], fontSize: 18, fontWeight: 600, color: '#1c1917' });
    expect(childProps(name, '#f24e1e').text).toBe('Ada Lovelace');
    const delta = TEMPLATES[2].children[3];
    expect(childProps(delta, '#0fa5e9').color).toBe('#0fa5e9');
    expect(childProps(avatar, '#f24e1e', { size: { w: 1, h: 1 } })).toMatchObject({ w: 1, h: 1 });
  });
});
