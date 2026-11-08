// The four demo designs a scripted agent can draw. Pure data plus helpers, no React or DOM.
// Child coordinates are relative to the template frame (parent space); the frame itself is
// placed at a world origin. 'A' = the agent's accent colour, 'a' = a soft tint of it.
import type { Kind, ShapeProps } from '../core/types';

export type El = { kind: Exclude<Kind, 'frame'>; name: string; x: number; y: number; w: number; h: number; fill?: string; text?: string; fontSize?: number; weight?: number; radius?: number; color?: string };
export type Tpl = { name: string; w: number; h: number; radius?: number; children: El[] };

export const INK = '#1c1917', MUTED = '#78716c', LINE = '#e7e5e0', WASH = '#f4f2ec';

export const TEMPLATES: Tpl[] = [
  {
    name: 'Profile card', w: 320, h: 400, radius: 16,
    children: [
      { kind: 'ellipse', name: 'Avatar', x: 24, y: 24, w: 64, h: 64, fill: 'a' },
      { kind: 'text', name: 'Name', x: 104, y: 32, w: 190, h: 24, text: 'Ada Lovelace', fontSize: 18, weight: 600 },
      { kind: 'text', name: 'Role', x: 104, y: 60, w: 190, h: 18, text: 'Product designer', fontSize: 13, color: MUTED },
      { kind: 'rect', name: 'Cover', x: 24, y: 108, w: 272, h: 132, fill: WASH, radius: 10 },
      { kind: 'rect', name: 'Line', x: 24, y: 262, w: 272, h: 10, fill: LINE, radius: 5 },
      { kind: 'rect', name: 'Line', x: 24, y: 282, w: 216, h: 10, fill: LINE, radius: 5 },
      { kind: 'rect', name: 'Line', x: 24, y: 302, w: 168, h: 10, fill: LINE, radius: 5 },
      { kind: 'rect', name: 'Button', x: 24, y: 336, w: 128, h: 40, fill: 'A', radius: 20 },
      { kind: 'text', name: 'Label', x: 64, y: 347, w: 80, h: 18, text: 'Follow', fontSize: 14, weight: 600, color: '#fff' },
    ],
  },
  {
    name: 'Mobile · Tasks', w: 280, h: 520, radius: 28,
    children: [
      { kind: 'text', name: 'Title', x: 24, y: 40, w: 200, h: 32, text: 'Today', fontSize: 26, weight: 700 },
      { kind: 'text', name: 'Subtitle', x: 24, y: 78, w: 200, h: 18, text: '3 tasks left', fontSize: 13, color: MUTED },
      ...[0, 1, 2].flatMap((i): El[] => [
        { kind: 'rect', name: 'Row', x: 16, y: 120 + i * 76, w: 248, h: 64, fill: WASH, radius: 14 },
        { kind: 'ellipse', name: 'Icon', x: 28, y: 134 + i * 76, w: 36, h: 36, fill: 'a' },
        { kind: 'rect', name: 'Row title', x: 78, y: 142 + i * 76, w: 140 - i * 20, h: 10, fill: '#d6d3cd', radius: 5 },
        { kind: 'rect', name: 'Row meta', x: 78, y: 160 + i * 76, w: 84, h: 8, fill: LINE, radius: 4 },
      ]),
      { kind: 'rect', name: 'Tab bar', x: 16, y: 452, w: 248, h: 52, fill: INK, radius: 26 },
      { kind: 'ellipse', name: 'Tab', x: 132, y: 470, w: 16, h: 16, fill: 'A' },
    ],
  },
  {
    name: 'Stat widget', w: 360, h: 230, radius: 16,
    children: [
      { kind: 'text', name: 'Label', x: 24, y: 22, w: 200, h: 18, text: 'Weekly revenue', fontSize: 13, color: MUTED },
      { kind: 'text', name: 'Value', x: 24, y: 42, w: 200, h: 40, text: '$48.2k', fontSize: 32, weight: 700 },
      { kind: 'rect', name: 'Pill', x: 252, y: 26, w: 84, h: 26, fill: 'a', radius: 13 },
      { kind: 'text', name: 'Delta', x: 268, y: 31, w: 64, h: 16, text: '+12.4%', fontSize: 12, weight: 600, color: 'A' },
      ...[50, 78, 62, 104, 88, 124, 98].map((h, i): El => ({ kind: 'rect', name: `Bar ${i + 1}`, x: 24 + i * 46, y: 206 - h, w: 30, h, fill: i === 5 ? 'A' : 'a', radius: 6 })),
    ],
  },
  {
    name: 'Hero section', w: 440, h: 300, radius: 16,
    children: [
      { kind: 'rect', name: 'Logo', x: 24, y: 24, w: 28, h: 28, fill: 'A', radius: 8 },
      { kind: 'rect', name: 'Nav', x: 300, y: 33, w: 44, h: 10, fill: LINE, radius: 5 },
      { kind: 'rect', name: 'Nav', x: 356, y: 33, w: 60, h: 10, fill: LINE, radius: 5 },
      { kind: 'text', name: 'Headline', x: 24, y: 80, w: 380, h: 76, text: 'Design with a whole team of agents', fontSize: 30, weight: 700 },
      { kind: 'rect', name: 'Body', x: 24, y: 176, w: 300, h: 10, fill: LINE, radius: 5 },
      { kind: 'rect', name: 'Body', x: 24, y: 194, w: 236, h: 10, fill: LINE, radius: 5 },
      { kind: 'rect', name: 'CTA', x: 24, y: 230, w: 140, h: 44, fill: 'A', radius: 22 },
      { kind: 'text', name: 'CTA label', x: 50, y: 243, w: 110, h: 18, text: 'Get started', fontSize: 14, weight: 600, color: '#fff' },
      { kind: 'rect', name: 'Secondary', x: 176, y: 230, w: 124, h: 44, fill: WASH, radius: 22 },
      { kind: 'text', name: 'Secondary label', x: 199, y: 243, w: 90, h: 18, text: 'Learn more', fontSize: 14, weight: 500 },
    ],
  },
];

/** Resolve the accent markers: 'A' = accent, 'a' = accent at ~16% (hex alpha 29), else as given. */
export function resolveColor(c: string | undefined, accent: string): string | undefined {
  return c === 'A' ? accent : c === 'a' ? accent + '29' : c;
}

const solid = (color: string) => [{ type: 'solid' as const, color }];

/** Props of the template frame (parent space = world, placed at the given origin). */
export function frameProps(tpl: Tpl, x: number, y: number, size?: { w: number; h: number }): Partial<ShapeProps> {
  return { name: tpl.name, x, y, w: size?.w ?? tpl.w, h: size?.h ?? tpl.h, fills: solid('#ffffff'), radius: tpl.radius };
}

/**
 * Props of one child, in frame-relative coordinates. `size` overrides w/h (a layer mid-drag);
 * text layers start empty when `typed` is given (the partial text typed so far).
 */
export function childProps(el: El, accent: string, o: { size?: { w: number; h: number }; typed?: string } = {}): Partial<ShapeProps> {
  const w = o.size?.w ?? el.w, h = o.size?.h ?? el.h;
  if (el.kind === 'text') {
    return {
      name: el.name, x: el.x, y: el.y, w, h, fills: [], text: o.typed ?? el.text ?? '',
      fontSize: el.fontSize ?? 14, fontWeight: el.weight, color: resolveColor(el.color, accent) ?? INK,
    };
  }
  return { name: el.name, x: el.x, y: el.y, w, h, fills: solid(resolveColor(el.fill, accent) ?? LINE), radius: el.radius };
}
