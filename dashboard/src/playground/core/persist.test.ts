import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSeqs } from './ids';
import { clearExtras, createPersistence, migrateV0, parseSaved, registerExtra, storageKey } from './persist';
import type { StorageLike } from './persist';
import { createDocStore } from './store';
import type { Op } from './types';

const H = 'human-you';
const rect = (id: string): Op => ({ t: 'create', shape: { id, kind: 'rect', name: id, x: 1, y: 2, w: 10, h: 10, fills: [], parent: null, index: 'V', createdBy: H } });
const mem = (): StorageLike & { m: Map<string, string> } => {
  const m = new Map<string, string>();
  return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); } };
};
const tick = () => Promise.resolve();

beforeEach(() => { resetSeqs(); clearExtras(); vi.useFakeTimers(); });
afterEach(() => vi.useRealTimers());

describe('migration', () => {
  it('v0 flat array with fill becomes v1 with fills[] and parent from geometry', () => {
    const v0 = [
      { id: 'f', kind: 'frame', x: 100, y: 100, w: 300, h: 300, fill: '#fff' },
      { id: 'r', kind: 'rect', x: 150, y: 120, w: 50, h: 50, fill: '#f00' },
      { id: 'o', kind: 'rect', x: 900, y: 900, w: 5, h: 5, fill: '#000' },
    ];
    const m = migrateV0(v0);
    const by = Object.fromEntries(m.shapes.map((s: any) => [s.id, s]));
    expect(by.r.parent).toBe('f');
    expect(by.r.x).toBe(50); expect(by.r.y).toBe(20);
    expect(by.r.fills).toEqual([{ type: 'solid', color: '#f00' }]);
    expect(by.r.fill).toBeUndefined();
    expect(by.o.parent).toBeNull();
    const r = parseSaved(JSON.stringify(v0));
    expect(r.status).toBe('ok');
    const store = createDocStore();
    if (r.status === 'ok') store.load(r.board);
    expect(store.getState().shapes.get('r')!.parent).toBe('f');
  });
  it('drops bad shapes and counts them; refuses future versions; flags corrupt JSON', () => {
    const doc = { format: 'contract-board', v: 1, boardId: 'b', meta: { name: 'x' }, savedAt: 1, lamport: 0, seq: {}, shapes: [{ id: 'a', kind: 'rect', x: 0, y: 0, w: 1, h: 1 }, { id: 'b', kind: 'rect', x: null }, 7] };
    const r = parseSaved(JSON.stringify(doc));
    expect(r.status === 'ok' && r.dropped).toBe(2);
    expect(parseSaved(JSON.stringify({ ...doc, v: 99 })).status).toBe('future');
    expect(parseSaved('{nope').status).toBe('corrupt');
  });
});

describe('autosave', () => {
  it('saves after the debounce, shows saving then saved, restores shapes, seqs and extras', async () => {
    const storage = mem();
    const say = vi.fn();
    const store = createDocStore({ boardId: 'b' });
    let chat: unknown = ['hi'];
    registerExtra('chat', { get: () => chat, set: (v) => { chat = v; } });
    const p = createPersistence(store, { boardId: 'b', storage, toast: say, target: null });
    store.dispatch(H, 'Draw', [rect('a')]);
    await tick();
    expect(p.getState().status).toBe('saving');
    expect(storage.m.size).toBe(0);
    vi.advanceTimersByTime(500);
    expect(p.getState().status).toBe('saved');
    const saved = JSON.parse(storage.m.get(storageKey('b'))!);
    expect(saved.extras.chat).toEqual(['hi']);
    expect(saved.seq[H]).toBe(1);

    resetSeqs(); chat = [];
    const s2 = createDocStore({ boardId: 'b' });
    const p2 = createPersistence(s2, { boardId: 'b', storage, toast: say, target: null });
    expect(p2.load()).toBe(true);
    expect(s2.getState().shapes.has('a')).toBe(true);
    expect(chat).toEqual(['hi']);
    s2.dispatch(H, 'Draw', [rect('c')]);
    expect(s2.log().at(-1)!.opId).toBe(`${H}:2`); // seq continues, no collision
  });
  it('?demo=1 neither loads nor overwrites the saved board', async () => {
    const storage = mem();
    storage.m.set(storageKey('b'), 'keep');
    const store = createDocStore({ boardId: 'b' });
    const p = createPersistence(store, { boardId: 'b', storage, demo: true, toast: vi.fn(), target: null });
    expect(p.load()).toBe(false);
    store.dispatch(H, 'Draw', [rect('a')]);
    vi.advanceTimersByTime(1000);
    expect(storage.m.get(storageKey('b'))).toBe('keep');
  });
  it('corrupt JSON starts empty, toasts and keeps a backup', () => {
    const storage = mem(); const say = vi.fn();
    storage.m.set(storageKey('b'), '{broken');
    const store = createDocStore({ boardId: 'b' });
    expect(createPersistence(store, { boardId: 'b', storage, toast: say, target: null, now: () => 5 }).load()).toBe(false);
    expect(say).toHaveBeenCalled();
    expect(storage.m.get(storageKey('b') + ':corrupt:5')).toBe('{broken');
  });
  it('future version is left untouched and never overwritten', () => {
    const storage = mem(); const say = vi.fn();
    const raw = JSON.stringify({ format: 'contract-board', v: 9, shapes: [] });
    storage.m.set(storageKey('b'), raw);
    const store = createDocStore({ boardId: 'b' });
    const p = createPersistence(store, { boardId: 'b', storage, toast: say, target: null });
    expect(p.load()).toBe(false);
    store.dispatch(H, 'Draw', [rect('a')]);
    vi.advanceTimersByTime(1000);
    expect(storage.m.get(storageKey('b'))).toBe(raw);
  });
  it('quota errors toast instead of throwing, once', async () => {
    const say = vi.fn();
    const storage: StorageLike = { getItem: () => null, setItem: () => { throw new DOMException('full', 'QuotaExceededError'); } };
    const store = createDocStore({ boardId: 'b' });
    const p = createPersistence(store, { boardId: 'b', storage, toast: say, target: null });
    store.dispatch(H, 'Draw', [rect('a')]);
    await tick();
    vi.advanceTimersByTime(500);
    store.dispatch(H, 'Draw', [rect('b')]);
    await tick();
    vi.advanceTimersByTime(500);
    expect(p.getState().status).toBe('full');
    expect(say).toHaveBeenCalledTimes(1);
  });
  it('flush writes immediately (pagehide)', () => {
    const storage = mem();
    const store = createDocStore({ boardId: 'b' });
    const p = createPersistence(store, { boardId: 'b', storage, toast: vi.fn(), target: null });
    store.dispatch(H, 'Draw', [rect('a')]);
    p.flush();
    expect(storage.m.has(storageKey('b'))).toBe(true);
  });
});
