// Autosave, load and format version (HISTORY-28/30/31/37, D10). No React or DOM: storage and the page are injected.
// Only committed document state is saved (store.snapshot()). Presence (cursors, selection, locks, claims) never is.
// Chat, comment pins and the camera plug in through registerExtra(key, { get, set }); they ride in SavedBoard.extras.
import { keysBetween } from './order';
import { toast as defaultToast } from './toast';
import type { ToastOpts } from './toast';
import { PROP_KEYS } from './tree';
import type { Command, DocState, DocStore, Kind, SavedBoard, Shape, ShapeId } from './types';

export const FORMAT = 'contract-board';
export const CURRENT = 1;
export const KEY_PREFIX = 'pg.board.v1.';
export const storageKey = (boardId: string) => KEY_PREFIX + boardId;
const WARN_BYTES = 3_000_000;
const MAX_BYTES = 4_500_000;

// ---- extras registry (chat store, pins, camera) ----
export interface Extra { get(): unknown; set(v: unknown): void }
const extras = new Map<string, Extra>();
/** Plug a store into the save. `get` is read on every save; `set` is called once on load if the save has the key. */
export function registerExtra(key: string, extra: Extra): () => void {
  extras.set(key, extra);
  return () => { if (extras.get(key) === extra) extras.delete(key); };
}
export function clearExtras() { extras.clear(); }

// ---- migrations (pure, fixture-tested) ----
type Rec = Record<string, any>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

/** v0: a flat array of shapes in absolute coordinates, `fill` string, no parents. -> v1 tree with `fills[]`. */
export function migrateV0(old: unknown): Rec {
  const list: Rec[] = Array.isArray(old) ? old : isRec(old) && Array.isArray(old.shapes) ? old.shapes : [];
  const items = list.filter((s) => isRec(s) && typeof s.id === 'string');
  const area = (s: Rec) => Math.abs((s.w ?? 0) * (s.h ?? 0));
  const inside = (c: Rec, s: Rec) =>
    c.x <= s.x && c.y <= s.y && c.x + c.w >= s.x + s.w && c.y + c.h >= s.y + s.h;
  const frames = items.filter((s) => s.kind === 'frame' && finite(s.x) && finite(s.w));
  const parentOf = new Map<string, Rec | null>();
  for (const s of items) {
    if (![s.x, s.y, s.w, s.h].every(finite)) { parentOf.set(s.id, null); continue; }
    let best: Rec | null = null;
    for (const f of frames) {
      if (f === s || f.id === s.id || area(f) <= area(s) || !inside(f, s)) continue;
      if (!best || area(f) < area(best)) best = f;
    }
    parentOf.set(s.id, best);
  }
  const byParent = new Map<string | null, Rec[]>();
  for (const s of items) {
    const p = parentOf.get(s.id)?.id ?? null;
    byParent.set(p, [...(byParent.get(p) ?? []), s]);
  }
  const shapes: Rec[] = [];
  for (const [p, kids] of byParent) {
    const keys = keysBetween(kids.length);
    kids.forEach((s, i) => {
      const par = parentOf.get(s.id);
      const { fill: _f, ...rest } = s;
      shapes.push({
        ...rest,
        ...(par ? { x: s.x - par.x, y: s.y - par.y } : {}),
        fills: Array.isArray(s.fills) ? s.fills : typeof s.fill === 'string' ? [{ type: 'solid', color: s.fill }] : [],
        parent: p, index: keys[i], createdBy: s.createdBy ?? 'human-you', stamps: {},
      });
    });
  }
  const board = isRec(old) ? old : {};
  return {
    format: FORMAT, v: 1, boardId: board.boardId ?? 'board', meta: { name: board.meta?.name ?? 'Untitled' },
    savedAt: board.savedAt ?? 0, lamport: 0, seq: {}, shapes,
  };
}

/** MIGRATIONS[n] upgrades a document at version n to n+1. */
export const MIGRATIONS: Record<number, (doc: Rec) => Rec> = {};

export type Loaded =
  | { status: 'ok'; board: SavedBoard; dropped: number }
  | { status: 'future' | 'corrupt'; v?: number };

/** Parse, migrate and validate a stored string. Bad shapes are dropped and counted, never thrown. */
export function parseSaved(raw: string): Loaded {
  let doc: unknown;
  try { doc = JSON.parse(raw); } catch { return { status: 'corrupt' }; }
  let rec: Rec;
  if (Array.isArray(doc)) rec = migrateV0(doc);
  else if (!isRec(doc)) return { status: 'corrupt' };
  else if (doc.format !== FORMAT) {
    if (Array.isArray(doc.shapes)) rec = migrateV0(doc); else return { status: 'corrupt' };
  } else {
    const v = typeof doc.v === 'number' ? doc.v : 0;
    if (v > CURRENT) return { status: 'future', v };
    rec = v < 1 ? migrateV0(doc) : doc;
    for (let n = Math.max(v, 1); n < CURRENT; n++) rec = MIGRATIONS[n]?.(rec) ?? rec;
  }
  const all: unknown[] = Array.isArray(rec.shapes) ? rec.shapes : [];
  const shapes = all.filter((s): s is Rec =>
    isRec(s) && typeof s.id === 'string' && typeof s.kind === 'string' && [s.x, s.y, s.w, s.h].every((n) => n === undefined || finite(n)));
  const board: SavedBoard = {
    format: FORMAT, v: CURRENT, boardId: String(rec.boardId ?? 'board'),
    meta: isRec(rec.meta) ? { name: 'Untitled', ...rec.meta } : { name: 'Untitled' },
    savedAt: finite(rec.savedAt) ? rec.savedAt : 0, lamport: finite(rec.lamport) ? rec.lamport : 0,
    seq: isRec(rec.seq) ? rec.seq : {}, shapes: shapes as unknown as SavedBoard['shapes'],
    ...(Array.isArray(rec.logTail) ? { logTail: rec.logTail } : {}),
    ...(isRec(rec.extras) ? { extras: rec.extras } : {}),
  };
  return { status: 'ok', board, dropped: all.length - shapes.length };
}

// ---- autosave ----
export type SaveStatus = 'saved' | 'saving' | 'error' | 'full';
export interface PersistState { status: SaveStatus; savedAt: number | null; bytes: number }
export interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem?(k: string): void }
export interface PersistOpts {
  boardId: string;
  /** `?demo=1`: ignore the saved board and never overwrite it. */
  demo?: boolean;
  debounceMs?: number;
  storage?: StorageLike | null;
  toast?: (text: string, o?: ToastOpts) => unknown;
  now?: () => number;
  /** Where to listen for `pagehide`, `visibilitychange` and cross-tab `storage` events. Defaults to window. */
  target?: { addEventListener(t: string, f: (e: any) => void): void; removeEventListener(t: string, f: (e: any) => void): void } | null;
}
export interface Persistence {
  /** Load the saved board into the store (if any). Returns true when a saved board was applied. Call before the first render. */
  load(): boolean;
  flush(): void;
  getState(): PersistState;
  subscribe(f: () => void): () => void;
  /** Export the current document as JSON text (the quota toast offers this). */
  exportJson(): string;
  dispose(): void;
}

function defaultStorage(): StorageLike | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

export function createPersistence(store: DocStore, o: PersistOpts): Persistence {
  const storage = o.storage === undefined ? defaultStorage() : o.storage;
  const say = o.toast ?? defaultToast;
  const now = o.now ?? Date.now;
  const key = storageKey(o.boardId);
  const delay = o.debounceMs ?? 500;
  const target = o.target === undefined ? (typeof window !== 'undefined' ? window : null) : o.target;
  let state: PersistState = { status: 'saved', savedAt: null, bytes: 0 };
  let timer: ReturnType<typeof setTimeout> | null = null;
  let blocked = !!o.demo;  // demo, or a save from a newer app: never write
  let warnedFull = false;
  const subs = new Set<() => void>();
  const set = (p: Partial<PersistState>) => { state = { ...state, ...p }; subs.forEach((f) => f()); };

  function build(): SavedBoard {
    const snap = store.snapshot();
    const ex: Record<string, unknown> = {};
    for (const [k, e] of extras) { try { ex[k] = e.get(); } catch (err) { console.error('[persist] extra', k, err); } }
    return { ...snap, boardId: o.boardId, extras: ex };
  }

  function write(): void {
    timer = null;
    if (blocked) return;
    savedRev = store.getState().rev;
    if (!storage) { set({ status: 'error' }); return; }
    let text = JSON.stringify(build());
    if (text.length > MAX_BYTES) {   // drop the log tail first; the document itself is what matters
      const b = build(); delete b.logTail; text = JSON.stringify(b);
    }
    try {
      storage.setItem(key, text);
      warnedFull = false;
      set({ status: 'saved', savedAt: now(), bytes: text.length });
      if (text.length > WARN_BYTES) say('Board is getting large; export JSON to keep a copy', { variant: 'warn', key: 'persist-large', onceMs: 60_000 });
    } catch {
      set({ status: 'full', bytes: text.length });
      if (!warnedFull) { warnedFull = true; say('Could not save: storage full. Export JSON to keep your work.', { variant: 'error', ttlMs: 6000 }); }
    }
  }

  const schedule = () => {
    if (blocked) return;
    if (state.status !== 'saving') set({ status: 'saving' });
    if (timer) clearTimeout(timer);
    timer = setTimeout(write, delay);
  };
  let savedRev = store.getState().rev;
  // change notifications are batched in a microtask, so a flush right after an edit also checks the rev
  const flush = () => {
    if (timer) clearTimeout(timer);
    if (timer || store.getState().rev !== savedRev) write();
  };
  const offChange = store.onChange(schedule);
  const onHide = () => flush();
  const onVis = () => { if (typeof document !== 'undefined' && document.visibilityState === 'hidden') flush(); };
  const onStorage = (e: { key?: string | null }) => {
    if (e.key === key) say('This board changed in another tab. Saving here would overwrite it; reload to see it.', { variant: 'warn', key: 'persist-tab', onceMs: 10_000 });
  };
  target?.addEventListener('pagehide', onHide);
  target?.addEventListener('visibilitychange', onVis);
  target?.addEventListener('storage', onStorage);

  function load(): boolean {
    if (o.demo || !storage) return false;
    let raw: string | null = null;
    try { raw = storage.getItem(key); } catch { return false; }
    if (raw === null) return false;
    const r = parseSaved(raw);
    if (r.status === 'future') {
      blocked = true;  // leave the stored data untouched
      say('This board was saved by a newer version of Contract. It was not loaded and will not be overwritten.', { variant: 'error', ttlMs: 8000 });
      return false;
    }
    if (r.status !== 'ok') {
      try { storage.setItem(`${key}:corrupt:${now()}`, raw); } catch { /* backup is best effort */ }
      say('Saved board was unreadable. A backup was kept; starting empty.', { variant: 'error', ttlMs: 6000 });
      return false;
    }
    try { store.load(r.board); } catch (e) {
      console.error('[persist] load failed', e);
      try { storage.setItem(`${key}:corrupt:${now()}`, raw); } catch { /* ignore */ }
      say('Saved board could not be loaded. A backup was kept; starting empty.', { variant: 'error', ttlMs: 6000 });
      return false;
    }
    for (const [k, v] of Object.entries(r.board.extras ?? {})) {
      try { extras.get(k)?.set(v); } catch (e) { console.error('[persist] extra', k, e); }
    }
    if (r.dropped) say(`Skipped ${r.dropped} damaged layer${r.dropped === 1 ? '' : 's'} while loading`, { variant: 'warn', ttlMs: 5000 });
    set({ status: 'saved', savedAt: r.board.savedAt || null, bytes: raw.length });
    return true;
  }

  return {
    load, flush, getState: () => state,
    subscribe(f) { subs.add(f); return () => { subs.delete(f); }; },
    exportJson: () => JSON.stringify(build(), null, 2),
    dispose() {
      flush(); offChange();
      target?.removeEventListener('pagehide', onHide);
      target?.removeEventListener('visibilitychange', onVis);
      target?.removeEventListener('storage', onStorage);
    },
  };
}

// ---- file export / import (HISTORY-32, SHARE-9, SHARE-10) ----
// A file is exactly a SavedBoard (same format and version as the autosave), minus tombstones and the op-log tail.
export const FILE_EXT = '.contract.json';
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
export const MAX_IMPORT_SHAPES = 50_000;
const KINDS: readonly Kind[] = ['frame', 'group', 'rect', 'ellipse', 'text', 'line', 'image'];

/** `<name>-<YYYY-MM-DD>.contract.json`, safe for every filesystem. */
export function exportFileName(name: string, date: Date = new Date()): string {
  const clean = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').trim().replace(/^\.+/, '') || 'board';
  return `${clean}-${date.toISOString().slice(0, 10)}${FILE_EXT}`;
}

/** Turn the persistence JSON into the file text: tombstones and the op-log tail are left out. */
export function toFileText(json: string): string {
  const b = JSON.parse(json) as SavedBoard;
  delete b.logTail;
  b.shapes = b.shapes.filter((s) => !s.deleted);
  return JSON.stringify(b, null, 2);
}

export type ImportResult =
  | { ok: true; board: SavedBoard; shapes: Shape[]; dropped: number }
  | { ok: false; error: string };

/** Validate a picked file's text. Never throws; the error is a sentence for a toast. */
export function parseImport(text: string, byteLength: number = text.length): ImportResult {
  if (byteLength > MAX_IMPORT_BYTES) return { ok: false, error: `File is too large (${(byteLength / 1048576).toFixed(1)} MB, limit ${MAX_IMPORT_BYTES / 1048576} MB)` };
  let doc: unknown;
  try { doc = JSON.parse(text); } catch { return { ok: false, error: 'Not a valid JSON file' }; }
  if (!isRec(doc) || doc.format !== FORMAT) return { ok: false, error: 'Not a Contract board file' };
  if (typeof doc.v !== 'number') return { ok: false, error: 'Board file has no version' };
  if (doc.v > CURRENT) return { ok: false, error: 'This file was saved by a newer version of Contract' };
  if (!Array.isArray(doc.shapes)) return { ok: false, error: 'Board file has no shapes list' };
  if (doc.shapes.length > MAX_IMPORT_SHAPES) return { ok: false, error: `Too many layers (${doc.shapes.length}, limit ${MAX_IMPORT_SHAPES})` };
  const r = parseSaved(text);
  if (r.status !== 'ok') return { ok: false, error: r.status === 'future' ? 'This file was saved by a newer version of Contract' : 'Board file is damaged' };
  const seen = new Set<string>();
  let dropped = r.dropped;
  const shapes: Shape[] = [];
  for (const s of r.board.shapes as Shape[]) {
    if (s.deleted) continue;                                        // tombstones are not layers
    if (!KINDS.includes(s.kind) || seen.has(s.id)) { dropped++; continue; }
    seen.add(s.id); shapes.push(s);
  }
  if (!shapes.length) return { ok: false, error: 'Board file has no layers' };
  return { ok: true, board: r.board, shapes, dropped };
}

export interface ImportPlan { commands: Command[]; created: number; removed: number }

/**
 * Commands that apply an import as ONE batch (one undo step). Every id is remapped through `$n` refs, so a merge can
 * never overwrite anything. 'replace' removes the current root layers first; 'merge' appends the imported roots
 * to the right of the existing content, so they land in empty space.
 */
export function planImport(st: Pick<DocState, 'shapes'>, shapes: readonly Shape[], mode: 'replace' | 'merge'): ImportPlan {
  const byId = new Map(shapes.map((s) => [s.id, s]));
  // a missing parent, or a parent loop, makes the shape a root
  const parentOf = (s: Shape): ShapeId | null => {
    if (s.parent === null || !byId.has(s.parent)) return null;
    const seen = new Set<ShapeId>([s.id]);
    for (let p: ShapeId | null = s.parent; p !== null; p = byId.get(p)?.parent ?? null) {
      if (seen.has(p)) return null;
      seen.add(p);
    }
    return s.parent;
  };
  const kids = new Map<ShapeId | null, Shape[]>();
  for (const s of shapes) {
    const p = parentOf(s);
    kids.set(p, [...(kids.get(p) ?? []), s]);
  }
  for (const l of kids.values()) l.sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : a.id < b.id ? -1 : 1));

  const live = [...st.shapes.values()].filter((s) => !s.deleted);
  const liveRoots = live.filter((s) => s.parent === null || !st.shapes.get(s.parent) || st.shapes.get(s.parent)!.deleted);
  const commands: Command[] = [];
  let removed = 0;
  if (mode === 'replace' && liveRoots.length) { commands.push({ t: 'shape.delete', ids: liveRoots.map((s) => s.id) }); removed = live.length; }

  let dx = 0, dy = 0;
  const roots = kids.get(null) ?? [];
  if (mode === 'merge' && liveRoots.length && roots.length) {
    const maxRight = Math.max(...liveRoots.map((s) => s.x + s.w));
    const topY = Math.min(...liveRoots.map((s) => s.y));
    const minX = Math.min(...roots.map((s) => s.x)), minY = Math.min(...roots.map((s) => s.y));
    dx = maxRight + 80 - minX; dy = topY - minY;
  }

  const cmdIndex = new Map<ShapeId, number>();
  const emit = (s: Shape, parent: ShapeId | null) => {
    const props: Record<string, unknown> = {};
    for (const k of PROP_KEYS) if (s[k] !== undefined) props[k] = structuredClone(s[k]);
    delete props.humanEdited; delete props.author;   // ownership belongs to whoever imports
    if (parent === null && (dx || dy)) { props.x = s.x + dx; props.y = s.y + dy; }
    cmdIndex.set(s.id, commands.length);
    commands.push({ t: 'shape.create', kind: s.kind, props, parent: parent === null ? null : `$${cmdIndex.get(parent)}` } as Command);
    for (const c of kids.get(s.id) ?? []) emit(c, s.id);
  };
  for (const r of roots) emit(r, null);
  return { commands, created: cmdIndex.size, removed };
}
