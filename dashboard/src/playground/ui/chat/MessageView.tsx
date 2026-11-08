// One chat line, drawn by message kind (COMMENT-11): text bubbles, dim status lines, action cards,
// routing chips, conflict and error cards, centred system notes. Layer references are clickable chips.
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { ChatMsg } from '../../chat/store';
import { YOU } from '../../chat/store';
import type { DocStore, Result } from '../../core/types';
import { ActionCard } from './ActionCard';
import { THINKING } from './agentChat';
import { ConflictCard } from './ConflictCard';

/** What a line needs from the page: show a layer, name an actor or layer, undo an action. */
export type MessageEnv = {
  onShowShape: (id: string) => void;
  nameOf: (actorId: string) => string;
  layerName: (id: string) => string | undefined;
  /** Old hook: revert the card's tx and mark it undone; gives no result, so the card cannot show why it failed. */
  onUndo?: (m: ChatMsg) => void;
  /** Preferred: revert the card's tx with `board.revert(board.me, tx)`, mark it undone on success, return the result. */
  undo?: (m: ChatMsg) => Result;
  /** The document, for the card's diff and "Changed since" check (defaults to the mounted board's). */
  doc?: DocStore;
};

const WHY: Record<string, string> = {
  mention: 'you mentioned them', claim: 'claimed this area', author: 'made this layer',
  'frame-author': 'made this frame', nearest: 'closest agent', manual: 'picked for you',
};
const STATUS_RUN = 3;
const isEnded = (m: ChatMsg) => m.body.kind === 'status' && !!m.body.final && !m.body.text;

/** Messages of one thread; runs of more than three status lines collapse behind "Show N more". */
export function Messages({ msgs, env }: { msgs: readonly ChatMsg[]; env: MessageEnv }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const out: ReactNode[] = [];
  for (let i = 0; i < msgs.length; i++) {
    if (isEnded(msgs[i])) continue;
    if (msgs[i].body.kind !== 'status') { out.push(<MessageView key={msgs[i].id} m={msgs[i]} env={env} />); continue; }
    let j = i;
    while (j < msgs.length && (msgs[j].body.kind === 'status' || isEnded(msgs[j]))) j++;
    const run = msgs.slice(i, j).filter((x) => !isEnded(x));
    const key = run[0].id;
    const hidden = open[key] || run.length <= STATUS_RUN ? 0 : run.length - STATUS_RUN;
    if (hidden) out.push(<button key={key + '-more'} className="pg-more" onClick={() => setOpen((o) => ({ ...o, [key]: true }))}>Show {hidden} more</button>);
    for (const m of run.slice(hidden)) out.push(<MessageView key={m.id} m={m} env={env} />);
    i = j - 1;
  }
  return <>{out}</>;
}

export function MessageView({ m, env }: { m: ChatMsg; env: MessageEnv }) {
  const b = m.body;
  const id = `msg-${m.id}`;
  switch (b.kind) {
    case 'status':
      if (b.final && !b.text) return null;   // an ended thinking placeholder: the reply or card took its place
      return <div id={id} className={'pg-msg status' + (b.text === THINKING ? ' thinking' : '')} aria-live="polite"><i style={{ background: m.color }} />{m.name} · {b.text}</div>;
    case 'system':
      return <div id={id} className="pg-msg system">{b.text}</div>;
    case 'routing':
      return <div id={id} className="pg-msg routing"><span className="chip">routed to {env.nameOf(b.to)} · {WHY[b.why] ?? b.why}</span></div>;
    case 'error':
      return <div id={id} className="pg-msg error" role="alert"><b>{m.name}</b><p>{b.text}</p></div>;
    case 'conflict':
      return <ConflictCard m={m} />;
    case 'action':
      return <div id={id}><ActionCard m={m} env={env} /></div>;
    case 'text':
    default: {
      const unknown = (b as { kind: string }).kind !== 'text';
      const text = unknown ? m.text : (b as { text: string }).text;
      if (m.from === YOU) {
        return (
          <div id={id} className="pg-msg you">
            {m.ctx && <Ctx m={m} env={env} />}
            <div className="bubble">{text}</div>
          </div>
        );
      }
      return (
        <div id={id} className="pg-msg agent">
          <Avatar m={m} />
          <div className="body">
            <b style={{ color: m.color }}>{m.name}{unknown && <small> · {(b as { kind: string }).kind}</small>}</b>
            {m.ctx && <Ctx m={m} env={env} />}
            <p>{text}</p>
          </div>
        </div>
      );
    }
  }
}

function Avatar({ m }: { m: ChatMsg }) {
  return <span className="av" style={{ background: m.color }}>{m.from === 'claude' ? '✳' : m.name[0]}</span>;
}

function Ctx({ m, env }: { m: ChatMsg; env: MessageEnv }) {
  return (
    <button className="pg-ctx" onClick={() => m.shapeId && env.onShowShape(m.shapeId)} disabled={!m.shapeId} title="Show on board">
      ◎ {m.ctx}
    </button>
  );
}
