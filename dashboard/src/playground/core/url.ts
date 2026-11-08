// Share links and view persistence (SHARE-1, SHARE-2, CANVAS-36, CANVAS-37). Pure: no React, no DOM.
// A link is `#/playground?x=<cx>&y=<cy>&z=<zoom>&sel=<id,id>`: x,y = world point at the view centre, so the
// same link shows the same region in any window size. Ids and numbers only, never personal data.
import type { Cam } from './types';
import type { StorageLike } from './prefs';
import { clampZoom } from './camera';

export interface View { x: number; y: number; z: number }
export interface DecodedUrl { view: View | null; sel: string[] }

export const ROUTE = '#/playground';
export const MAX_SEL = 20;
export const MAX_COORD = 1e6;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export const isValidId = (s: unknown): s is string => typeof s === 'string' && ID_RE.test(s);
const finite = (n: number) => Number.isFinite(n);
const clampC = (n: number) => Math.max(-MAX_COORD, Math.min(MAX_COORD, n));

/** `#/playground?x=..&y=..&z=..&sel=a,b`. Rounds x,y to integers and z to 3 decimals; at most 20 valid ids. */
export function encodeView(view: View, sel: readonly string[] = []): string {
  const p = new URLSearchParams();
  if (finite(view.x) && finite(view.y) && finite(view.z)) {
    p.set('x', String(Math.round(clampC(view.x))));
    p.set('y', String(Math.round(clampC(view.y))));
    p.set('z', String(Number(clampZoom(view.z).toFixed(3))));
  }
  const ids = [...new Set(sel.filter(isValidId))].slice(0, MAX_SEL);
  let q = p.toString();
  if (ids.length) q += (q ? '&' : '') + 'sel=' + ids.join(',');   // commas stay readable
  return ROUTE + (q ? '?' + q : '');
}

const num = (s: string | null): number | null => {
  if (s === null || s.trim() === '') return null;
  const n = Number(s);
  return finite(n) ? n : null;
};

/** Reads the query part of a hash. Never throws; bad or missing fields give `view: null` / no ids. */
export function decodeView(hash: string): DecodedUrl {
  const out: DecodedUrl = { view: null, sel: [] };
  try {
    const q = typeof hash === 'string' && hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '';
    const p = new URLSearchParams(q);
    let x = num(p.get('x')), y = num(p.get('y')), z = num(p.get('z'));
    const v = p.get('v');                                           // also accept `v=cx,cy,z`
    if (v && x === null && y === null && z === null) {
      const [a, b, c] = v.split(',');
      x = num(a ?? null); y = num(b ?? null); z = num(c ?? null);
    }
    if (x !== null && y !== null && z !== null && z > 0) out.view = { x: clampC(x), y: clampC(y), z: clampZoom(z) };
    const sel = (p.get('sel') ?? '').split(',').filter(isValidId);
    out.sel = [...new Set(sel)].slice(0, MAX_SEL);
  } catch { /* junk hash: defaults */ }
  return out;
}

export const hasView = (hash: string): boolean => decodeView(hash).view !== null;

// ---- camera <-> centre view ----
export function camToView(cam: Cam, size: { w: number; h: number }): View {
  return { x: (size.w / 2 - cam.x) / cam.z, y: (size.h / 2 - cam.y) / cam.z, z: cam.z };
}
export function viewToCam(v: View, size: { w: number; h: number }): Cam {
  return { z: v.z, x: size.w / 2 - v.x * v.z, y: size.h / 2 - v.y * v.z };
}

// ---- last view per board (CANVAS-37). Own key because Prefs has no camera field. ----
export const VIEW_KEY = 'pg.view.v1';

export function loadSavedView(storage: StorageLike | null, boardId = 'playground'): View | null {
  try {
    const raw = storage?.getItem(VIEW_KEY);
    if (!raw) return null;
    const v = (JSON.parse(raw) as { boards?: Record<string, unknown> })?.boards?.[boardId] as Partial<View> | undefined;
    if (!v || typeof v.x !== 'number' || typeof v.y !== 'number' || typeof v.z !== 'number') return null;
    if (!finite(v.x) || !finite(v.y) || !finite(v.z) || v.z <= 0) return null;
    return { x: clampC(v.x), y: clampC(v.y), z: clampZoom(v.z) };
  } catch { return null; }
}

export function saveView(storage: StorageLike | null, view: View, boardId = 'playground'): void {
  if (!storage) return;
  try {
    let boards: Record<string, View> = {};
    try {
      const old = JSON.parse(storage.getItem(VIEW_KEY) ?? 'null') as { boards?: Record<string, View> } | null;
      if (old && typeof old.boards === 'object' && old.boards) boards = old.boards;
    } catch { /* corrupt: start over */ }
    boards[boardId] = { x: Math.round(view.x), y: Math.round(view.y), z: Number(view.z.toFixed(4)) };
    storage.setItem(VIEW_KEY, JSON.stringify({ v: 1, boards }));
  } catch { /* quota, private mode */ }
}
