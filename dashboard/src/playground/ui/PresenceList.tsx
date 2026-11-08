// The list of everyone with a cursor: you, agents (pause / remove) and API cursors (remove).
import { ARROW, YOU_COLOR } from './constants';
import { statusOf } from './meta';
import type { SlotProps } from './slotProps';
import '../styles/presence.css';

export function PresenceList({ board, rt, cursors }: SlotProps) {
  return (
    <div className="pg-cursorlist">
      {cursors.map((c) => (
        <div key={c.id} className="pg-crow">
          <svg width="14" height="15" viewBox="0 0 22 24" style={{ ['--c' as string]: c.kind === 'human' ? YOU_COLOR : c.color }} className="pg-mini"><path d={ARROW} /></svg>
          <div className="pg-cname">
            <b>{c.name}</b>
            <small>{c.kind === 'human' ? 'you · mouse' : c.kind === 'api' ? 'window.board' : statusOf(c)}</small>
          </div>
          {c.kind === 'agent' && (
            <button className="ghost" title={c.state === 'paused' ? 'Resume' : 'Pause'} onClick={() => rt?.setPaused(c.id, c.state !== 'paused')}>{c.state === 'paused' ? '▶' : '❚❚'}</button>
          )}
          {c.kind !== 'human' && (
            <button className="ghost" title="Remove" onClick={() => {
              if (c.kind === 'agent') rt?.remove(c.id); else board.actors.remove(c.id);
              board.presence.remove(c.id);
            }}>✕</button>
          )}
        </div>
      ))}
    </div>
  );
}
