// Clipboard actions: Cmd/Ctrl+C / X / V and Cmd/Ctrl+Shift+V. The in-memory payload is the source of truth;
// the system clipboard gets the same payload as JSON text when available (try/catch, never required).
import { getClipboard, copyShapes, parsePayload, pastePayload, serializePayload, setClipboard } from '../core/clipboard';
import type { ClipboardPayload } from '../core/clipboard';
import { toast } from '../core/toast';
import type { Action, Pt } from '../core/types';
import { activeBoard, selectIds, selectedIds } from '../ui/board/state';
import type { BoardEnv } from '../ui/board/state';
import { deleteSelection } from './edit';

function writeSystem(payload: ClipboardPayload): void {
  try { void navigator.clipboard?.writeText(serializePayload(payload)).catch(() => {}); } catch { /* optional */ }
}

function copy(env: BoardEnv): ClipboardPayload | null {
  const payload = copyShapes(env.board, selectedIds(env.board));
  if (!payload) return null; // empty selection keeps the old clipboard
  setClipboard(payload);
  writeSystem(payload);
  return payload;
}

/** World point under the pointer, or the view centre when the pointer is off the board. */
function anchor(env: BoardEnv): Pt {
  const cam = env.camera.getCam();
  if (env.pointer.inside) return { x: (env.pointer.x - cam.x) / cam.z, y: (env.pointer.y - cam.y) / cam.z };
  const v = env.camera.visibleRect();
  return { x: v.x + v.w / 2, y: v.y + v.h / 2 };
}

function paste(env: BoardEnv, payload: ClipboardPayload, inPlace: boolean): void {
  const r = pastePayload(env.board, payload, { at: anchor(env), inPlace, view: env.camera.visibleRect() });
  if (r.ok) selectIds(env.board, r.ids);
  else toast(r.error ?? 'Could not paste', { variant: 'warn', key: 'clipboard.paste', onceMs: 1500 });
}

function run(inPlace: boolean): void {
  const env = activeBoard();
  if (!env || env.ui.get().editing) return;
  const mem = getClipboard();
  if (mem) { paste(env, mem, inPlace); return; }
  // nothing copied in this tab: maybe another tab put a payload on the system clipboard
  try {
    void navigator.clipboard?.readText().then((t) => {
      const p = parsePayload(t);
      if (!p) return;
      setClipboard(p);
      paste(env, p, inPlace);
    }).catch(() => {});
  } catch { /* optional */ }
}

export const actions: Action[] = [
  {
    id: 'clipboard.copy', title: 'Copy', group: 'Edit', keys: { all: ['Mod+c'] }, contexts: ['canvas', 'panel'],
    run() { const env = activeBoard(); if (env && !env.ui.get().editing) copy(env); },
  },
  {
    id: 'clipboard.cut', title: 'Cut', group: 'Edit', keys: { all: ['Mod+x'] }, contexts: ['canvas', 'panel'],
    run() {
      const env = activeBoard();
      if (!env || env.ui.get().editing) return;
      if (copy(env)) deleteSelection(env.board); // copy + delete = one undo entry
    },
  },
  {
    id: 'clipboard.paste', title: 'Paste', group: 'Edit', keys: { all: ['Mod+v'] }, contexts: ['canvas', 'panel'],
    run() { run(false); },
  },
  {
    id: 'clipboard.pasteInPlace', title: 'Paste in place', group: 'Edit', keys: { all: ['Mod+Shift+v'] }, contexts: ['canvas', 'panel'],
    run() { run(true); },
  },
];
