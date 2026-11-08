// Coordinator ruling card (AGENT-13): "Juno keeps Hero section; Rex moves to slot 7", both agents' colour dots, a state
// line and an Overrule button that swaps the holder. The ruling lives in the coordinator (agents/coordinator.ts); the card
// reads it through `activeCoordinator()`, and degrades to the plain text when none is running (reloaded history).
import { useSyncExternalStore } from 'react';
import type { ChatMsg } from '../../chat/store';
import { activeBoard } from '../board/state';
import { activeCoordinator } from '../../agents/coordinator';
import type { Ruling } from '../../agents/coordinator';

const none = () => () => {};
const dot = (color: string): React.CSSProperties => ({ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: color, marginRight: 4 });

export function ConflictCard({ m }: { m: ChatMsg }) {
  const conflictId = (m.body as { conflictId?: string }).conflictId ?? '';
  const co = activeCoordinator();
  const ruling: Ruling | undefined = useSyncExternalStore(
    (cb) => (co ? co.subscribe(cb) : none()),
    () => co?.ruling(conflictId),
  );
  // `ruling` is mutated in place by overrule; the version string makes React see the change
  useSyncExternalStore((cb) => (co ? co.subscribe(cb) : none()), () => (ruling ? `${ruling.holder}|${ruling.overruled}` : ''));
  const actors = activeBoard()?.board.actors;
  const color = (id: string) => actors?.get(id)?.color ?? 'var(--pg-muted)';
  const name = (id: string) => actors?.get(id)?.name ?? id;

  return (
    <div id={`msg-${m.id}`} className="pg-msg conflict" role="status">
      <b>Coordinator ruling</b>
      <p>{m.text && m.text !== 'Conflict' ? m.text : `${m.name} ruled on a claim conflict. The human edit wins.`}</p>
      {ruling && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--pg-muted)' }}>
          <span><i style={dot(color(ruling.holder))} />{name(ruling.holder)} holds</span>
          <span><i style={dot(color(ruling.loser))} />{name(ruling.loser)} {ruling.human ? 'steps back' : `slot ${(ruling.slot ?? 0) + 1}`}</span>
          {!ruling.human && (
            <button type="button" className="pg-ctx" style={{ marginLeft: 'auto' }} onClick={() => co?.overrule(ruling.conflictId)} title="Give the layer to the other agent">
              Overrule
            </button>
          )}
        </div>
      )}
    </div>
  );
}
