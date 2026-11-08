// An agent's action card (COMMENT-12): one-line summary, layer chips, a before/after swatch, time and Undo.
// Undo reverts exactly the card's tx (`board.revert(board.me, tx)`, skip-superseded); when a later edit changed the
// layer the button is disabled and says "Changed since". Pure view: the page supplies `env.undo` (or `env.onUndo`).
import { useMemo, useState, useSyncExternalStore } from 'react';
import type { ChatMsg } from '../../chat/store';
import { activeBoard } from '../board/state';
import type { MessageEnv } from './MessageView';
import { changedSince, inspectTx } from './txDiff';
import type { TxDiff } from './txDiff';

const SHOWN = 6;

function Swatch({ diff }: { diff: TxDiff }) {
  if (diff.kind === 'size') {
    const f = (n: number) => (n > 0 ? `+${n}` : `${n}`);
    return <div className="diff" data-kind="size">w {f(diff.dw)} · h {f(diff.dh)}</div>;
  }
  const dot = (c: string) => <i className="sw" style={{ background: c, display: 'inline-block', width: 14, height: 14, borderRadius: 4, border: '1px solid var(--pg-line)', verticalAlign: 'middle' }} title={c} />;
  return <div className="diff" data-kind="color">{diff.from && <>{dot(diff.from)} → </>}{dot(diff.to)}</div>;
}

export function ActionCard({ m, env }: { m: ChatMsg; env: MessageEnv }) {
  const b = m.body as Extract<ChatMsg['body'], { kind: 'action' }>;   // MessageView only renders action bodies here
  const doc = env.doc ?? activeBoard()?.board.doc;
  const info = useMemo(() => (doc ? inspectTx(doc, b.tx) : undefined), [doc, b.tx]);
  const changed = useSyncExternalStore(
    (cb) => (doc ? doc.subscribe(cb) : () => {}),
    () => !!doc && !!info && !b.undone && changedSince(doc, info),
  );
  const [refused, setRefused] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const blocked = changed || refused !== null;
  const reason = refused ?? (changed ? 'Changed since: a later edit touched this layer' : '');

  const undo = () => {
    if (env.undo) {
      const r = env.undo(m);
      if (!r.ok) setRefused(r.message);
    } else env.onUndo?.(m);
  };
  const layers = all ? b.layers : b.layers.slice(0, SHOWN);

  return (
    <div className={'pg-msg action' + (b.undone ? ' undone' : '')}>
      <span className="av" style={{ background: m.color }}>{m.name[0]}</span>
      <div className="card" style={{ ['--c' as string]: m.color }}>
        <div className="sum"><span className="ic">✦</span>{b.summary}{b.undone && <em>Undone</em>}</div>
        {info?.diff && !b.undone && <Swatch diff={info.diff} />}
        {b.layers.length > 0 && (
          <div className="chips">
            {layers.map((l) => {
              const name = env.layerName(l);
              return <button key={l} className="pg-ctx" disabled={!name} onClick={() => env.onShowShape(l)} title="Show on board">◎ {name ?? 'deleted layer'}</button>;
            })}
            {b.layers.length > SHOWN && (
              <button className="more pg-more" onClick={() => setAll((v) => !v)}>{all ? 'Show fewer' : `+${b.layers.length - SHOWN}`}</button>
            )}
          </div>
        )}
        <div className="foot">
          <time>{new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
          {!b.undone && (env.undo || env.onUndo) && (
            <button onClick={undo} disabled={blocked} title={blocked ? reason : 'Undo this change only'}>{blocked ? 'Changed since' : 'Undo'}</button>
          )}
        </div>
        {refused && <small className="why" style={{ color: 'var(--pg-muted)' }}>{refused}</small>}
      </div>
    </div>
  );
}
