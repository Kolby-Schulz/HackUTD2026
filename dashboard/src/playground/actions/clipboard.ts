// Clipboard actions: Cmd/Ctrl+C / X / V and Cmd/Ctrl+Shift+V. The in-memory payload is the source of truth;
// the system clipboard gets the same payload as JSON text when available (try/catch, never required).
import { getClipboard, copyShapes, classifyClipboardText, pastePayload, pasteText, serializePayload, setClipboard } from '../core/clipboard';
import type { ClipboardPayload } from '../core/clipboard';
import { toast } from '../core/toast';
import type { Action, Pt, ShapeId } from '../core/types';
import { activeBoard, selectIds, selectedIds } from '../ui/board/state';
import type { BoardEnv } from '../ui/board/state';
import { deleteSelection } from './edit';

let lastWritten: string | null = null; // the JSON we put on the system clipboard (so we can tell our own text from someone else's)
let lastCopiedIds: readonly string[] = [];

function writeSystem(payload: ClipboardPayload): void {
  try {
    const text = serializePayload(payload);
    lastWritten = text;
    void navigator.clipboard?.writeText(text).catch(() => {});
  } catch { /* optional */ }
}

/** System clipboard text, or null when unavailable or denied (never throws). */
async function readSystem(): Promise<string | null> {
  try {
    if (!navigator.clipboard?.readText) return null;
    return await navigator.clipboard.readText();
  } catch { return null; }
}

function copy(env: BoardEnv): ClipboardPayload | null {
  const payload = copyShapes(env.board, selectedIds(env.board));
  if (!payload) return null; // empty selection keeps the old clipboard
  setClipboard(payload);
  lastCopiedIds = [...selectedIds(env.board)];
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

/** The single selected live frame to paste into, unless it is the very thing that was just copied. */
function targetFrame(env: BoardEnv): ShapeId | undefined {
  const ids = selectedIds(env.board);
  if (ids.length !== 1) return undefined;
  const s = env.board.doc.getState().shapes.get(ids[0]);
  if (!s || s.deleted || s.kind !== 'frame') return undefined;
  if (lastCopiedIds.length === 1 && lastCopiedIds[0] === ids[0]) return undefined;
  return ids[0];
}

function paste(env: BoardEnv, payload: ClipboardPayload, inPlace: boolean): void {
  const intoFrame = inPlace ? undefined : targetFrame(env);
  const r = pastePayload(env.board, payload, { at: anchor(env), inPlace, view: env.camera.visibleRect(), intoFrame });
  if (r.ok) selectIds(env.board, r.ids);
  else toast(r.error ?? 'Could not paste', { variant: 'warn', key: 'clipboard.paste', onceMs: 1500 });
}

function pasteAsText(env: BoardEnv, text: string): void {
  const ids = selectedIds(env.board);
  const sel = ids.length === 1 ? ids[0] : null;
  const r = pasteText(env.board, text, { at: anchor(env), replace: sel });
  if (!r.ok) return;
  if (r.id && !r.replaced) selectIds(env.board, [r.id]);
  if (r.truncated) toast('Pasted text was cut to 10,000 characters', { variant: 'warn', key: 'clipboard.text', onceMs: 1500 });
}

async function run(inPlace: boolean): Promise<void> {
  const env = activeBoard();
  if (!env || env.ui.get().editing) return;
  const sys = await readSystem(); // null when denied: quietly use the in-memory clipboard
  const c = classifyClipboardText(sys);
  const mem = getClipboard();
  if (c.kind === 'payload') { setClipboard(c.payload); paste(env, c.payload, inPlace); return; }
  if (c.kind === 'newer') { toast('That clipboard comes from a newer version of Contract', { variant: 'warn', key: 'clipboard.paste', onceMs: 1500 }); return; }
  if (c.kind === 'toolarge') { toast('Clipboard is too large to paste (over 5 MB)', { variant: 'warn', key: 'clipboard.paste', onceMs: 1500 }); return; }
  if (c.kind === 'text' && c.text !== lastWritten) { pasteAsText(env, c.text); return; }
  if (mem) paste(env, mem, inPlace);
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
    run() { void run(false); },
  },
  {
    id: 'clipboard.pasteInPlace', title: 'Paste in place', group: 'Edit', keys: { all: ['Mod+Shift+v'] }, contexts: ['canvas', 'panel'],
    run() { void run(true); },
  },
];
