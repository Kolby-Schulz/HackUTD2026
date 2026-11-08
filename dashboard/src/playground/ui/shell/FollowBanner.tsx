// Slot: FollowBanner (CANVAS-27, MULTI-9). "Following Iris · Esc to stop" while the camera tracks an actor.
import { useEffect, useSyncExternalStore } from 'react';
import { followingId, onFollowEnd, stopFollow, subscribeFollow } from '../../core/follow';
import { toast } from '../../core/toast';
import { YOU_COLOR } from '../constants';
import type { SlotProps } from '../slotProps';

const BANNER = {
  position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 5, display: 'flex', alignItems: 'center', gap: 8,
  background: 'var(--pg-panel)', color: 'var(--pg-ink)', border: '1px solid var(--pg-line-strong)', borderRadius: 999,
  padding: '5px 8px 5px 12px', fontSize: 12, boxShadow: 'var(--pg-shadow-pop)',
} as const;

export function FollowBanner({ cursors }: SlotProps) {
  const id = useSyncExternalStore(subscribeFollow, followingId);
  useEffect(() => onFollowEnd((who, why) => {
    if (why !== 'gone') return;
    const name = cursors.find((c) => c.id === who)?.name ?? 'Actor';
    toast(`${name} left`, { key: `follow-gone:${who}`, onceMs: 1000 });
  }), [cursors]);
  useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') stopFollow('user'); };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [id]);
  if (!id) return null;
  const c = cursors.find((x) => x.id === id);
  const color = c ? (c.kind === 'human' ? YOU_COLOR : c.color) : YOU_COLOR;
  return (
    <div className="pg-follow" role="status" style={BANNER}>
      <i style={{ width: 8, height: 8, borderRadius: '50%', background: color, flex: 'none' }} />
      <span>Following <b>{c?.name ?? id}</b> · Esc to stop</span>
      <button className="ghost" title="Stop following" aria-label="Stop following" onClick={() => stopFollow('user')}>✕</button>
    </div>
  );
}
