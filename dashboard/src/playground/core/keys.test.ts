import { describe, expect, it, vi } from 'vitest';
import { findConflicts, formatBinding, normalizeBinding, listActions } from './actions';
import '../actions/index';
import { createDispatcher, resolveFocusContext, type KeyLike } from './keys';
import { createPrefs, PREFS_KEY, type StorageLike } from './prefs';
import { createFlags } from './flags';
import { createToasts } from './toast';
import type { Action, FocusContext } from './types';

const ev = (o: Partial<KeyLike> & { key: string }): KeyLike & { prevented: boolean } => {
  const e = {
    code: '', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...o,
    prevented: false, preventDefault() { e.prevented = true; },
  };
  return e;
};
const act = (id: string, keys: Action['keys'], contexts: FocusContext[], run = () => {}): Action =>
  ({ id, title: id, group: 'Edit', keys, contexts, run });

describe('registry', () => {
  it('Mod renders as the platform symbol', () => {
    expect(formatBinding('Mod+Shift+d', 'mac')).toBe('⇧⌘D');
    expect(formatBinding('Mod+Shift+d', 'win')).toBe('Ctrl+Shift+D');
    expect(formatBinding('Mod+Alt+BracketLeft', 'mac')).toBe('⌥⌘[');
  });
  it('no two registered actions share a binding in the same context', () => {
    for (const p of ['mac', 'win'] as const) expect(findConflicts(listActions(), p)).toEqual([]);
  });
  it('detects a conflict and ignores disjoint contexts', () => {
    const a = act('a', { all: ['Mod+d'] }, ['canvas']);
    const b = act('b', { all: ['Mod+D'] }, ['canvas', 'panel']);
    const c = act('c', { all: ['Mod+d'] }, ['chat']);
    expect(findConflicts([a, b, c], 'mac')).toEqual([{ a: 'a', b: 'b', binding: 'Mod+d' }]);
    expect(normalizeBinding('Shift+Mod+d')).toBe('Mod+Shift+d');
  });
});

describe('dispatcher', () => {
  const run = vi.fn();
  const tool = act('tool.rect', { all: ['r'] }, ['canvas'], run);
  const esc = act('edit.escape', { all: ['Escape'] }, ['canvas', 'chat', 'text-edit'], run);
  const palette = act('palette.open', { mac: ['Mod+k'], win: ['Mod+k'] }, ['canvas', 'chat'], run);
  const make = (ctx: FocusContext, platform: 'mac' | 'win' = 'mac') =>
    createDispatcher({ getContext: () => ctx, getActions: () => [tool, esc, palette], platform });

  it('ignores letters in text-edit and chat unless the action lists the context', () => {
    run.mockClear();
    for (const ctx of ['text-edit', 'chat', 'palette', 'dialog'] as const) {
      const e = ev({ key: 'r', code: 'KeyR' });
      expect(make(ctx).handle(e)).toBeNull();
      expect(e.prevented).toBe(false);
    }
    expect(run).not.toHaveBeenCalled();
    expect(make('chat').handle(ev({ key: 'Escape', code: 'Escape' }))?.id).toBe('edit.escape');
    expect(make('chat').handle(ev({ key: 'k', code: 'KeyK', metaKey: true }))?.id).toBe('palette.open');
    expect(make('canvas').handle(ev({ key: 'r', code: 'KeyR' }))?.id).toBe('tool.rect');
  });
  it('only prevents default on canvas/panel (browser-clash list)', () => {
    const inCanvas = ev({ key: 'k', code: 'KeyK', metaKey: true });
    make('canvas').handle(inCanvas);
    expect(inCanvas.prevented).toBe(true);
    const inChat = ev({ key: 'k', code: 'KeyK', metaKey: true });
    make('chat').handle(inChat);
    expect(inChat.prevented).toBe(false);
  });
  it('modifiers must match exactly; Mod is Cmd on mac and Ctrl on win', () => {
    expect(make('canvas').handle(ev({ key: 'r', code: 'KeyR', shiftKey: true }))).toBeNull();
    expect(make('canvas', 'win').handle(ev({ key: 'k', code: 'KeyK', metaKey: true }))).toBeNull();
    expect(make('canvas', 'win').handle(ev({ key: 'k', code: 'KeyK', ctrlKey: true }))?.id).toBe('palette.open');
    expect(make('canvas', 'mac').handle(ev({ key: 'k', code: 'KeyK', ctrlKey: true }))).toBeNull();
  });
  it('skips IME composition and ignores key repeat on one-shot actions', () => {
    run.mockClear();
    expect(make('canvas').handle(ev({ key: 'r', code: 'KeyR', isComposing: true }))).toBeNull();
    expect(make('canvas').handle(ev({ key: 'r', code: 'KeyR', keyCode: 229 }))).toBeNull();
    expect(make('canvas').handle(ev({ key: 'r', code: 'KeyR', repeat: true }))).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });
  it('punctuation matches by e.code, letters by e.key (layouts)', () => {
    const fit = act('view.zoomFit', { all: ['Shift+Digit1'] }, ['canvas']);
    const back = act('arrange.backward', { mac: ['Mod+BracketLeft'] }, ['canvas']);
    const d = createDispatcher({ getContext: () => 'canvas', getActions: () => [fit, back, tool], platform: 'mac' });
    expect(d.handle(ev({ key: '&', code: 'Digit1', shiftKey: true }))?.id).toBe('view.zoomFit');
    expect(d.handle(ev({ key: '{', code: 'BracketLeft', metaKey: true }))?.id).toBe('arrange.backward');
    expect(d.handle(ev({ key: 'R', code: 'KeyR' }))?.id).toBe('tool.rect');         // Caps Lock
    expect(d.handle(ev({ key: 'к', code: 'KeyR' }))?.id).toBe('tool.rect');         // Cyrillic falls back to code
    expect(d.handle(ev({ key: 'å', code: 'KeyA', altKey: true }))).toBeNull();
  });
  it('nudge gets {dx,dy} and may repeat', () => {
    const got: unknown[] = [];
    const nudge: Action = { id: 'arrange.nudge', title: 'Nudge', group: 'Arrange', keys: { all: ['ArrowLeft', 'Shift+ArrowLeft'] }, contexts: ['canvas'], run: a => got.push(a) };
    const d = createDispatcher({ getContext: () => 'canvas', getActions: () => [nudge], platform: 'win' });
    d.handle(ev({ key: 'ArrowLeft', code: 'ArrowLeft', repeat: true }));
    d.handle(ev({ key: 'ArrowLeft', code: 'ArrowLeft', shiftKey: true }));
    expect(got).toEqual([{ dx: -1, dy: 0 }, { dx: -10, dy: 0 }]);
  });
  it('when() reason blocks the action', () => {
    const blocked: Action = { ...tool, when: () => 'Nothing selected' };
    run.mockClear();
    const d = createDispatcher({ getContext: () => 'canvas', getActions: () => [blocked], platform: 'mac' });
    expect(d.handle(ev({ key: 'r', code: 'KeyR' }))).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });
  it('resolves focus context from elements', () => {
    const el = (hit: Record<string, unknown>, ctx?: string) => ({
      closest: (s: string) => (hit[s] ? { getAttribute: () => ctx ?? null } : null),
    });
    expect(resolveFocusContext(null)).toBe('canvas');
    expect(resolveFocusContext(el({ 'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role=textbox]': 1 }))).toBe('text-edit');
    expect(resolveFocusContext({ closest: (s: string) => (s === '[data-pg-ctx]' ? { getAttribute: () => 'chat' } : null) })).toBe('chat');
  });
});

describe('prefs', () => {
  const mem = (): StorageLike & { m: Map<string, string> } => {
    const m = new Map<string, string>();
    return { m, getItem: k => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: k => void m.delete(k) };
  };
  it('falls back to defaults on corrupt JSON and bad fields', () => {
    const s = mem();
    s.setItem(PREFS_KEY, '{not json');
    expect(createPrefs(s).get().leftW).toBe(240);
    s.setItem(PREFS_KEY, JSON.stringify({ v: 1, data: { leftW: 'wide', snap: false, theme: 'neon' } }));
    const p = createPrefs(s).get();
    expect(p.leftW).toBe(240); expect(p.snap).toBe(false); expect(p.theme).toBe('light');
    s.setItem(PREFS_KEY, JSON.stringify({ v: 0, data: { snap: false } }));
    expect(createPrefs(s).get().snap).toBe(true);
  });
  it('survives private-mode exceptions and a missing localStorage', () => {
    const boom: StorageLike = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('x'); } };
    const p = createPrefs(boom);
    expect(p.get().fileName).toBe('Untitled');
    p.set({ fileName: 'Hello' });
    expect(p.get().fileName).toBe('Hello');
    p.reload();
    expect(p.get().fileName).toBe('Hello');
    const none = createPrefs(null);
    none.set({ grid: true });
    expect(none.get().grid).toBe(true);
  });
  it('persists, notifies and keeps snapshots stable', () => {
    const s = mem(); const p = createPrefs(s); const f = vi.fn();
    p.subscribe(f);
    const before = p.get();
    expect(p.get()).toBe(before);
    p.set({ speed: 2 });
    expect(f).toHaveBeenCalledTimes(1);
    expect(createPrefs(s).get().speed).toBe(2);
  });
});

describe('flags and toasts', () => {
  it('resolves URL over storage over defaults, ignoring unknown flags', () => {
    const m = new Map<string, string>([['pg.flags', JSON.stringify({ present: true, darkMode: true })]]);
    const storage: StorageLike = { getItem: k => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: k => void m.delete(k) };
    const f = createFlags({ storage, search: () => '#/playground?ff=exportSvg,-darkMode,bogus' });
    expect(f.flag('palette')).toBe(true);
    expect(f.flag('present')).toBe(true);
    expect(f.flag('darkMode')).toBe(false);
    expect(f.flag('exportSvg')).toBe(true);
    expect(f.flag('bogus')).toBe(false);
    expect(createFlags({ storage: null, search: () => '' }).flag('present')).toBe(false);
  });
  it('throttles keyed toasts and caps the stack', () => {
    let t = 0;
    const ts = createToasts(() => t);
    expect(ts.show('View only', { key: 'vo', onceMs: 5000, ttlMs: 0 })).not.toBeNull();
    t = 1000;
    expect(ts.show('View only', { key: 'vo', onceMs: 5000, ttlMs: 0 })).toBeNull();
    t = 6000;
    expect(ts.show('View only', { key: 'vo', onceMs: 5000, ttlMs: 0 })).not.toBeNull();
    for (let i = 0; i < 6; i++) ts.show(`m${i}`, { ttlMs: 0 });
    expect(ts.getToasts().length).toBe(4);
  });
});
