// Inspector section "Align" (ALIGN-11): six buttons. 2+ layers align to the selection bounds, one layer to its parent frame.
// Each click is a single board.exec, so it is one undo step.
import { useCallback } from 'react';
import { ALIGN_MODES, alignCommands, canAlign } from '../../../core/align';
import type { AlignMode } from '../../../core/align';
import { opId } from '../../../core/ids';
import { useStoreValue } from '../../../core/react';
import { toast } from '../../../core/toast';
import { useSelection } from '../../hooks';
import type { SlotProps } from '../../slotProps';
import '../../../styles/guides.css';

const LABEL: Record<AlignMode, string> = {
  left: 'Align left', hcenter: 'Align horizontal centers', right: 'Align right',
  top: 'Align top', vcenter: 'Align vertical centers', bottom: 'Align bottom',
};
// 16x16 line icons: a rule on one side or through the middle, two bars against it
const ICON: Record<AlignMode, string> = {
  left: 'M2 2v12M5 4.5h8M5 9.5h5',
  hcenter: 'M8 2v12M3.5 4.5h9M5 9.5h6',
  right: 'M14 2v12M3 4.5h8M6 9.5h5',
  top: 'M2 2h12M4.5 5v8M9.5 5v5',
  vcenter: 'M2 8h12M4.5 3.5v9M9.5 5v6',
  bottom: 'M2 14h12M4.5 3v8M9.5 6v5',
};

export function AlignSection({ board }: SlotProps) {
  const ids = useSelection(board);
  const rev = useStoreValue(board.doc.subscribe, useCallback(() => board.doc.getState().rev, [board]));
  void rev;
  if (!ids.length) return null;
  const st = board.doc.getState();
  const enabled = canAlign(st, ids);
  const run = (mode: AlignMode) => {
    const commands = alignCommands(board.doc.getState(), ids, mode);
    if (!commands.length) return;
    const res = board.exec({ actor: board.me, opId: opId(board.me), commands, label: LABEL[mode] });
    const bad = res.results.find((r) => !r.ok);
    if (bad && !bad.ok) toast(bad.message);
  };
  return (
    <div className="pg-align" role="group" aria-label="Align" title={enabled ? undefined : 'Select 2+ layers or a layer inside a frame'}>
      {ALIGN_MODES.map((m) => (
        <button key={m} type="button" disabled={!enabled} aria-label={LABEL[m]} title={LABEL[m]} onClick={() => run(m)}>
          <svg viewBox="0 0 16 16"><path d={ICON[m]} /></svg>
        </button>
      ))}
    </div>
  );
}
