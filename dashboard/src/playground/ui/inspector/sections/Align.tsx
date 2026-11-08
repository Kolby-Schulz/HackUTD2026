// Inspector section "Align" (ALIGN-11): six buttons. 2+ layers align to the selection bounds, one layer to its parent frame.
// Each click is a single board.exec, so it is one undo step.
import { useCallback, useState } from 'react';
import { ALIGN_MODES, alignCommands, canAlignTo, distributeBlocked, distributeCommands, matchBlocked, matchSizeCommands } from '../../../core/align';
import type { AlignMode, AlignTarget } from '../../../core/align';
import type { Command } from '../../../core/types';
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

type Extra = 'dh' | 'dv' | 'mw' | 'mh';
const EXTRA: Array<{ k: Extra; label: string; icon: string }> = [
  { k: 'dh', label: 'Distribute horizontal spacing', icon: 'M2 2v12M14 2v12M6.5 5h3v6h-3z' },
  { k: 'dv', label: 'Distribute vertical spacing', icon: 'M2 2h12M2 14h12M5 6.5v3h6v-3z' },
  { k: 'mw', label: 'Match width', icon: 'M2 4h12M2 12h12M2 4v8M14 4v8M5 8h6' },
  { k: 'mh', label: 'Match height', icon: 'M4 2v12M12 2v12M4 2h8M4 14h8M8 5v6' },
];
const TARGETS: Array<[AlignTarget, string]> = [['selection', 'Selection'], ['parent', 'Parent']];

export function AlignSection({ board }: SlotProps) {
  const ids = useSelection(board);
  const [how, setHow] = useState<AlignTarget>('selection');
  const rev = useStoreValue(board.doc.subscribe, useCallback(() => board.doc.getState().rev, [board]));
  void rev;
  if (!ids.length) return null;
  const st = board.doc.getState();
  const exec = (commands: Command[], label: string) => {
    if (!commands.length) return;
    const res = board.exec({ actor: board.me, opId: opId(board.me), commands, label });
    const bad = res.results.find((r) => !r.ok);
    if (bad && !bad.ok) toast(bad.message);
  };
  // Alt-click aligns to the key object (first selected) instead of the chosen target.
  const run = (mode: AlignMode, alt: boolean) => exec(alignCommands(st, ids, mode, alt ? 'key' : how, ids[0]), LABEL[mode]);
  const reason = (k: Extra): string | null => {
    if (k === 'dh' || k === 'dv') return distributeBlocked(st, ids);
    return matchBlocked(st, ids);
  };
  const runExtra = (k: Extra) => {
    const blocked = reason(k);
    if (blocked) return toast(blocked);
    if (k === 'dh') exec(distributeCommands(st, ids, 'h'), 'Distribute horizontally');
    else if (k === 'dv') exec(distributeCommands(st, ids, 'v'), 'Distribute vertically');
    else exec(matchSizeCommands(st, ids, k === 'mw' ? 'w' : 'h', ids[0]), k === 'mw' ? 'Match width' : 'Match height');
  };
  const enabled = canAlignTo(st, ids, how);
  const why = enabled ? undefined : how === 'parent' ? 'Every selected layer needs a parent frame' : 'Select 2+ layers or a layer inside a frame';
  return (
    <div role="group" aria-label="Align">
      <div className="pg-align" title={why}>
        {ALIGN_MODES.map((m) => (
          <button key={m} type="button" disabled={!enabled} aria-label={LABEL[m]} title={`${LABEL[m]} (Alt-click: to key object)`} onClick={(e) => run(m, e.altKey)}>
            <svg viewBox="0 0 16 16"><path d={ICON[m]} /></svg>
          </button>
        ))}
      </div>
      <div className="pg-align" aria-label="Align to">
        {TARGETS.map(([k, name]) => (
          <button key={k} type="button" aria-pressed={how === k} title={`Align to ${name.toLowerCase()}`} onClick={() => setHow(k)}
            style={{ fontSize: 11, fontWeight: how === k ? 600 : 400, background: how === k ? 'var(--pg-hover)' : undefined }}>{name}</button>
        ))}
      </div>
      <div className="pg-align">
        {EXTRA.map((x) => {
          const blocked = reason(x.k);
          return (
            <button key={x.k} type="button" disabled={!!blocked} aria-label={x.label} title={blocked ?? x.label} onClick={() => runExtra(x.k)}>
              <svg viewBox="0 0 16 16"><path d={x.icon} /></svg>
            </button>
          );
        })}
      </div>
    </div>
  );
}
