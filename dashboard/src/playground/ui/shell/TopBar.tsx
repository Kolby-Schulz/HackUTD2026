// Top bar: back link, title, avatars, comment tool + options, share, zoom.
import { useEffect, useRef, useState } from 'react';
import { TOOL_KEYS } from '../../actions/tools';
import { RENAME_EVENT, cleanFileName, FILE_NAME_MAX } from '../../actions/panels';
import { prefs } from '../../core/prefs';
import { useStoreValue } from '../../core/react';
import { toast } from '../../core/toast';
import type { Persistence } from '../../core/persist';
import { BUBBLE } from '../constants';
import { useUi } from '../hooks';
import type { SlotProps } from '../slotProps';
import { ZoomMenu } from '../ZoomMenu';
import { AvatarStack, jumpToActor } from '../PresenceList';
import { pickTool } from './Toolbar';
import '../../styles/topbar.css';

/** Editable board name (SHELL-2): click or F2 to edit, Enter/blur commits, Esc cancels. Stored in prefs and document.title. */
function FileName() {
  const name = useStoreValue(prefs.subscribe, () => prefs.get().fileName);
  const [editing, setEditing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { document.title = `${name} · Playground`; }, [name]);
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

export function TopBar({ board, ui, cursors, showPins, onShowPins, onClearResolved }: SlotProps & {
  showPins: boolean;
  onShowPins: (v: boolean) => void;
  onClearResolved: () => void;
}) {
  const tool = useUi(ui, 'tool');
  const [menu, setMenu] = useState(false);
  useEffect(() => ui.onEscape(() => setMenu(false)), [ui]);

  const share = () => {
    navigator.clipboard?.writeText(location.href).catch(() => {});
    toast('Link copied', { ttlMs: 1600 });
  };

  return (
    <header className="pg-top">
      <a className="pg-back" href="#/live" title="Back to dashboard">←</a>
      <span className="pg-logo">◆</span>
      <FileName />
      <SaveDot ui={ui} />
      <span className="pg-sub">multi-agent design board · proof of concept</span>
      <span className="pg-grow" />
      <AvatarStack cursors={cursors} onPick={(id) => jumpToActor(board, id)} />
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
      <button className="pg-share" onClick={share} title="Copy link">
        <svg viewBox="0 0 24 24" width="16" height="16"><path d="M7 11V8a5 5 0 0 1 10 0v3M5.5 11h13v9.5h-13z" /></svg>
        <span>Share</span>
      </button>
      <ZoomMenu />
    </header>
  );
}
