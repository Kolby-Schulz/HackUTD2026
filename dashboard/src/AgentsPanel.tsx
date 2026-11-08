// Left column, on every tab: agents grouped by status, paused first (storyboard H1 option B).
import type * as R from '@bindings/types.ts';
import type { AgentCard, CoordView } from './model.ts';
import { fmtK } from './model.ts';
import { NewTaskForm } from './NewTaskForm.tsx';
import { MessageBox } from './MessageBox.tsx';
import { Avatar, Empty } from './ui.tsx';

const GROUPS: [string, string][] = [['Paused', 'var(--warn)'], ['Working', 'var(--ok)'], ['Idle', 'var(--text2)'], ['Done', 'var(--done)']];

export function AgentsPanel({ agents, coord, openRun, tasks, onlineIds }: { agents: AgentCard[]; coord: CoordView; openRun?: R.Run; tasks: readonly R.Task[]; onlineIds: Set<string> }) {
  return (
    <aside className="card agents" aria-label="Agents">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ fontSize: 16 }}>Agents</h2>
        <span className="muted" style={{ fontSize: 12 }}>{agents.length + 1} connected</span>
      </div>
      {agents.length === 0 && <Empty>No worker agents yet. They appear here when a worker calls register_agent.</Empty>}
      {GROUPS.map(([label, color]) => {
        const items = agents.filter((a) => a.status === label);
        if (!items.length) return null;
        return (
          <section key={label} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="cap" style={{ color, display: 'flex', alignItems: 'center', gap: 6 }}><span className="dot" style={{ background: color, width: 6, height: 6 }} />{label} · {items.length}</div>
            {items.map((a) => <AgentItem key={a.id} a={a} />)}
          </section>
        );
      })}
      {agents.some((a) => a.status === 'Working' || a.status === 'Paused') && (
        <section className="new-task" style={{ gap: 6 }}>
          <div className="cap muted">Message all agents</div>
          <MessageBox agentId="*" label="Tell every running agent…" />
        </section>
      )}
      <NewTaskForm agents={agents.filter((a) => onlineIds.has(a.id))} openRun={openRun} tasks={tasks} />
      <div style={{ marginTop: 'auto', borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div className="cap muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="dot" style={{ width: 6, height: 6, background: coord.status === 'Working' ? 'var(--ok)' : 'var(--text2)' }} />Coordinator · {coord.status}
        </div>
        <div style={{ display: 'flex', gap: 9, fontSize: 13 }}><span className="grow">{coord.note}</span><span className="mono muted" style={{ fontSize: 12 }}>{fmtK(coord.tokens)}</span></div>
      </div>
    </aside>
  );
}

function AgentItem({ a }: { a: AgentCard }) {
  const paused = a.status === 'Paused';
  return (
    <div className={'agent-card' + (paused ? ' paused' : '')}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <Avatar p={a.person} size={24} />
        <span style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>{a.person.name}</span>
        <span className="muted ellipsis" style={{ fontSize: 12 }}>{[a.ownerDev, a.machine].filter(Boolean).join(' · ')}</span>
      </div>
      {a.offline && (a.status === 'Working' || paused) && (
        <div className="offline" role="status">Laptop offline · last seen {ago(Date.now() - a.lastSeen)} ago</div>
      )}
      {paused && <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--warn)' }}>{a.waitingOn ? `Waiting on conflict #${a.waitingOn}` : 'Waiting on the coordinator'}</div>}
      {a.note && (paused || a.status === 'Done') && <div className="muted" style={{ fontSize: 12, lineHeight: 1.4 }}>{a.note}</div>}
      <div style={{ fontSize: 13, lineHeight: 1.4 }}>
        {a.task}
        {a.attempt > 1 && <span style={{ color: 'var(--warn)' }}> · attempt {a.attempt}</span>}
      </div>
      {a.plan && <div className="muted" style={{ fontSize: 12, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{a.plan}</div>}
      <div className="chips">
        {a.claims.length ? a.claims.map((c) => <span key={c} className="chip">{c}</span>) : <span className="muted" style={{ fontSize: 12 }}>Holds nothing</span>}
      </div>
      <div>
        <div className="mono muted" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
          <span>{fmtK(a.useful)} useful{a.wasted > 0 && <> · <span style={{ color: 'var(--warn)' }}>{fmtK(a.wasted)} wasted</span></>}</span>
          <span>{a.budget ? `${Math.round(((a.useful + a.wasted) / a.budget) * 100)}% of ${fmtK(a.budget)}` : 'no budget'}</span>
        </div>
        <div className="bar" style={{ height: 4, marginTop: 5 }} aria-hidden="true">
          <span style={{ width: `${a.usePct}%`, background: a.person.color }} />
          <span className="waste-stripe" style={{ width: `${a.wastePct}%` }} />
        </div>
      </div>
      {a.lastEdit && (a.status === 'Working' || paused) && (
        <div className="muted" style={{ fontSize: 12 }}>Last edit <a href="#/code" className="mono">{a.lastEdit.file}</a> · {ago(a.lastEdit.ago)} ago</div>
      )}
      {(a.status === 'Working' || paused) && <MessageBox agentId={a.id} label={`Message ${a.person.name}…`} messages={a.messages} />}
    </div>
  );
}

function ago(msAgo: number): string {
  const s = Math.round(msAgo / 1000);
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`;
}
