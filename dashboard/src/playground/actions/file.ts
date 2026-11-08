// File actions (HISTORY-32, SHARE-9, SHARE-10): export the board as `<name>-<date>.contract.json` (the autosave
// format) and import such a file, replacing or adding to the board as ONE undo step. Validation lives in core/persist.
import type { BoardKit } from '../core/commands';
import { downloadBlob } from '../core/export';
import { opId } from '../core/ids';
import { exportFileName, parseImport, planImport, toFileText } from '../core/persist';
import { prefs } from '../core/prefs';
import { toast } from '../core/toast';
import type { Action } from '../core/types';
import { activeBoard } from '../ui/board/state';
import { confirm } from '../ui/shell/Dialog';

export function exportBoard(): void {
  const env = activeBoard();
  if (!env) return;
  try {
    const p = env.ui.get().persistence;
    const json = p ? p.exportJson() : JSON.stringify(env.board.doc.snapshot());
    const name = exportFileName(prefs.get().fileName || 'board');
    downloadBlob(new Blob([toFileText(json)], { type: 'application/json' }), name);
    toast(`Exported ${name}`, { key: 'file.export', onceMs: 1500 });
  } catch (e) {
    console.error('[file] export', e);
    toast('Could not export the board', { variant: 'error' });
  }
}

/** Apply validated shapes to the board as one batch. Returns the result text for tests and toasts. */
export function applyImport(b: BoardKit, shapes: Parameters<typeof planImport>[1], mode: 'replace' | 'merge'): { ok: boolean; created: number; error?: string } {
  const plan = planImport(b.doc.getState(), shapes, mode);
  const r = b.exec({
    actor: b.me, opId: opId(b.me), commands: plan.commands, atomic: true,
    label: mode === 'replace' ? 'Import board (replace)' : 'Import board (add)',
  });
  if (!r.ok) {
    const bad = r.results.find((x) => !x.ok);
    return { ok: false, created: 0, error: bad && !bad.ok ? (bad.error === 'locked' ? 'A layer is locked, nothing was imported' : bad.message) : 'Import failed' };
  }
  return { ok: true, created: plan.created };
}

let importing = false;   // duplicate clicks while a dialog or file read is open

async function importText(text: string, bytes: number): Promise<void> {
  const env = activeBoard();
  if (!env) return;
  const parsed = parseImport(text, bytes);
  if (!parsed.ok) { toast(`Import failed: ${parsed.error}`, { variant: 'error', ttlMs: 6000 }); return; }
  const n = parsed.shapes.length;
  const hasContent = [...env.board.doc.getState().shapes.values()].some((s) => !s.deleted);
  let mode: 'replace' | 'merge' = 'merge';
  if (hasContent) {
    const replace = await confirm({
      title: `Import ${n} layer${n === 1 ? '' : 's'}?`,
      body: 'Replace removes everything on this board first (you can undo it). Cancel to add the layers next to your content instead.',
      confirmLabel: 'Replace board', cancelLabel: 'Add to board', destructive: true, blocking: true,
    });
    mode = replace ? 'replace' : 'merge';
  }
  const r = applyImport(env.board, parsed.shapes, mode);
  if (!r.ok) { toast(`Import failed: ${r.error}`, { variant: 'error', ttlMs: 6000 }); return; }
  const skipped = parsed.dropped ? `, skipped ${parsed.dropped} damaged` : '';
  toast(`${mode === 'replace' ? 'Replaced the board with' : 'Added'} ${r.created} layer${r.created === 1 ? '' : 's'}${skipped}`, { ttlMs: 4000 });
}

export function importBoard(): void {
  if (importing || typeof document === 'undefined') return;
  importing = true;
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json,application/json';
  input.onchange = async () => {
    const f = input.files?.[0];
    try { if (f) await importText(await f.text(), f.size); }
    catch (e) { console.error('[file] import', e); toast('Could not read that file', { variant: 'error' }); }
    finally { importing = false; }
  };
  input.addEventListener('cancel', () => { importing = false; });
  input.click();
}

export const actions: Action[] = [
  { id: 'file.export', title: 'Export board (.contract.json)', group: 'Share', contexts: ['canvas', 'panel', 'palette'], run: exportBoard },
  { id: 'file.import', title: 'Import board…', group: 'Share', contexts: ['canvas', 'panel', 'palette'], run: importBoard },
];
