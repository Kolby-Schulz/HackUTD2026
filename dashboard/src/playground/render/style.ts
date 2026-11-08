// Shape record -> CSS (D5). Pure: no React import, no DOM access; returns plain style objects.
// Box: position (parent space), size, rotation, flip, opacity, hidden. Paint: fills, strokes, effects,
// radius, clip. Text: every typography field.
import type { Effect, Paint, Shape, Stroke } from '../core/types';

export type Css = Record<string, string | number | undefined>;

/** A colour with an extra opacity (0..1) folded in. */
export function withOpacity(color: string, opacity?: number): string {
  if (opacity === undefined || opacity >= 1) return color;
  return `color-mix(in srgb, ${color} ${Math.max(0, opacity) * 100}%, transparent)`;
}

export function radiusCss(s: Pick<Shape, 'kind' | 'radius'>): string | number | undefined {
  if (s.kind === 'ellipse') return '50%';
  const r = s.radius;
  if (r === undefined) return undefined;
  if (Array.isArray(r)) return r.map((v) => `${v}px`).join(' ');
  return r;
}

/** Fills top-most last (Figma order) -> CSS backgrounds top-most first. */
export function fillsCss(fills: readonly Paint[]): string | undefined {
  const vis = fills.filter((f) => !f.hidden && f.type === 'solid');
  if (!vis.length) return undefined;
  if (vis.length === 1) return withOpacity(vis[0].color, vis[0].opacity);
  return vis.slice().reverse().map((f) => { const c = withOpacity(f.color, f.opacity); return `linear-gradient(${c}, ${c})`; }).join(', ');
}

function strokeShadows(strokes: readonly Stroke[]): string[] {
  const out: string[] = [];
  for (const k of strokes) {
    if (k.hidden || k.width <= 0) continue;
    const align = k.align ?? 'inside';
    if (align === 'inside') out.push(`inset 0 0 0 ${k.width}px ${k.color}`);
    else if (align === 'outside') out.push(`0 0 0 ${k.width}px ${k.color}`);
    else out.push(`inset 0 0 0 ${k.width / 2}px ${k.color}`, `0 0 0 ${k.width / 2}px ${k.color}`);
  }
  return out;
}

function effectCss(effects: readonly Effect[]): { shadows: string[]; filter?: string } {
  const shadows: string[] = [];
  let blur = 0;
  for (const e of effects) {
    if (e.hidden) continue;
    if (e.type === 'blur') blur += e.blur;
    else shadows.push(`${e.type === 'inner' ? 'inset ' : ''}${e.x}px ${e.y}px ${e.blur}px ${e.spread ?? 0}px ${e.color}`);
  }
  return { shadows, filter: blur > 0 ? `blur(${blur}px)` : undefined };
}

/** Outer box: where the shape sits in its parent and how it is transformed. */
export function boxStyle(s: Shape): Css {
  const t = [`translate(${s.x}px, ${s.y}px)`];
  if (s.rotation) t.push(`rotate(${s.rotation}deg)`);
  if (s.flipX || s.flipY) t.push(`scale(${s.flipX ? -1 : 1}, ${s.flipY ? -1 : 1})`);
  return {
    transform: t.join(' '),
    width: s.w,
    height: s.h,
    opacity: s.opacity !== undefined && s.opacity < 1 ? s.opacity : undefined,
    display: s.hidden ? 'none' : undefined,
  };
}

/** Painted surface: background, radius, strokes and effects; frames clip unless clip === false. */
export function paintStyle(s: Shape): Css {
  const fx = effectCss(s.effects ?? []);
  const shadows = [...strokeShadows(s.strokes ?? []), ...fx.shadows];
  return {
    background: fillsCss(s.fills ?? []),
    borderRadius: radiusCss(s),
    boxShadow: shadows.length ? shadows.join(', ') : undefined,
    filter: fx.filter,
    overflow: s.kind === 'frame' && s.clip !== false ? 'hidden' : undefined,
  };
}

const VALIGN = { top: 'flex-start', middle: 'center', bottom: 'flex-end' } as const;

/** Typography. Text wraps inside its width; `fixed` keeps the box height, the auto modes grow. */
export function textStyle(s: Shape): Css {
  const lh = s.lineHeight === undefined || s.lineHeight === 'auto' ? 1.2 : `${s.lineHeight}px`;
  return {
    fontFamily: s.fontFamily,
    fontSize: s.fontSize ?? 16,
    fontWeight: s.fontWeight ?? 400,
    lineHeight: lh,
    letterSpacing: s.letterSpacing ? `${s.letterSpacing}px` : undefined,
    textAlign: s.textAlign,
    color: s.color ?? '#1c1917',
    display: s.textVAlign && s.textVAlign !== 'top' ? 'flex' : undefined,
    flexDirection: s.textVAlign && s.textVAlign !== 'top' ? 'column' : undefined,
    justifyContent: s.textVAlign ? VALIGN[s.textVAlign] : undefined,
    height: s.textMode === 'fixed' ? s.h : 'auto',
    minHeight: s.textMode === 'fixed' ? undefined : s.h,
  };
}

/** Everything for one non-container shape (rect, ellipse, text, line, image) on a single element. */
export function shapeStyle(s: Shape): Css {
  return { ...boxStyle(s), ...paintStyle(s), ...(s.kind === 'text' ? textStyle(s) : {}) };
}
