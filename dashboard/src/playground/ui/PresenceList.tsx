// The list of everyone with a cursor: you, agents (pause / remove) and API cursors (remove).
// Rows show colour, state dot and detail; clicking an actor jumps the camera to it (AGENT-20) and pulses its cursor.
// Also: join/leave toasts (MULTI-14) and an AvatarStack with +N overflow (MULTI-4) for the top bar to mount.
import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { BoardKit } from '../core/commands';
import { followActor, followingId, stopFollow, subscribeFollow } from '../core/follow';
import { goTo } from '../core/goto';
import { toast } from '../core/toast';
import type { AgentState } from '../core/types';
import { formatChip, usageStore } from '../agents/usage';
import { ARROW, YOU_COLOR } from './constants';
import { statusOf } from './meta';
import type { Meta } from './meta';
import { pulseActor } from './overlays/RemoteSelections';
import { activeBoard } from './board/state';
import type { SlotProps } from './slotProps';
import '../styles/presence.css';

export type StateTone = 'idle' | 'working' | 'waiting' | 'blocked' | 'off';
export const toneOf = (s?: AgentState): StateTone =>
  s === 'thinking' || s === 'drawing' ? 'working' : s === 'waiting_user' || s === 'waiting_agent' ? 'waiting'
    : s === 'blocked' || s === 'error' ? 'blocked' : s === 'paused' || s === 'stopped' ? 'off' : 'idle';

/** Pure: order for the avatar stack (humans first, then agents) and the +N overflow count. */
export function avatarStack<T extends { kind: string }>(all: T[], max = 5): { shown: T[]; more: number } {
  const sorted = [...all].sort((a, b) => Number(b.kind === 'human') - Number(a.kind === 'human'));
  return { shown: sorted.slice(0, max), more: Math.max(0, sorted.length - max) };
}

/** Jump the camera to an actor's cursor (or its focus / viewport) and pulse it. Returns false when it has no position. */
export function jumpToActor(board: Pick<BoardKit, 'presence' | 'me'>, id: string): boolean {
  const p = board.presence.get(id);
  if (!p || id === board.me) return false;
  if (p.x !== undefined && p.y !== undefined) goTo({ x: p.x, y: p.y });
  else if (p.focus) goTo(p.focus);
  else if (p.viewport) goTo({ x: p.viewport.x + p.viewport.w / 2, y: p.viewport.y + p.viewport.h / 2 });
  else return false;
  pulseActor(id);
  return true;
}

/** Start following an actor on the mounted board (toggles off when already following them). */
export function toggleFollow(id: string): boolean {
  if (followingId() === id) { stopFollow(); return false; }
  const env = activeBoard();
  return env ? followActor(env, id) : false;
}

/** Join / leave toasts for agents and API cursors (not for the first render). */
function useJoinLeaveToasts(cursors: Meta[], me: string) {
  const prev = useRef<Map<string, Meta> | null>(null);
  useEffect(() => {
    const now = new Map(cursors.map((c) => [c.id, c]));
    const before = prev.current;
    prev.current = now;
    if (!before) return;
    for (const [id, c] of now) if (!before.has(id) && id !== me) toast(`${c.name} joined`, { key: `join:${id}`, onceMs: 1000 });
    for (const [id, c] of before) if (!now.has(id) && id !== me) toast(`${c.name} left`, { key: `leave:${id}`, onceMs: 1000 });
  }, [cursors, me]);
}

export function AvatarStack({ cursors, onMore, onPick }: { cursors: Meta[]; onMore?: () => void; onPick?: (id: string) => void }) {
  const { shown, more } = avatarStack(cursors);
  return (
    <div className="pg-avstack">
      {shown.map((c) => (
        <button key={c.id} className={'pg-av' + (c.kind === 'agent' ? ` ring-${toneOf(c.state)}` : '')} title={`${c.name} · ${statusOf(c)}`}
          style={{ ['--c' as string]: c.kind === 'human' ? YOU_COLOR : c.color }} onClick={() => onPick?.(c.id)}>{c.name.slice(0, 1).toUpperCase()}</button>
      ))}
      {more > 0 && <button className="pg-av more" title="Show everyone" onClick={onMore}>+{more}</button>}
    </div>
  );
}

/** Per-agent usage chip ("12.4k tok · $0.08"); renders nothing until the agent has recorded a call (scripted agents never do). */
function UsageChip({ id }: { id: string }) {
  const text = useSyncExternalStore(usageStore.subscribe, () => { const u = usageStore.get(id); return u.calls > 0 ? formatChip(u) : ''; });
  return text ? <span className="pg-usage" title="Model usage">{text}</span> : null;
}

export function PresenceList({ board, rt, cursors }: SlotProps) {
  useJoinLeaveToasts(cursors, board.me);
  const following = useSyncExternalStore(subscribeFollow, followingId);
  return (
    <div className="pg-cursorlist">
      {cursors.map((c) => (
        <div key={c.id} className="pg-crow" onClick={() => { if (c.kind !== 'human') jumpToActor(board, c.id); }}
          onDoubleClick={() => { if (c.id !== board.me) toggleFollow(c.id); }}>
          <svg width="14" height="15" viewBox="0 0 22 24" style={{ ['--c' as string]: c.kind === 'human' ? YOU_COLOR : c.color }} className="pg-mini"><path d={ARROW} /></svg>
          <div className="pg-cname">
            <b>{c.name}</b>
            <small>{c.kind === 'human' ? 'you · mouse' : c.kind === 'api' ? 'window.board' : statusOf(c)}</small>
          </div>
          {c.kind === 'agent' && <UsageChip id={c.id} />}
          {c.kind === 'agent' && <span className={`pg-dot ${toneOf(c.state)}`} title={c.state ?? 'idle'} />}
          {c.kind === 'agent' && (c.state === 'stopped'
            ? <button className="ghost" title="Restart" onClick={(e) => { e.stopPropagation(); rt?.restart(c.id); }}>▶</button>
            : <button className="ghost" title={c.state === 'paused' ? 'Resume' : 'Pause'} onClick={(e) => { e.stopPropagation(); rt?.setPaused(c.id, c.state !== 'paused'); }}>{c.state === 'paused' ? '▶' : '❚❚'}</button>)}
          {c.id !== board.me && (
            <button className="ghost" title={following === c.id ? 'Stop following' : 'Follow'} aria-pressed={following === c.id}
              style={following === c.id ? { color: 'var(--pg-sel)' } : undefined}
              onClick={(e) => { e.stopPropagation(); toggleFollow(c.id); }}>◉</button>
          )}
          {c.kind !== 'human' && (
            <button className="ghost" title="Remove" onClick={(e) => {
              e.stopPropagation();
              if (c.kind === 'agent') rt?.remove(c.id); else board.actors.remove(c.id);
              board.presence.remove(c.id);
            }}>✕</button>
          )}
        </div>
      ))}
    </div>
  );
}
