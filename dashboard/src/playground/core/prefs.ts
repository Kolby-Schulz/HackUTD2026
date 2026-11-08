// Persisted settings (SHELL-29). localStorage key `pg.prefs.v1`, never throws, memory fallback.
export interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

export const PREFS_KEY = 'pg.prefs.v1';
export const PREFS_VERSION = 1;

export interface Prefs {
  leftW: number; rightW: number; leftCollapsed: boolean; rightCollapsed: boolean; uiHidden: boolean;
  theme: 'light' | 'dark' | 'system'; snap: boolean; grid: boolean; names: boolean; speed: number;
  recents: string[]; onboarding: Record<string, boolean>; fileName: string; flags: Record<string, boolean>;
  bindings: Record<string, string>;                 // commandId -> user override (KEYS-16)
}

export const PREF_DEFAULTS: Prefs = {
  leftW: 240, rightW: 260, leftCollapsed: false, rightCollapsed: false, uiHidden: false,
  theme: 'light', snap: true, grid: false, names: true, speed: 1,
  recents: [], onboarding: {}, fileName: 'Untitled', flags: {}, bindings: {},
};

const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const num = (lo: number, hi: number) => (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const rec = (check: (v: unknown) => boolean) => (v: unknown): boolean =>
  !!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v as object).every(check);

/** Per-field validators: a bad field falls back to its default, the rest survive. */
const VALID: { [K in keyof Prefs]: (v: unknown) => boolean } = {
  leftW: num(160, 600), rightW: num(160, 600), leftCollapsed: isBool, rightCollapsed: isBool, uiHidden: isBool,
  theme: v => v === 'light' || v === 'dark' || v === 'system',
  snap: isBool, grid: isBool, names: isBool, speed: num(0.1, 10),
  recents: v => Array.isArray(v) && v.length <= 50 && v.every(x => typeof x === 'string'),
  onboarding: rec(isBool), fileName: v => typeof v === 'string' && v.length <= 200, flags: rec(isBool),
  bindings: rec(x => typeof x === 'string'),
};

/** Turn any parsed value into a full valid Prefs. Older versions are dropped (defaults), newer are read best-effort. */
export function sanitize(raw: unknown): Prefs {
  const out: Prefs = { ...PREF_DEFAULTS, recents: [], onboarding: {}, flags: {}, bindings: {} };
  if (!raw || typeof raw !== 'object') return out;
  const env = raw as { v?: unknown; data?: unknown };
  if (typeof env.v !== 'number' || env.v < PREFS_VERSION) return out;   // migration point: drop old schemas
  const data = env.data;
  if (!data || typeof data !== 'object') return out;
  for (const k of Object.keys(VALID) as (keyof Prefs)[]) {
    const v = (data as Record<string, unknown>)[k];
    if (v !== undefined && VALID[k](v)) (out as unknown as Record<string, unknown>)[k] = v;
  }
  return out;
}

/** localStorage if it exists and works, else null (SSR, tests, some private modes throw on access). */
export function browserStorage(): StorageLike | null {
  try {
    const s = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (!s) return null;
    s.getItem('pg.probe');
    return s;
  } catch { return null; }
}

export function createPrefs(storage: StorageLike | null = browserStorage()) {
  const subs = new Set<() => void>();
  let memory: string | null = null;               // fallback when storage throws
  const read = (): string | null => {
    if (storage) { try { return storage.getItem(PREFS_KEY); } catch { /* fall through */ } }
    return memory;
  };
  const write = (s: string) => {
    memory = s;
    if (storage) { try { storage.setItem(PREFS_KEY, s); } catch { /* quota, private mode: memory only */ } }
  };
  const parse = (): Prefs => {
    const s = read();
    if (s == null) return sanitize(null);
    try { return sanitize(JSON.parse(s)); } catch { return sanitize(null); }
  };

  let snap = parse();
  const emit = () => subs.forEach(f => f());
  function reload() { snap = parse(); emit(); }

  return {
    /** Stable between changes, so it works as a useSyncExternalStore snapshot. */
    get: (): Prefs => snap,
    set(patch: Partial<Prefs>) {
      const next = sanitize({ v: PREFS_VERSION, data: { ...snap, ...patch } });
      snap = next;
      write(JSON.stringify({ v: PREFS_VERSION, data: next }));
      emit();
    },
    reset() { snap = sanitize(null); write(JSON.stringify({ v: PREFS_VERSION, data: snap })); emit(); },
    /** Re-read storage (cross-tab `storage` event). */
    reload,
    subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; },
    /** Browser only: hook the `storage` event for cross-tab sync. Returns an unsubscribe. */
    attachCrossTab(win: { addEventListener(t: 'storage', f: (e: { key: string | null }) => void): void; removeEventListener(t: 'storage', f: (e: { key: string | null }) => void): void }) {
      const h = (e: { key: string | null }) => { if (e.key === null || e.key === PREFS_KEY) reload(); };
      win.addEventListener('storage', h);
      return () => win.removeEventListener('storage', h);
    },
  };
}

export const prefs = createPrefs();
