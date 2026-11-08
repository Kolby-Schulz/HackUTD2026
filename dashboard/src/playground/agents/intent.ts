// Tiny intent parser: the scripted agents understand a handful of edits. Same rules as the old
// engine.ts, now producing board Commands. Pure, no React or DOM.
import type { Command, Shape, ShapeId, ShapeProps } from '../core/types';
import { TEMPLATES } from './templates';
import type { Tpl } from './templates';

export const HELP = "I'm a scripted demo agent. Point at a layer and try: make it blue, bigger, smaller, rounder, bold, delete, or say \"New text\". Without a layer, ask me to build a card, mobile screen, stat widget or hero.";

const NAMED: Record<string, string> = {
  red: '#ef4444', orange: '#f97316', yellow: '#facc15', green: '#22c55e', teal: '#14b8a6', blue: '#3b82f6',
  purple: '#a855f7', pink: '#ec4899', black: '#1c1917', white: '#ffffff', gray: '#9ca3af', grey: '#9ca3af', brown: '#92400e',
};

export function pickTemplate(text: string): Tpl | undefined {
  const t = text.toLowerCase();
  if (/\b(card|profile)\b/.test(t)) return TEMPLATES[0];
  if (/\b(mobile|phone|app|tasks?)\b/.test(t)) return TEMPLATES[1];
  if (/\b(stat|stats|chart|widget|revenue)\b/.test(t)) return TEMPLATES[2];
  if (/\b(hero|landing)\b/.test(t)) return TEMPLATES[3];
  return undefined;
}

export type Edit = { remove?: boolean; patch: Partial<ShapeProps>; summary: string[] };

const radiusOf = (s: Shape) => (typeof s.radius === 'number' ? s.radius : (s.radius?.[0] ?? 0));

export function parseEdit(text: string, s: Shape): Edit | null {
  const t = text.toLowerCase();
  if (/\b(delete|remove)\b/.test(t)) return { remove: true, patch: {}, summary: [`removed ${s.name}`] };
  const p: Partial<ShapeProps> = {};
  const sum: string[] = [];
  const hex = text.match(/#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/i)?.[0];
  const cname = Object.keys(NAMED).find((c) => new RegExp(`\\b${c}\\b`).test(t));
  const col = hex ?? (cname ? NAMED[cname] : undefined);
  if (col) {
    if (s.kind === 'text') p.color = col; else p.fills = [{ type: 'solid', color: col }];
    sum.push(`${s.kind === 'text' ? 'text color' : 'fill'} is now ${cname ?? hex}`);
  }
  const k = /\b(bigger|larger|grow|increase|huge)\b/.test(t) ? 1.25 : /\b(smaller|shrink|tiny|decrease)\b/.test(t) ? 0.8 : 1;
  if (k !== 1) {
    if (s.kind === 'text') { p.fontSize = Math.round((s.fontSize ?? 14) * k); p.w = s.w * k; p.h = s.h * k; }
    else { p.w = s.w * k; p.h = s.h * k; p.x = s.x - (s.w * k - s.w) / 2; p.y = s.y - (s.h * k - s.h) / 2; }
    sum.push(k > 1 ? 'made it bigger' : 'made it smaller');
  }
  if (s.kind !== 'text' && /\b(round|rounder|rounded|pill|circle)\b/.test(t)) {
    p.radius = /\b(pill|circle)\b/.test(t) ? Math.min(s.w, s.h) / 2 : radiusOf(s) + 12;
    sum.push('rounded the corners');
  }
  if (/\b(square|sharp)\b/.test(t)) { p.radius = 0; sum.push('squared the corners'); }
  if (s.kind === 'text' && /\bbold\b/.test(t)) { p.fontWeight = 700; sum.push('made it bold'); }
  const quoted = text.match(/["“]([^"”]+)["”]/)?.[1];
  if (quoted) {
    if (s.kind === 'text') p.text = quoted;
    p.name = quoted.slice(0, 24);
    sum.push(`${s.kind === 'text' ? 'text' : 'name'} is now “${quoted}”`);
  }
  return sum.length ? { patch: p, summary: sum } : null;
}

/** The board command that applies a parsed edit to one shape. */
export function editCommands(id: ShapeId, e: Edit): Command[] {
  return e.remove ? [{ t: 'shape.delete', ids: [id] }] : [{ t: 'shape.update', ids: [id], patch: e.patch }];
}
