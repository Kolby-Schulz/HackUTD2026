// The one action registry (KEYS-1, D7). Dispatcher, palette, tooltips, help overlay and menus all read from here.
// Nothing else may hard-code a key string.
//
// Binding syntax (strings in Action.keys): modifiers joined by "+", then one key token.
//   Modifiers: Mod (Cmd on mac, Ctrl on win), Shift, Alt (Option on mac), Ctrl (literal Ctrl, rarely needed).
//   Key token: a single letter ("d", matched by e.key so it follows the printed layout) or a KeyboardEvent.code
//   name for everything else ("Digit1", "BracketLeft", "Backslash", "Equal", "Minus", "Slash", "ArrowLeft",
//   "Space", "Escape", "Enter", "Delete", "Backspace", "F2").
import type { Action, FocusContext } from './types';

export type Platform = 'mac' | 'win';
export interface Binding { mod: boolean; shift: boolean; alt: boolean; ctrl: boolean; key: string }

export function detectPlatform(nav: { platform?: string; userAgent?: string } | undefined = (globalThis as { navigator?: { platform?: string; userAgent?: string } }).navigator): Platform {
  const s = `${nav?.platform ?? ''} ${nav?.userAgent ?? ''}`;
  return /Mac|iPhone|iPad/i.test(s) ? 'mac' : 'win';        // unknown UA -> Windows labels
}

export function parseBinding(b: string): Binding {
  const out: Binding = { mod: false, shift: false, alt: false, ctrl: false, key: '' };
  const parts = b.split('+');
  // A trailing "+" key is written "Plus"; a lone "+" would split into empty strings.
  for (const p of parts) {
    if (p === 'Mod') out.mod = true;
    else if (p === 'Shift') out.shift = true;
    else if (p === 'Alt') out.alt = true;
    else if (p === 'Ctrl') out.ctrl = true;
    else out.key = p.length === 1 ? p.toLowerCase() : p;
  }
  return out;
}

/** Canonical form, used for conflict checks. */
export function normalizeBinding(b: string): string {
  const p = parseBinding(b);
  return [p.mod && 'Mod', p.ctrl && 'Ctrl', p.alt && 'Alt', p.shift && 'Shift', p.key].filter(Boolean).join('+');
}

const KEY_LABEL: Record<string, string> = {
  Digit0: '0', Digit1: '1', Digit2: '2', Digit3: '3', Digit4: '4', Digit5: '5', Digit6: '6', Digit7: '7', Digit8: '8', Digit9: '9',
  BracketLeft: '[', BracketRight: ']', Backslash: '\\', Equal: '=', Minus: '-', Slash: '/', Period: '.', Comma: ',', Quote: "'",
  ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Escape: 'Esc', Space: 'Space', Backspace: '⌫', Delete: 'Del', Enter: '↵',
};

/** Human label. Mac gets glyphs (⌘⇧⌥⌃), Windows gets words (Ctrl+Shift+Alt). */
export function formatBinding(b: string, platform: Platform): string {
  const p = parseBinding(b);
  const key = KEY_LABEL[p.key] ?? (p.key.length === 1 ? p.key.toUpperCase() : p.key);
  if (platform === 'mac') return `${p.ctrl ? '⌃' : ''}${p.alt ? '⌥' : ''}${p.shift ? '⇧' : ''}${p.mod ? '⌘' : ''}${key}`;
  return [p.mod || p.ctrl ? 'Ctrl' : '', p.alt ? 'Alt' : '', p.shift ? 'Shift' : '', key].filter(Boolean).join('+');
}

/** Raw binding strings for a platform (platform-specific plus `all`). */
export function bindingsFor(a: Action, platform: Platform): string[] {
  return [...(a.keys?.all ?? []), ...(a.keys?.[platform] ?? [])];
}

/** Display labels for tooltips, help overlay and palette. */
export function shortcutLabels(a: Action, platform: Platform = detectPlatform()): string[] {
  return bindingsFor(a, platform).map(b => formatBinding(b, platform));
}

/** Pairs of actions that share a binding in an overlapping context (per platform). */
export function findConflicts(list: readonly Action[], platform: Platform): Array<{ a: string; b: string; binding: string }> {
  const out: Array<{ a: string; b: string; binding: string }> = [];
  const seen = new Map<string, Action[]>();
  for (const a of list) {
    for (const b of new Set(bindingsFor(a, platform).map(normalizeBinding))) {
      const others = seen.get(b) ?? [];
      for (const o of others) if (o.contexts.some(c => a.contexts.includes(c))) out.push({ a: o.id, b: a.id, binding: b });
      seen.set(b, [...others, a]);
    }
  }
  return out;
}

// ---- the registry ----
const byId = new Map<string, Action>();
const subs = new Set<() => void>();
const emit = () => subs.forEach(f => f());

/** Add or replace an action by id. Returns an unregister function. */
export function registerAction(a: Action): () => void {
  byId.set(a.id, a);
  emit();
  return () => { if (byId.get(a.id) === a) { byId.delete(a.id); emit(); } };
}
export function registerAll(list: readonly Action[]): () => void {
  for (const a of list) byId.set(a.id, a);
  emit();
  return () => { for (const a of list) if (byId.get(a.id) === a) byId.delete(a.id); emit(); };
}
export const getAction = (id: string): Action | undefined => byId.get(id);
export const listActions = (): Action[] => [...byId.values()];
export const subscribeActions = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

/** Run by id (palette, menus, agents). Returns false when missing or its `when()` says no (reason string). */
export function runAction(id: string, args?: unknown): true | string {
  const a = byId.get(id);
  if (!a) return `Unknown action ${id}`;
  const ok = a.when ? a.when() : true;
  if (ok !== true) return ok;
  a.run(args);
  return true;
}

export const contextsOverlap = (a: Action, b: Action): boolean => a.contexts.some((c: FocusContext) => b.contexts.includes(c));
