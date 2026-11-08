// Top bar: back link, title, avatars, comment tool + options, share, zoom.
import { useEffect, useRef, useState } from 'react';
import { TOOL_KEYS } from '../../actions/tools';
import { RENAME_EVENT, cleanFileName, FILE_NAME_MAX } from '../../actions/panels';
import { prefs } from '../../core/prefs';
import { useStoreValue } from '../../core/react';
import { toast, toasts } from '../../core/toast';
import { getAction, shortcutLabels } from '../../core/actions';
import { redoMine, undoMine } from '../../actions/edit';
import type { BoardKit } from '../../core/commands';
import { copyLink, exportSelection } from '../../actions/share';
import { activeBoard } from '../board/state';
import type { Persistence } from '../../core/persist';
import { BUBBLE } from '../constants';
import { useUi } from '../hooks';
import type { SlotProps } from '../slotProps';
import { ZoomMenu } from '../ZoomMenu';
import { AvatarStack, toggleFollow } from '../PresenceList';
import { startPresent } from '../../actions/present';
import { setTitleName } from '../title';
import { pickTool } from './Toolbar';
import '../../styles/topbar.css';

/** Editable board name (SHELL-2): click or F2 to edit, Enter/blur commits, Esc cancels. Stored in prefs and document.title. */
function FileName() {
  const name = useStoreValue(prefs.subscribe, () => prefs.get().fileName);
  const [editing, setEditing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { setTitleName(name); }, [name]);
  useEffect(() => {
    const on = () => setEditing(true);
    window.addEventListener(RENAME_EVENT, on);
    return () => window.removeEventListener(RENAME_EVENT, on);
  }, []);
  useEffect(() => { if (editing) input.current?.select(); }, [editing]);
  const commit = (v: string) => { prefs.set({ fileName: cleanFileName(v) }); setEditing(false); };
  return (
    <div className="pg-file">
      {editing ? (
        <input ref={input} className="pg-file-in" aria-label="Board name" defaultValue={name} maxLength={FILE_NAME_MAX}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') commit(e.currentTarget.value); else if (e.key === 'Escape') setEditing(false); }} />
      ) : (
        <button className="pg-file-btn" title="Rename board (F2)" onClick={() => setEditing(true)}>{name}</button>
      )}
    </div>
  );
}

/** Save-status dot. Renders nothing until the orchestrator puts the Persistence handle in the UI store under `persistence`. */
function SaveDot({ ui }: { ui: SlotProps['ui'] }) {
  const p = useStoreValue(ui.subscribe, () => (ui.get() as { persistence?: Persistence }).persistence ?? null);
  const status = useStoreValue(
    (f: () => void) => (p ? p.subscribe(f) : () => {}),
    () => p?.getState().status ?? null,
  );
  if (!p || !status) return null;
  const label = { saved: 'Saved', saving: 'Saving…', error: 'Not saved: storage unavailable', full: 'Not saved: storage full' }[status];
  return <span className="pg-save" data-status={status} role="status" aria-label={label} title={label} />;
}

/** "Changed by Juno" / "Changed by Juno and Ada": who superseded the fields an undo had to leave alone. */
export function skipText(board: BoardKit, by: string[]): string {
  const names = [...new Set(by)].map((id) => board.actors.get(id)?.name ?? id);
  return `Changed by ${names.length > 2 ? `${names.slice(0, 2).join(', ')} and others` : names.join(' and ')}`;
}

/** Tooltip: next action name plus the shortcut, e.g. "Undo Move 3 layers  ⌘Z". */
const tip = (verb: string, label: string | null, id: string) => {
  const a = getAction(id);
  const keys = a ? shortcutLabels(a)[0] : undefined;
  return (label ? `${verb} ${label}` : `Nothing to ${verb.toLowerCase()}`) + (keys ? `  ${keys}` : '');
};

/** Undo / redo buttons for the human's own stacks (HISTORY-16) and the one toast per undo (HISTORY-16, 18). */
function UndoRedo({ board }: { board: BoardKit }) {
  const um = board.undoManager;
  const undoLabel = useStoreValue(um.subscribe, () => um.nextLabel(board.me, 'undo'));
  const redoLabel = useStoreValue(um.subscribe, () => um.nextLabel(board.me, 'redo'));
  useEffect(() => {
    let shown: number | null = null;
    let seen = um.last()?.n ?? 0;
    const off = um.subscribe(() => {
      const e = um.last();
      if (!e || e.n === seen) return;
      seen = e.n;
      if (e.actor !== board.me) return;
      if (shown !== null) toasts.dismiss(shown); // never stack more than one history toast
      const skip = e.outcome.skipped.length ? skipText(board, e.outcome.skipped.map((s) => s.by)) : '';
      const verb = { undo: 'Undid', redo: 'Redid', revert: 'Reverted', reapply: 'Re-applied' }[e.kind];
      if (!e.outcome.ok && !skip) return; // "Nothing to undo" is toasted by the action
      const text = e.outcome.ok ? `${verb}: ${e.label}${skip ? ` (${skip.toLowerCase()} kept)` : ''}` : skip;
      const canBack = e.kind === 'revert' && e.outcome.ok && um.canReapply(e.txId);
      shown = toasts.show(text, {
        variant: e.outcome.ok ? 'info' : 'warn', ttlMs: canBack ? 6000 : e.outcome.ok && !skip ? 1500 : 3500,
        ...(canBack ? { action: { label: 'Re-apply', run: () => {
          // BoardKit has no reapply yet (see report); fall back to the manager so the button works today.
          const b = board as BoardKit & { reapply?: (by: string, id: string) => unknown };
          if (b.reapply) b.reapply(board.me, e.txId); else um.reapply(board.me, e.txId);
        } } } : {}),
      });
    });
    return () => { off(); if (shown !== null) toasts.dismiss(shown); };
  }, [board, um]);
  return (
    <div className="pg-cbtn" role="group" aria-label="History">
      <button className="pg-icon" disabled={!undoLabel} style={undoLabel ? undefined : { opacity: 0.4 }} title={tip('Undo', undoLabel, 'edit.undo')}
        aria-label={undoLabel ? `Undo ${undoLabel}` : 'Undo'} onClick={() => undoMine(board)}>
        <svg viewBox="0 0 24 24" width="20" height="20"><path d="M9 7 4.5 11.5 9 16M5 11.5h9a5 5 0 0 1 0 10h-3" transform="translate(0 -3)" /></svg>
      </button>
      <button className="pg-icon" disabled={!redoLabel} style={redoLabel ? undefined : { opacity: 0.4 }} title={tip('Redo', redoLabel, 'edit.redo')}
        aria-label={redoLabel ? `Redo ${redoLabel}` : 'Redo'} onClick={() => redoMine(board)}>
        <svg viewBox="0 0 24 24" width="20" height="20"><path d="M15 7l4.5 4.5L15 16M19 11.5h-9a5 5 0 0 0 0 10h3" transform="translate(0 -3)" /></svg>
      </button>
    </div>
  );
}

export function TopBar({ board, ui, cursors, showPins, onShowPins, onClearResolved }: SlotProps & {
  showPins: boolean;
  onShowPins: (v: boolean) => void;
  onClearResolved: () => void;
}) {
  const tool = useUi(ui, 'tool');
  const [menu, setMenu] = useState(false);
  const [shareMenu, setShareMenu] = useState(false);
  useEffect(() => ui.onEscape(() => { setMenu(false); setShareMenu(false); }), [ui]);

  const share = () => {
    const env = activeBoard();
    if (env) { void copyLink(env.board, env.camera); return; }
    navigator.clipboard?.writeText(location.href).catch(() => {});
    toast('Link copied', { ttlMs: 1600 });
  };

  return (
    <header className="pg-top">
      <a className="pg-back" href="#/" title="Back to dashboard" aria-label="Back to dashboard">←</a>
      <span className="pg-logo">◆</span>
      <FileName />
      <SaveDot ui={ui} />
      <span className="pg-sub">multi-agent design board · proof of concept</span>
      <span className="pg-grow" />
      <UndoRedo board={board} />
      <AvatarStack cursors={cursors} onPick={toggleFollow} />
      <div className="pg-cbtn">
        <button className={'pg-icon' + (tool === 'comment' ? ' on' : '')} title={`Comment (${TOOL_KEYS.comment.toUpperCase()})`} onClick={() => pickTool(ui, tool === 'comment' ? 'select' : 'comment')}>
          <svg viewBox="0 0 24 24" width="20" height="20"><path d={BUBBLE} /></svg>
        </button>
        <button className="pg-chev" title="Comment options" onClick={() => setMenu((m) => !m)}>▾</button>
        {menu && (
          <div className="pg-menu" onMouseLeave={() => setMenu(false)}>
            <label><input type="checkbox" checked={showPins} onChange={(e) => onShowPins(e.target.checked)} /> Show comment pins</label>
            <button onClick={() => { onClearResolved(); setMenu(false); }}>Clear resolved pins</button>
          </div>
        )}
      </div>
      <a className="pg-share" href="#/variants" title="Compare design variants">
        <svg viewBox="0 0 24 24" width="16" height="16"><path d="M4 5h7v14H4zM13 5h7v6h-7zM13 13h7v6h-7z" /></svg>
        <span>Variants</span>
      </a>
      <button className="pg-icon" title="Present" aria-label="Present" onClick={() => startPresent()}>
        <svg viewBox="0 0 24 24" width="20" height="20"><path d="M7 5.5v13l11-6.5z" /></svg>
      </button>
      <div className="pg-cbtn">
        <button className="pg-share" onClick={share} title="Copy link">
          <svg viewBox="0 0 24 24" width="16" height="16"><path d="M7 11V8a5 5 0 0 1 10 0v3M5.5 11h13v9.5h-13z" /></svg>
          <span>Share</span>
        </button>
        <button className="pg-chev" title="Share options" aria-haspopup="menu" aria-expanded={shareMenu} onClick={() => setShareMenu((m) => !m)}>▾</button>
        {shareMenu && (
          <div className="pg-menu" role="menu" onMouseLeave={() => setShareMenu(false)}>
            <button role="menuitem" onClick={() => { share(); setShareMenu(false); }}>Copy link to this view</button>
            {([1, 2, 3] as const).map((s) => (
              <button key={s} role="menuitem" onClick={() => { void exportSelection(board, s); setShareMenu(false); }}>Export selection as PNG ({s}x)</button>
            ))}
          </div>
        )}
      </div>
      <ZoomMenu />
    </header>
  );
}
