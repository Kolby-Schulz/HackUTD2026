// Share link (SHARE-1/2) and view persistence (CANVAS-36/37).
// `copyLink` writes `#/playground?x&y&z&sel`; `applyViewFromUrl` is called once from boot.
import type { BoardKit } from '../core/commands';
import type { CameraStore } from '../core/camera';
import { opId } from '../core/ids';
import { browserStorage } from '../core/prefs';
import { toast } from '../core/toast';
import type { Action, ShapeId } from '../core/types';
import { camToView, decodeView, encodeView, loadSavedView, saveView, viewToCam } from '../core/url';
import { downloadBlob, exportPng } from '../core/export';
import { activeBoard, selectedIds } from '../ui/board/state';

const liveIds = (board: BoardKit, ids: readonly string[]): ShapeId[] => {
  const shapes = board.doc.getState().shapes;
  return ids.filter((id) => { const s = shapes.get(id); return !!s && !s.deleted; });
};

/** Full link for the current view and the human's selection. */
export function buildLink(board: BoardKit, camera: CameraStore, loc: { origin: string; pathname: string } = location): string {
  const size = camera.getViewSize();
  const view = camToView(camera.getCam(), size.w > 0 ? size : { w: 0, h: 0 });
  return loc.origin + loc.pathname + encodeView(view, board.selection.get(board.me).ids);
}

export async function copyLink(board: BoardKit, camera: CameraStore): Promise<boolean> {
  const url = buildLink(board, camera);
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied', { variant: 'success', ttlMs: 1600 });
    return true;
  } catch {
    toast('Could not copy the link', { variant: 'warn' });
    return false;
  }
}

/** Waits (max ~1s) for the view to be measured: the centre needs its size. */
function whenMeasured(camera: CameraStore, run: () => void): () => void {
  let n = 0, raf = 0, dead = false;
  const tick = () => {
    if (dead) return;
    if (camera.getViewSize().w > 0 || ++n > 60) return run();
    raf = requestAnimationFrame(tick);
  };
  tick();
  return () => { dead = true; if (raf) cancelAnimationFrame(raf); };
}

/**
 * Boot call: if the URL has a view, move the camera there and select the ids that exist; else restore the
 * last saved view for this board. Then keep saving the view (debounced) as the camera moves.
 * Returns a cleanup. Add to useBoot after the board is restored: `const offView2 = applyViewFromUrl(board, camera);`
 */
export function applyViewFromUrl(board: BoardKit, camera: CameraStore, boardId = 'playground'): () => void {
  const storage = browserStorage();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let off: (() => void) | undefined;
  const cancelWait = whenMeasured(camera, () => {
    const url = decodeView(location.hash);
    const target = url.view ?? loadSavedView(storage, boardId);
    const size = camera.getViewSize();
    if (target) camera.setCam(viewToCam(target, size));
    if (url.sel.length) {
      const ids = liveIds(board, url.sel);
      if (ids.length) board.exec({ actor: board.me, opId: opId(board.me), commands: [{ t: 'selection.set', ids }] });
      const missing = url.sel.length - ids.length;
      if (missing > 0) toast(missing === 1 ? '1 layer not found' : `${missing} layers not found`, { variant: 'warn' });
    }
    off = camera.subscribe((cam) => {
      clearTimeout(timer);
      timer = setTimeout(() => { const s = camera.getViewSize(); if (s.w > 0) saveView(storage, camToView(cam, s), boardId); }, 400);
    });
  });
  return () => { cancelWait(); off?.(); clearTimeout(timer); };
}

/** File name for an export: the layer name for one layer, else "<n> layers"; `@2x` suffix at scales above 1. */
export function exportFileName(names: readonly string[], scale: 1 | 2 | 3): string {
  const base = (names.length === 1 ? names[0] : `${names.length} layers`).replace(/[\\/:*?"<>|]+/g, '-').trim() || 'export';
  return `${base}${scale > 1 ? `@${scale}x` : ''}.png`;
}

/** Exports the human's selection as a PNG download. Returns true on success. */
export async function exportSelection(board: BoardKit, scale: 1 | 2 | 3): Promise<boolean> {
  const ids = liveIds(board, selectedIds(board));
  if (!ids.length) { toast('Select a layer to export', { variant: 'warn' }); return false; }
  try {
    const shapes = board.doc.getState().shapes;
    const blob = await exportPng(board.doc, ids, { scale });
    const name = exportFileName(ids.map((id) => shapes.get(id)!.name), scale);
    downloadBlob(blob, name);
    toast(`Exported ${name}`, { variant: 'success', ttlMs: 2000 });
    return true;
  } catch (e) {
    toast(`Export failed: ${e instanceof Error ? e.message : 'unknown error'}`, { variant: 'warn' });
    return false;
  }
}

const hasSelection = (): true | string => {
  const env = activeBoard();
  return env && liveIds(env.board, selectedIds(env.board)).length ? true : 'Select a layer to export';
};
const exportAction = (id: string, title: string, scale: 1 | 2 | 3): Action => ({
  id, title, group: 'Share', contexts: ['canvas', 'panel', 'palette'] as Action['contexts'], when: hasSelection,
  run() { const env = activeBoard(); if (env) void exportSelection(env.board, scale); },
});

export const actions: Action[] = [
  {
    id: 'share.copyLink', title: 'Copy link to this view', group: 'Share', contexts: ['canvas', 'panel', 'palette'] as Action['contexts'],
    run() { const env = activeBoard(); if (env) void copyLink(env.board, env.camera); },
  },
  exportAction('share.exportPng', 'Export selection as PNG', 2),
  exportAction('share.exportPng1x', 'Export selection as PNG (1x)', 1),
  exportAction('share.exportPng3x', 'Export selection as PNG (3x)', 3),
];
