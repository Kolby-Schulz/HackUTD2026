// Global key dispatcher (KEYS-2, KEYS-6, KEYS-18). Testable in Node: `createDispatcher` takes events and a
// context resolver; `install` is the only function that touches `window`.
import { bindingsFor, detectPlatform, listActions, parseBinding, type Binding, type Platform } from './actions';
import { toast } from './toast';
import type { Action, FocusContext } from './types';

/** The slice of KeyboardEvent we use. */
export interface KeyLike {
  key: string; code: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean;
  repeat?: boolean; isComposing?: boolean; keyCode?: number; target?: unknown; defaultPrevented?: boolean;
  preventDefault(): void; stopPropagation?(): void;
}

/** Ids that may fire on key repeat (everything else is one-shot, KEYS-18). */
export const REPEATABLE = new Set(['arrange.nudge', 'view.zoomIn', 'view.zoomOut']);
/** Contexts where the browser's own shortcuts are suppressed (KEYS-6). */
const PREVENT_IN: FocusContext[] = ['canvas', 'panel'];
const ARROW_DELTA: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/** Letters match e.key (follows the layout; Caps Lock normalised). A non-ASCII letter (Cyrillic, Mac Option) falls back to e.code. */
export function eventKeyToken(e: Pick<KeyLike, 'key' | 'code'>): string {
  if (/^[a-zA-Z]$/.test(e.key)) return e.key.toLowerCase();
  const m = /^Key([A-Z])$/.exec(e.code);
  if (m && e.key.length === 1 && !/^[0-9]$/.test(e.key) && /\p{L}/u.test(e.key)) return m[1].toLowerCase();
  return e.code;
}

export function matchesBinding(b: Binding, e: KeyLike, platform: Platform): boolean {
  if (platform === 'mac') {
    if (e.metaKey !== b.mod || e.ctrlKey !== b.ctrl) return false;
  } else {
    if (e.metaKey || e.ctrlKey !== (b.mod || b.ctrl)) return false;
  }
  if (b.alt !== e.altKey || b.shift !== e.shiftKey) return false;
  return b.key === eventKeyToken(e);
}

/** Minimal structural DOM view so core stays DOM-free. */
export interface ElementLike { closest?(sel: string): ElementLike | null; getAttribute?(n: string): string | null }
const TEXT_SEL = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role=textbox]';

/** Focus context from the focused element: explicit `data-pg-ctx`, else text fields, else canvas. */
export function resolveFocusContext(el: unknown): FocusContext {
  const node = el as ElementLike | null | undefined;
  if (!node || typeof node.closest !== 'function') return 'canvas';
  const explicit = node.closest('[data-pg-ctx]')?.getAttribute?.('data-pg-ctx') as FocusContext | null | undefined;
  if (explicit === 'palette' || explicit === 'dialog' || explicit === 'chat') return explicit;
  if (node.closest('[role=dialog]')) return 'dialog';
  if (node.closest(TEXT_SEL)) return 'text-edit';
  return explicit === 'panel' ? 'panel' : 'canvas';
}

export interface DispatcherOpts {
  getContext: (e: KeyLike) => FocusContext;
  getActions?: () => readonly Action[];
  platform?: Platform;
  /** Override bindings per action id (KEYS-16 user prefs). */
  overrides?: () => Record<string, string>;
}

export function createDispatcher(o: DispatcherOpts) {
  const platform = o.platform ?? detectPlatform();
  const getActions = o.getActions ?? listActions;

  /** Returns the action that ran, or null. */
  function handle(e: KeyLike): Action | null {
    if (e.defaultPrevented) return null;
    if (e.isComposing || e.keyCode === 229) return null;            // IME
    const ctx = o.getContext(e);
    const ov = o.overrides?.() ?? {};
    for (const a of getActions()) {
      if (!a.contexts.includes(ctx)) continue;                       // text-edit / chat / palette / dialog only fire listed actions
      const raw = ov[a.id] ? [ov[a.id]] : bindingsFor(a, platform);
      const hit = raw.find(b => matchesBinding(parseBinding(b), e, platform));
      if (!hit) continue;
      if (PREVENT_IN.includes(ctx)) e.preventDefault();             // browser-clash list, canvas/panel only
      if (e.repeat && !REPEATABLE.has(a.id)) return null;
      const ok = a.when ? a.when() : true;
      if (ok !== true) { if (ok) toast(ok, { key: `when:${a.id}`, onceMs: 5000 }); return null; }
      a.run(a.id === 'arrange.nudge' ? nudgeArgs(e) : undefined);
      return a;
    }
    return null;
  }
  return { handle, platform };
}

function nudgeArgs(e: KeyLike): { dx: number; dy: number } | undefined {
  const d = ARROW_DELTA[e.code];
  if (!d) return undefined;
  const step = e.shiftKey ? 10 : 1;
  return { dx: d[0] * step, dy: d[1] * step };
}

/** Attach to a window-like target in the capture phase. Returns the remover (call on unmount). */
export function install(
  target: { addEventListener(t: 'keydown', f: (e: never) => void, capture?: boolean): void; removeEventListener(t: 'keydown', f: (e: never) => void, capture?: boolean): void },
  opts: Partial<DispatcherOpts> & { getFocused?: () => unknown } = {},
): () => void {
  const d = createDispatcher({
    getContext: e => resolveFocusContext(opts.getFocused ? opts.getFocused() : (e.target as unknown)),
    ...opts,
  });
  const h = (e: KeyLike) => { d.handle(e); };
  target.addEventListener('keydown', h as (e: never) => void, true);
  return () => target.removeEventListener('keydown', h as (e: never) => void, true);
}
