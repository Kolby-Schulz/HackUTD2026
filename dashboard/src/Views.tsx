// The workbench's views: the Agents side bar, the symbol details widget on the code map, and
// the bottom panel (Savings and Problems). Each fact has one home: what an agent is doing lives
// in the side bar, where it happens lives on the map, conflicts live under Problems.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type * as R from '@bindings/types.ts';
import type { AgentCard, CaseView, CoordView, FeedEvent, HistoryItem, MapNode, Savings, TokenStats } from './model.ts';
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
    <div role="dialog" aria-label={`${node.name} details`}>
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
          {openCase && <div className="alert"><span>Conflict #{openCase.key} open</span><span style={{ color: 'var(--text2)', fontWeight: 500 }}>see Problems</span></div>}
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

/* ---------------- bottom panel: Savings, Problems and Tokens ---------------- */

export type PanelTab = 'savings' | 'problems' | 'tokens';
export type CaseFilter = 'all' | 'open' | 'resolved';

const CASE_FILTERS: { id: CaseFilter; label: string; test: (c: CaseView) => boolean }[] = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'open', label: 'Open', test: (c) => c.open },
  { id: 'resolved', label: 'Avoided', test: (c) => c.status === 'Resolved' },
];

/** A big number that opens the list behind it. */
function Stat({ label, onOpen, cta, children }: { label: string; onOpen: () => void; cta: string; children: ReactNode }) {
  return (
    <button type="button" className="stat" onClick={onOpen} aria-label={`${label}: ${cta}`}>
      <span className="hd">{label}</span>
      {children}
      <span className="stat-cta">{cta} →</span>
    </button>
  );
}

export function BottomPanel({ savings, tokens, cases, tab, setTab, filter, setFilter, flash, expanded, onPickCase, onShowProblems, onClose }: {
  savings: Savings; tokens: TokenStats; cases: CaseView[]; tab: PanelTab; setTab: (t: PanelTab) => void;
  filter: CaseFilter; setFilter: (f: CaseFilter) => void; flash: number; expanded?: string;
  onPickCase: (c: CaseView) => void; onShowProblems: (f: CaseFilter) => void; onClose: () => void;
}) {
  const open = cases.filter((c) => c.open);
  const resolved = cases.filter((c) => c.status === 'Resolved').length;
  const maxBar = Math.max(1, savings.base ?? 0, savings.current);
  const shown = cases.filter(CASE_FILTERS.find((f) => f.id === filter)!.test);
  const list = useRef<HTMLDivElement>(null);
  // Switching tabs, or jumping here from a number, starts at the top of what opened.
  useEffect(() => { list.current?.scrollTo({ top: 0 }); }, [flash, tab]);

  return (
    <>
      <div className="ptabs" role="tablist" aria-label="Panel">
        <button type="button" role="tab" aria-selected={tab === 'savings'} onClick={() => setTab('savings')}>SAVINGS</button>
        <button type="button" role="tab" aria-selected={tab === 'problems'} onClick={() => setTab('problems')}>PROBLEMS {cases.length > 0 && <span className="count" style={{ background: open.length ? 'var(--danger)' : 'var(--ok)' }}>{open.length || cases.length}</span>}</button>
        <button type="button" role="tab" aria-selected={tab === 'tokens'} onClick={() => setTab('tokens')}>TOKENS</button>
        <span className="grow" />
        <button type="button" className="iconbtn" aria-label="Hide panel" title="Hide" onClick={onClose} style={{ alignSelf: 'center', height: 24 }}>{ICON.close}</button>
      </div>
      <div className="pane-body" ref={list}>
        {tab === 'savings' && (
          <div className="savings" role="tabpanel">
            <Stat label="Tokens saved" cta="See where they came from" onOpen={() => setTab('tokens')}>
              <span className="saved-row">
                <span className={'num' + (savings.saved ? '' : ' zero')} style={savings.saved ? { color: 'var(--accent)' } : undefined}>{savings.saved === undefined ? '—' : fmtK(savings.saved)}</span>
                {savings.base !== undefined && (
                  <span className="bars">
                    <span className="vs"><span className="muted">without</span><span className="track"><span style={{ width: `${(savings.base / maxBar) * 100}%`, background: 'var(--faint)' }} /></span><span className="mono" style={{ textAlign: 'right' }}>{fmtK(savings.base)}</span></span>
                    <span className="vs"><span style={{ color: 'var(--accent)', fontWeight: 600 }}>with</span><span className="track"><span style={{ width: `${(savings.current / maxBar) * 100}%`, background: 'var(--accent)' }} /></span><span className="mono" style={{ textAlign: 'right' }}>{fmtK(savings.current)}</span></span>
                  </span>
                )}
              </span>
              <span className="muted stat-note">{savings.base !== undefined ? 'Against the last run without InSync, at the same point in the run.' : savings.current === 0 ? 'Counts from this run’s first tokens.' : 'Run once without InSync (npm run demo -- --mode without_contract) to measure against.'}</span>
            </Stat>
            <Stat label="Conflicts caught" cta={cases.length ? 'Show all' : 'Open problems'} onOpen={() => onShowProblems('all')}>
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span className={'num' + (cases.length ? '' : ' zero')}>{cases.length}</span>
                {open.length > 0 && <span className="badge" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>{open.length} open</span>}
              </span>
              {cases[0] && <span className="ellipsis stat-note">
                <span className="mono" style={{ fontWeight: 700 }}>#{cases[0].key} {cases[0].symbol}</span> <span style={{ color: cases[0].open ? 'var(--warn)' : 'var(--ok)', fontWeight: 600 }}>{cases[0].open ? 'deciding' : cases[0].status.toLowerCase()}</span>
              </span>}
            </Stat>
            <Stat label="Merge failures avoided" cta={resolved ? 'Show the ones avoided' : 'Open problems'} onOpen={() => onShowProblems('resolved')}>
              <span className={'num' + (resolved ? '' : ' zero')} style={resolved ? { color: 'var(--ok)' } : undefined}>{resolved}</span>
              <span className="muted stat-note">Conflicts resolved while coding instead of at merge.</span>
            </Stat>
          </div>
        )}

        {tab === 'problems' && (
          <div role="tabpanel">
            <div className="pfilters" role="group" aria-label="Show">
              {CASE_FILTERS.map((f) => (
                <button key={f.id} type="button" className="chip" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                  {f.label} <span className="chip-n">{cases.filter(f.test).length}</span>
                </button>
              ))}
              <span className="grow" />
              <span className="muted" style={{ fontSize: 11.5 }}>Click a problem to see it on the code map and in Changes</span>
            </div>
            {!cases.length && <div className="empty">No problems. A conflict appears here the moment a plan or a change breaks one of the rules.</div>}
            {cases.length > 0 && !shown.length && <div className="empty">None {filter === 'open' ? 'open' : 'avoided yet'}.</div>}
            {shown.map((c) => {
              const on = expanded === c.key;
              return (
                <div key={`${c.key}-${flash}`} className={'problem' + (c.open ? ' open' : '') + (on ? ' on' : '') + (flash ? ' flash' : '')}>
                  <button type="button" className="problem-row" aria-expanded={on} onClick={() => onPickCase(c)}>
                    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">{c.open
                      ? <path d="M8 2L14.5 13.5h-13z M8 6.5v3 M8 11.5h.01" fill="none" stroke="var(--danger)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      : <path d="M14.25 8a6.25 6.25 0 1 1-12.5 0a6.25 6.25 0 1 1 12.5 0z M5.5 8.2l1.7 1.7 3.3-3.6" fill="none" stroke="var(--ok)" strokeWidth="1.8" strokeLinecap="round" />}</svg>
                    <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                      <span className="ellipsis"><span className="muted">#{c.key}</span> <span className="mono" style={{ fontWeight: 700 }}>{c.symbol}</span></span>
                      <span className="muted ellipsis" style={{ fontSize: 12 }}>{c.kind}{c.rule && ` · ${c.rule}`} · {c.agentA.name} ↔ {c.agentB.name}</span>
                    </span>
                    <span className="steps">
                      {c.steps.map((p, i) => {
                        const dot = p.state === 'done' ? { background: c.open ? 'var(--accent)' : 'var(--ok)' } : p.state === 'running' ? { border: '2px solid var(--warn)', background: 'var(--warn-soft)' } : { border: '2px solid var(--border)' };
                        return (
                          <span key={i} className="step">
                            <span className="line"><span className="sd" style={dot} />{i < c.steps.length - 1 && <span className="sl" />}</span>
                            <b style={{ color: p.state === 'running' ? 'var(--warn)' : p.state === 'waiting' ? 'var(--text2)' : undefined }}>{p.label}</b>
                            <span className="mono muted" style={{ fontSize: 11 }}>{p.time}</span>
                          </span>
                        );
                      })}
                    </span>
                  </button>
                  {on && (
                    <div className="problem-detail">
                      <p>{c.details}</p>
                      {c.owner && <p><b>Decision{c.durationText ? ` (${c.durationText})` : ''}:</b> {c.owner.name} owns <span className="mono">{c.symbol}</span>{c.reason ? `. ${c.reason}` : ''}</p>}
                      {c.instructionsA && <p><b>To {c.agentA.name}:</b> {c.instructionsA}</p>}
                      {c.instructionsB && <p><b>To {c.agentB.name}:</b> {c.instructionsB}</p>}
                      {!c.owner && c.open && <p className="muted">Waiting for the coordinator’s decision.</p>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {tab === 'tokens' && (
          <div className="savings tokens" role="tabpanel">
            <div>
              <span className="hd">Where the savings came from</span>
              {tokens.savings.map((s) => (
                <div key={s.kind} className="srow" title={s.how}>
                  <span>{s.label}<span className="muted"> · {s.count}×</span></span>
                  <span className={'mono' + (s.tokens ? '' : ' muted')}>{fmtK(s.tokens)}</span>
                  <span className="muted srow-how">{s.how}</span>
                </div>
              ))}
              <span className="muted stat-note">Estimated per event; the headline number on Savings is measured against a run without InSync.</span>
            </div>
            <div>
              <span className="hd">Where this run’s tokens went</span>
              {([['Useful work', tokens.useful, 'var(--accent)'], ['Thrown away', tokens.wasted, 'var(--danger)'], ['InSync’s coordinator', tokens.contract, 'var(--done)']] as const).map(([label, n, color]) => (
                <div key={label} className="vs wide">
                  <span>{label}</span>
                  <span className="track"><span style={{ width: `${(n / Math.max(1, tokens.total)) * 100}%`, background: color }} /></span>
                  <span className="mono" style={{ textAlign: 'right' }}>{fmtK(n)}</span>
                </div>
              ))}
              <span className="muted stat-note">Fresh tokens; {fmtK(tokens.cached)} more were cache reads. Cost so far ${tokens.cost.toFixed(2)}.</span>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
