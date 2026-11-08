// The workbench's views: the Agents side bar, the symbol details widget on the code map, and
// the bottom Savings panel. Each fact has one home: what an agent is doing lives in the side
// bar, where it happens (including conflicts) lives on the map.
import { useEffect, useRef, useState } from 'react';
import type * as R from '@bindings/types.ts';
import type { AgentCard, CaseView, CoordView, FeedEvent, HistoryItem, MapNode, Savings } from './model.ts';
import { fmtK, symbolName } from './model.ts';
import { ICON } from './Workbench.tsx';

const STATUS_BADGE: Record<string, [string, string]> = {
  Working: ['var(--accent)', 'var(--accent-soft)'],
  Paused: ['var(--warn)', 'var(--warn-soft)'],
  Done: ['var(--done)', 'var(--done-soft)'],
  Idle: ['var(--text2)', 'var(--soft)'],
  Deciding: ['var(--warn)', 'var(--warn-soft)'],
  Offline: ['var(--text2)', 'var(--soft)'],
};

function Badge({ status }: { status: string }) {
  const [fg, bg] = STATUS_BADGE[status] ?? STATUS_BADGE.Idle;
  return <span className="badge" style={{ color: fg, background: bg }}>{status}</span>;
}

/** The newest thing an actor did, phrased as what it would say. */
function said(events: FeedEvent[], id: string): FeedEvent | undefined {
  return events.find((e) => e.actor.id === id && e.kind !== 'claim');
}

/* ---------------- Agents side bar ---------------- */

export function AgentsView({ agents: called, waiting = [], coord, events, runLabel }: { agents: AgentCard[]; waiting?: AgentCard[]; coord: CoordView; events: FeedEvent[]; runLabel: string }) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  // registered workers that have not been called in this run stay hidden unless asked for
  const [showWaiting, setShowWaiting] = useState(false);
  const agents = showWaiting ? [...called, ...waiting] : called;
  const toggle = (id: string) => setClosed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  // agent card turns green for a moment when it leaves Paused (storyboard: amber on pause, green on resume)
  const prev = useRef(new Map<string, string>());
  const [resumed, setResumed] = useState<Set<string>>(new Set());
  useEffect(() => {
    const back = agents.filter((a) => prev.current.get(a.id) === 'Paused' && a.status === 'Working').map((a) => a.id);
    agents.forEach((a) => prev.current.set(a.id, a.status));
    if (!back.length) return;
    setResumed((s) => new Set([...s, ...back]));
    const t = setTimeout(() => setResumed((s) => new Set([...s].filter((x) => !back.includes(x)))), 2500);
    return () => clearTimeout(t);
  }, [agents]);

  const working = agents.filter((a) => a.status === 'Working').length;
  const coordSaid = said(events, 'coordinator');
  return (
    <>
      <div className="tree-run">{ICON.chevron}<span className="ellipsis">{runLabel}</span><span className="muted" style={{ fontWeight: 500, marginLeft: 4 }}>{working} working</span></div>
      {called.length === 0 && <div className="empty">No agent has been called in this run yet. Agents appear here once they get a task or start working.</div>}
      {agents.map((a) => {
        const s = said(events, a.id);
        const open = !closed.has(a.id);
        const status = a.offline ? 'Offline' : a.status;
        const cls = ['agent', a.status === 'Paused' && 'paused', resumed.has(a.id) && 'resumed', a.offline && 'offline'].filter(Boolean).join(' ');
        return (
          <section key={a.id} className={cls} aria-label={a.person.name}>
            <button type="button" className="agent-row" aria-expanded={open} onClick={() => toggle(a.id)}>
              <span className={'chev' + (open ? '' : ' closed')}>{ICON.chevron}</span>
              <span className="sq" style={{ background: a.person.color }}>{a.person.letter}</span>
              <span className="ellipsis grow"><b>{a.person.name}</b> <span className="muted">{a.task}</span></span>
              <Badge status={status} />
            </button>
            {open && (
              <div className="agent-body">
                {a.status === 'Paused' && <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--warn)', paddingLeft: 10 }}>{a.waitingOn ? `Waiting on conflict #${a.waitingOn}` : 'Waiting on the coordinator'}</div>}
                <div className="say" style={{ ['--c' as string]: a.person.color }}>{s ? `“${s.verb}${s.sub ? `: ${s.sub}` : ''}”` : <span className="muted">Nothing yet</span>}</div>
                <div className="agent-meta">{s ? `${s.time} · ` : ''}{fmtK(a.total)} tokens{a.wasted > 0 ? ` · ${fmtK(a.wasted)} wasted` : ''}{a.attempt > 1 ? ` · attempt ${a.attempt}` : ''}</div>
                {a.budget > 0 && <div className="spend" aria-hidden="true"><span style={{ width: `${a.usePct}%`, background: a.person.color }} /><span className="waste" style={{ width: `${a.wastePct}%` }} /></div>}
              </div>
            )}
          </section>
        );
      })}
      {waiting.length > 0 && (
        <button type="button" className="waiting-toggle" aria-expanded={showWaiting} onClick={() => setShowWaiting(!showWaiting)}>
          {showWaiting ? 'Hide' : 'Show'} {waiting.length} registered agent{waiting.length === 1 ? '' : 's'} not called yet
        </button>
      )}
      <section className={'agent' + (coord.status === 'Working' ? ' paused' : '')} aria-label="Coordinator">
        <div className="agent-row" style={{ cursor: 'default' }}>
          <span className="chev">{ICON.chevron}</span>
          <span className="sq" style={{ background: '#64748b' }}>C</span>
          <span className="ellipsis grow"><b>Coordinator</b></span>
          <Badge status={coord.status === 'Working' ? 'Deciding' : 'Idle'} />
        </div>
        <div className="agent-body">
          <div className="say" style={{ ['--c' as string]: 'var(--warn)' }}>{coordSaid ? `“${coordSaid.verb}${coordSaid.sub ? `: ${coordSaid.sub}` : ''}”` : coord.note}</div>
          <div className="agent-meta">{coordSaid ? `${coordSaid.time} · ` : ''}{fmtK(coord.tokens)} tokens</div>
        </div>
      </section>
    </>
  );
}

/* ---------------- symbol details widget (on the code map) ---------------- */

const TONE: Record<string, string> = { plan: 'var(--text2)', agent: 'var(--accent)', change: 'var(--warn)', conflict: 'var(--danger)', resolved: 'var(--ok)' };
const STATE_WORD: Record<string, [string, string]> = {
  conflict: ['In conflict', 'var(--danger)'], changed: ['Changed', 'var(--warn)'], planned: ['Planned', 'var(--text2)'], claimed: ['Claimed', 'var(--accent)'], idle: ['Free', 'var(--text2)'],
};

export function SymbolWidget({ node, symbols, edges, history, openCase, onClose }: {
  node: MapNode; symbols: readonly R.Symbol[]; edges: readonly R.SymbolEdge[]; history: HistoryItem[]; openCase?: CaseView; onClose: () => void;
}) {
  const [tab, setTab] = useState<'overview' | 'history'>('overview');
  const s = symbols.find((x) => x.id === node.id);
  const callers = edges.filter((e) => e.calleeId === node.id).map((e) => symbolName(e.callerId, symbols));
  const callees = edges.filter((e) => e.callerId === node.id).map((e) => symbolName(e.calleeId, symbols));
  const [word, color] = STATE_WORD[node.state] ?? STATE_WORD.idle;
  const who = node.owners.map((p) => p.name).join(' and ');
  return (
    <div className="widget-inner" role="dialog" aria-label={`${node.name} details`}>
      <div className="widget-head">
        <span className="dot" style={{ background: color }} />
        <span className="mono grow ellipsis" style={{ fontWeight: 700 }}>{node.name}</span>
        <span className="muted" style={{ fontSize: 11.5 }}>{word}{node.version > 1 ? ` · v${node.version}` : ''}</span>
        <button type="button" className="iconbtn" style={{ width: 22, height: 22 }} aria-label="Close details" onClick={onClose}>{ICON.close}</button>
      </div>
      <div className="wtabs" role="tablist" aria-label={`${node.name} tabs`}>
        <button type="button" role="tab" aria-selected={tab === 'overview'} onClick={() => setTab('overview')}>Overview</button>
        <button type="button" role="tab" aria-selected={tab === 'history'} onClick={() => setTab('history')}>History {history.length > 0 && <span className="muted">{history.length}</span>}</button>
      </div>
      {tab === 'overview' ? (
        <div className="wbody" role="tabpanel">
          <div className="sig">{s?.signature ?? 'Not written yet (planned)'}</div>
          {s?.behaviorNote && <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>{s.behaviorNote}</div>}
          <div className="kv">
            <span className="muted">{node.ghost ? 'Planned by' : 'Held by'}</span><span>{who || 'nobody'}</span>
            <span className="muted">Called by</span><span className="mono" style={{ fontSize: 11.5 }}>{callers.join(', ') || 'none'}</span>
            <span className="muted">Calls</span><span className="mono" style={{ fontSize: 11.5 }}>{callees.join(', ') || 'none'}</span>
            <span className="muted">File</span><span className="mono ellipsis" style={{ fontSize: 11.5 }}>{node.file}</span>
          </div>
          {openCase && <div className="alert"><span>Conflict #{openCase.key} open</span><span style={{ color: 'var(--text2)', fontWeight: 500 }}>{openCase.kind}</span></div>}
        </div>
      ) : (
        <div className="wbody" role="tabpanel">
          {!history.length && <div className="muted">Nothing has happened to this symbol in this run yet.</div>}
          <div>
            {history.map((h) => (
              <div key={h.key} className="tl">
                <span className="td" style={{ background: h.color ?? TONE[h.tone] }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12.5 }}><b>{h.title}</b><span className="mono muted" style={{ fontSize: 11 }}>{h.time}</span></div>
                <div className="muted" style={{ fontSize: 12, lineHeight: 1.4 }}>{h.sub}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- bottom panel: Savings ---------------- */

export function BottomPanel({ savings, cases, onClose }: { savings: Savings; cases: CaseView[]; onClose: () => void }) {
  const open = cases.filter((c) => c.open);
  const resolved = cases.filter((c) => c.status === 'Resolved').length;
  const maxBar = Math.max(1, savings.base ?? 0, savings.current);
  return (
    <>
      <div className="ptabs">
        <h2 className="ptitle">SAVINGS</h2>
        <span className="grow" />
        <button type="button" className="iconbtn" aria-label="Hide panel" title="Hide" onClick={onClose} style={{ alignSelf: 'center', height: 24 }}>{ICON.close}</button>
      </div>
      <div className="pane-body">
        <div className="savings">
          <div>
            <div className="hd">Tokens saved</div>
            <div className="saved-row">
              <span className={'num' + (savings.saved ? '' : ' zero')} style={savings.saved ? { color: 'var(--accent)' } : undefined}>{savings.saved === undefined ? '—' : fmtK(savings.saved)}</span>
              {savings.base !== undefined && (
                <div>
                  <div className="vs"><span className="muted">without</span><span className="track"><span style={{ width: `${(savings.base / maxBar) * 100}%`, background: '#afb8c1' }} /></span><span className="mono" style={{ textAlign: 'right' }}>{fmtK(savings.base)}</span></div>
                  <div className="vs"><span style={{ color: 'var(--accent)', fontWeight: 600 }}>with</span><span className="track"><span style={{ width: `${(savings.current / maxBar) * 100}%`, background: 'var(--accent)' }} /></span><span className="mono" style={{ textAlign: 'right' }}>{fmtK(savings.current)}</span></div>
                </div>
              )}
            </div>
            <div className="muted" style={{ fontSize: 12 }}>{savings.base !== undefined ? 'Against the last run without InSync, at the same point in the run.' : savings.current === 0 ? 'Counts from this run’s first tokens.' : 'Run once without InSync (npm run demo -- --mode without_contract) to measure against.'}</div>
          </div>
          <div>
            <div className="hd">Conflicts caught</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span className={'num' + (cases.length ? '' : ' zero')}>{cases.length}</span>
              {open.length > 0 && <span className="badge" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>{open.length} open</span>}
            </div>
            {cases[0] && <div style={{ fontSize: 12 }} className="ellipsis">
              <span className="mono" style={{ fontWeight: 700 }}>#{cases[0].key} {cases[0].symbol}</span> <span style={{ color: cases[0].open ? 'var(--warn)' : 'var(--ok)', fontWeight: 600 }}>{cases[0].open ? 'deciding' : cases[0].status.toLowerCase()}</span>
            </div>}
          </div>
          <div>
            <div className="hd">Merge failures avoided</div>
            <span className={'num' + (resolved ? '' : ' zero')}>{resolved}</span>
            <div className="muted" style={{ fontSize: 12, lineHeight: 1.45 }}>Conflicts resolved while coding instead of at merge.</div>
          </div>
        </div>
      </div>
    </>
  );
}
