// Top bar: back link, title, avatars, comment tool + options, share, zoom.
import { useEffect, useState } from 'react';
import { TOOL_KEYS } from '../../actions/tools';
import { toast } from '../../core/toast';
import { BUBBLE, YOU_COLOR } from '../constants';
import { useUi } from '../hooks';
import type { SlotProps } from '../slotProps';
import { ZoomMenu } from '../ZoomMenu';
import { pickTool } from './Toolbar';
import '../../styles/topbar.css';

export function TopBar({ ui, cursors, showPins, onShowPins, onClearResolved }: SlotProps & {
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
      <strong>Playground</strong>
      <span className="pg-sub">multi-agent design board · proof of concept</span>
      <span className="pg-grow" />
      <div className="pg-avatars">
        {cursors.slice(0, 8).map((c) => <span key={c.id} title={c.name} style={{ background: c.kind === 'human' ? YOU_COLOR : c.color }}>{c.name[0]}</span>)}
        {cursors.length > 8 && <span className="more">+{cursors.length - 8}</span>}
      </div>
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
        Share
      </button>
      <ZoomMenu />
    </header>
  );
}
