// Loads and saves lineage.json through the dev plugin. Without it (a static build), falls back to
// localStorage and says so, so the page still works but decisions stay in this browser.
import { useCallback, useEffect, useRef, useState } from 'react';
import { EMPTY_LINEAGE, normalizeLineage } from './files.ts';
import type { ScaffoldRequest } from './files.ts';
import type { Lineage } from './types.ts';

const LOCAL_KEY = 'vx.lineage.v1';
export type SaveMode = 'loading' | 'repo' | 'local';

function readLocal(): Lineage {
  try { return normalizeLineage(JSON.parse(localStorage.getItem(LOCAL_KEY) ?? 'null')); } catch { return EMPTY_LINEAGE; }
}

async function json(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body;
}

export function useLineage() {
  const [lineage, setLineage] = useState<Lineage>(EMPTY_LINEAGE);
  const [mode, setMode] = useState<SaveMode>('loading');
  const [error, setError] = useState<string | null>(null);
  const modeRef = useRef<SaveMode>('loading');

  useEffect(() => {
    let live = true;
    fetch('/__variants/lineage')
      .then((r) => (r.headers.get('content-type')?.includes('json') ? json(r) : Promise.reject(new Error('no dev endpoint'))))
      .then((l) => { if (live) { setLineage(normalizeLineage(l)); setMode((modeRef.current = 'repo')); } })
      .catch(() => { if (live) { setLineage(readLocal()); setMode((modeRef.current = 'local')); } });
    return () => { live = false; };
  }, []);

  const save = useCallback(async (next: Lineage) => {
    setLineage(next);
    setError(null);
    if (modeRef.current !== 'repo') {
      try { localStorage.setItem(LOCAL_KEY, JSON.stringify(next)); } catch { /* storage full or blocked */ }
      return;
    }
    try {
      await json(await fetch('/__variants/lineage', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(next) }));
    } catch (e) {
      setError(`Not saved: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  const scaffold = useCallback(async (req: ScaffoldRequest): Promise<string> => {
    if (modeRef.current !== 'repo') throw new Error('Creating variant files needs the dev server (npm run dashboard).');
    const body = await json(await fetch('/__variants/scaffold', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req) }));
    return (body as { path: string }).path;
  }, []);

  return { lineage, mode, error, setError, save, scaffold };
}
