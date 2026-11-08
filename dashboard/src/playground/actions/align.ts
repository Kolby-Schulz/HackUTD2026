// Align shortcuts (ALIGN-11, Figma set): Alt+A left, Alt+D right, Alt+W top, Alt+S bottom, Alt+H / Alt+V centres.
// One board.exec per press, so each is one undo entry. The geometry lives in core/align.ts.
import { alignCommands } from '../core/align';
import type { AlignMode } from '../core/align';
import type { BoardKit } from '../core/commands';
import { opId } from '../core/ids';
import { toast } from '../core/toast';
import type { Action } from '../core/types';
import { activeBoard, selectedIds } from '../ui/board/state';

const LABEL: Record<AlignMode, string> = {
  left: 'Align left', hcenter: 'Align horizontal centers', right: 'Align right',
  top: 'Align top', vcenter: 'Align vertical centers', bottom: 'Align bottom',
};

/** Align the human's selection. Returns false when there was nothing to move. */
export function alignSelection(b: BoardKit, mode: AlignMode): boolean {
  const commands = alignCommands(b.doc.getState(), selectedIds(b), mode);
  if (!commands.length) return false;
  const res = b.exec({ actor: b.me, opId: opId(b.me), commands, label: LABEL[mode] });
  const bad = res.results.find((r) => !r.ok);
  if (bad && !bad.ok) toast(bad.message, { variant: 'warn', key: 'align.fail', onceMs: 1500 });
  return res.ok;
}

const KEYS: Array<[AlignMode, string]> = [['left', 'a'], ['right', 'd'], ['top', 'w'], ['bottom', 's'], ['hcenter', 'h'], ['vcenter', 'v']];

export const actions: Action[] = KEYS.map(([mode, key]) => ({
  id: `align.${mode}`, title: LABEL[mode], group: 'Arrange' as const, keys: { all: [`Alt+${key}`] }, contexts: ['canvas', 'panel'] as Action['contexts'],
  run: () => { const env = activeBoard(); if (env && !env.ui.get().editing) alignSelection(env.board, mode); },
}));
