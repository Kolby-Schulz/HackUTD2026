// Actors with their presence state, as the panels and the cursor layer need them.
import { useCallback, useEffect, useState } from 'react';
import type { BoardKit } from '../core/commands';
import type { ActorId, ActorKind, AgentState } from '../core/types';

export type Meta = { id: ActorId; name: string; color: string; kind: ActorKind; state?: AgentState; detail?: string };

export const statusOf = (m: Meta) => (m.state === 'paused' ? 'paused' : m.state === 'stopped' ? 'stopped' : m.detail ?? m.state ?? 'idle');

/** Actors with their presence state; re-renders only when names, colours or statuses change. */
export function useActorMeta(board: BoardKit): Meta[] {
  const compute = useCallback((): Meta[] => board.actors.list()
    .filter((a) => a.id === board.me || board.presence.get(a.id))
    .map((a) => { const p = board.presence.get(a.id); return { id: a.id, name: a.name, color: a.color, kind: a.kind, state: p?.state, detail: p?.detail }; }), [board]);
  const [list, setList] = useState(compute);
  useEffect(() => {
    let key = '';
    const update = () => { const next = compute(); const k = JSON.stringify(next); if (k !== key) { key = k; setList(next); } };
    update();
    const offs = [board.actors.subscribe(update), board.presence.subscribe(update)];
    return () => offs.forEach((f) => f());
  }, [board, compute]);
  return list;
}
