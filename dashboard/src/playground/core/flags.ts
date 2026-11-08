// Feature flags (SHELL-24). Order: URL `?ff=a,b,-c`, then localStorage `pg.flags`, then defaults.
import { browserStorage, type StorageLike } from './prefs';

export const FLAG_DEFAULTS = {
  palette: true, present: false, darkMode: false, exportSvg: false, perfHud: false,
  viewOnly: false, onboarding: true, telemetry: true,
} as const;
export type FlagName = keyof typeof FLAG_DEFAULTS;
export const FLAGS_KEY = 'pg.flags';

/** Parse `ff=a,b,-c` out of a query string or a `#/playground?ff=...` hash. Unknown names are dropped. */
export function parseFf(search: string): Partial<Record<FlagName, boolean>> {
  const out: Partial<Record<FlagName, boolean>> = {};
  const q = search.includes('?') ? search.slice(search.indexOf('?') + 1) : search.replace(/^#/, '');
  const ff = new URLSearchParams(q).get('ff');
  if (!ff) return out;
  for (const raw of ff.split(',')) {
    const off = raw.startsWith('-');
    const name = (off ? raw.slice(1) : raw).trim();
    if (name in FLAG_DEFAULTS) out[name as FlagName] = !off;
  }
  return out;
}

export function createFlags(o: { search?: () => string; storage?: StorageLike | null } = {}) {
  const storage = o.storage === undefined ? browserStorage() : o.storage;
  const search = o.search ?? (() => {
    const l = (globalThis as { location?: { search: string; hash: string } }).location;
    return l ? `${l.search}${l.hash}` : '';
  });
  const subs = new Set<() => void>();

  const stored = (): Partial<Record<FlagName, boolean>> => {
    try {
      const raw = storage?.getItem(FLAGS_KEY);
      if (!raw) return {};
      const v = JSON.parse(raw) as Record<string, unknown>;
      const out: Partial<Record<FlagName, boolean>> = {};
      for (const k of Object.keys(FLAG_DEFAULTS)) if (typeof v[k] === 'boolean') out[k as FlagName] = v[k] as boolean;
      return out;
    } catch { return {}; }
  };

  /** Unknown names are always false. */
  function flag(name: string): boolean {
    if (!(name in FLAG_DEFAULTS)) return false;
    const n = name as FlagName;
    const url = parseFf(search());
    if (n in url) return url[n]!;
    const s = stored();
    if (n in s) return s[n]!;
    return FLAG_DEFAULTS[n];
  }

  return {
    flag,
    /** Persist an override (dev palette "Toggle flag..."). */
    setFlag(name: FlagName, on: boolean) {
      if (!(name in FLAG_DEFAULTS)) return;
      try { storage?.setItem(FLAGS_KEY, JSON.stringify({ ...stored(), [name]: on })); } catch { /* ignore */ }
      subs.forEach(f => f());
    },
    all: (): Record<FlagName, boolean> =>
      Object.fromEntries((Object.keys(FLAG_DEFAULTS) as FlagName[]).map(k => [k, flag(k)])) as Record<FlagName, boolean>,
    subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; },
  };
}

const defaultFlags = createFlags();
export const flag = defaultFlags.flag;
export const setFlag = defaultFlags.setFlag;
export const allFlags = defaultFlags.all;
export const subscribeFlags = defaultFlags.subscribe;
