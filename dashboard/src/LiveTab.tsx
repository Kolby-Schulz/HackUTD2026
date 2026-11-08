// Live tab (storyboard row G): KPIs, flat code map with detail cards, conflict steps (H2 C)
// and notification-style latest activity (H3 A).
import { useState } from 'react';
import type * as R from '@bindings/types.ts';
import type { AgentCard, CaseView, FeedEvent, MapEdge, MapNode, ModeSummary, Step, TokenStats } from './model.ts';
import { fmtK, symbolName } from './model.ts';
import { CodeMap } from './CodeMap.tsx';
import { Avatar, Empty, Icon, KIND_COLOR, StatusLabel } from './ui.tsx';

interface Props {
  agents: AgentCard[];
  cases: CaseView[];
  events: FeedEvent[];
  map: { nodes: MapNode[]; edges: MapEdge[] };
  stats: TokenStats;
  without?: ModeSummary;
  symbols: readonly R.Symbol[];
  edges: readonly R.SymbolEdge[];
  runStart: number;
}

export function LiveTab({ agents, cases, events, map, stats, without, symbols, edges, runStart }: Props) {
  const [picked, setPicked] = useState<string>();
  const resolved = cases.filter((c) => !c.open).length;
  const open = cases.filter((c) => c.open);
  const count = (s: string) => agents.filter((a) => a.status === s).length;
  const fallback = open[0]?.symbolId ?? map.nodes.find((n) => n.state === 'changed')?.id ?? map.nodes.find((n) => n.owner)?.id;
  const selected = picked && map.nodes.some((n) => n.id === picked) ? picked : fallback;

  return (
    <>
      <div className="kpis">
        <div>
          <div className="muted" style={{ fontSize: 13 }}>Conflicts caught</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span className="kpi-v">{resolved}</span>
            <span style={{ fontSize: 13, fontWeight: 500, color: open.length ? 'var(--danger)' : 'var(--text2)' }}>{open.length ? `${open.length} open now` : 'none open'}</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div>
            <div className="muted" style={{ fontSize: 13 }}>Tokens this run</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span className="kpi-v">{fmtK(stats.total)}</span>
              <span className="muted" style={{ fontSize: 13 }}>{without ? `vs ${fmtK(without.total)} without` : 'no baseline run yet'}</span>
            </div>
          </div>
          <Spark stats={stats} start={runStart} />
        </div>
        <div>
          <div className="muted" style={{ fontSize: 13 }}>Agents</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span className="kpi-v">{count('Working')} working</span>
            <span className="muted" style={{ fontSize: 13 }}>{count('Paused')} paused · {count('Done')} done</span>
          </div>
        </div>
      </div>

      <div className="live-grid">
        <div className="map-wrap">
          <div className="legend" aria-label="Legend">
            <span><i style={{ borderColor: agents[0]?.person.color ?? '#58a6ff' }} />claimed (agent's color)</span>
            <span><i style={{ borderColor: 'var(--warn)' }} />changed</span>
            <span><i style={{ borderColor: 'var(--danger)' }} />conflict</span>
            <span><i style={{ borderColor: 'var(--text2)', borderStyle: 'dashed', borderWidth: 1.5 }} />planned</span>
          </div>
          <CodeMap nodes={map.nodes} edges={map.edges} selected={selected} onSelect={setPicked} />
        </div>
        <div className="side-cards">
          {open.map((c) => <CaseCard key={c.key} c={c} />)}
          {selected && <SymbolCard id={selected} node={map.nodes.find((n) => n.id === selected)!} symbols={symbols} edges={edges} />}
        </div>
      </div>

      <div className="bottom">
        <section className="card" style={{ padding: '12px 16px' }} aria-label="Conflicts">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
            <h3 style={{ fontSize: 14 }}>Conflicts</h3>
            <span className="muted" style={{ fontSize: 12 }}>
              {!cases.length ? 'detected by rules, in milliseconds' : open.length ? `${open.length} open · ${resolved} resolved` : `all ${resolved} resolved`}
              {cases.length > 2 && <> · <a href="#/activity">{cases.length - 2} more</a></>}
            </span>
          </div>
          {!cases.length && <div style={{ paddingTop: 6 }}><Empty>None yet. A conflict appears here the moment a plan or a change breaks one of the three rules.</Empty></div>}
          {cases.slice(0, 2).map((c) => (
            <div key={c.key} className="case-row">
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}><span className="muted" style={{ fontSize: 12 }}>#{c.key}</span><span className="mono ellipsis" style={{ fontSize: 13, fontWeight: 600 }}>{c.symbol}</span></div>
                <div className="muted ellipsis" style={{ fontSize: 12 }}>{c.kind}{c.rule && ' · ' + c.rule}</div>
              </div>
              <Steps steps={c.steps} />
            </div>
          ))}
        </section>
        <section className="card" style={{ padding: '12px 16px' }} aria-label="Latest activity">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <h3 style={{ fontSize: 14 }}>Latest activity</h3>
            <a href="#/activity" style={{ fontSize: 13, fontWeight: 500 }}>View all in Activity</a>
          </div>
          {!events.length && <Empty>Nothing yet. Plans, claims and changes show up here as agents work.</Empty>}
          {events.slice(0, 3).map((x) => (
            <div key={x.key} className="note-row">
              <span style={{ position: 'relative', flex: 'none' }}>
                <Avatar p={x.kind === 'conflict' ? { ...x.actor, color: 'var(--danger)' } : x.actor} size={26} />
                <span className="badge-icon"><Icon kind={x.kind} size={11} width={2} /></span>
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="ellipsis" style={{ fontSize: 13 }}><b style={{ fontWeight: 600 }}>{x.actor.name}</b> {x.verb}</div>
                <div className="muted ellipsis" style={{ fontSize: 12 }}>{x.sub}</div>
              </div>
              <span className="mono muted" style={{ fontSize: 11, lineHeight: '18px' }}>{x.time}</span>
            </div>
          ))}
        </section>
      </div>
    </>
  );
}

export function Steps({ steps }: { steps: Step[] }) {
  return (
    <div className="steps">
      {steps.map((p, i) => {
        const dot = p.state === 'done' ? { background: 'var(--ok)' }
          : p.state === 'running' ? { border: '2px solid var(--warn)', background: 'var(--warn-soft)' } : { border: '2px solid var(--border)' };
        const line = i === steps.length - 1 ? 'transparent' : p.state === 'done' && steps[i + 1].state === 'done' ? 'var(--ok)' : 'var(--soft)';
        const color = p.state === 'done' ? 'var(--text)' : p.state === 'running' ? 'var(--warn)' : 'var(--text2)';
        return (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', height: 10 }}><span className="step-dot" style={dot} /><span className="step-line" style={{ background: line }} /></div>
            <div style={{ fontSize: 12, fontWeight: 600, color, whiteSpace: 'nowrap' }}>{p.label}</div>
            <div className="mono muted" style={{ fontSize: 11 }}>{p.time}</div>
          </div>
        );
      })}
    </div>
  );
}

function CaseCard({ c }: { c: CaseView }) {
  return (
    <div className="pop">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span className="mono" style={{ fontSize: 14, fontWeight: 600 }}>{c.symbol}</span>
        <StatusLabel status={c.status} dot={false} />
      </div>
      <div className="mono muted" style={{ fontSize: 12, margin: '2px 0 8px' }}>#{c.key} · {c.kind}{c.rule && ' · ' + c.rule}</div>
      <div className="kv">
        <span className="muted">Between</span><span style={{ fontWeight: 500 }}>{c.agentA.name} · {c.agentB.name}</span>
        <span className="muted">Opened</span><span className="mono">{c.opened}</span>
        <span className="muted">Why</span><span>{c.details}</span>
      </div>
    </div>
  );
}

function SymbolCard({ id, node, symbols, edges }: { id: string; node: MapNode; symbols: readonly R.Symbol[]; edges: readonly R.SymbolEdge[] }) {
  const s = symbols.find((x) => x.id === id);
  const callers = edges.filter((e) => e.calleeId === id).map((e) => symbolName(e.callerId, symbols));
  const callees = edges.filter((e) => e.callerId === id).map((e) => symbolName(e.calleeId, symbols));
  const badge = node.state === 'conflict' ? 'In conflict' : node.state === 'changed' ? 'Changed' : node.ghost ? 'Planned' : node.owner ? 'Claimed' : 'Free';
  const badgeColor = node.state === 'conflict' ? 'var(--danger)' : node.state === 'changed' ? 'var(--warn)' : 'var(--text2)';
  return (
    <div className="pop">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span className="mono ellipsis" style={{ fontSize: 14, fontWeight: 600 }}>{node.name}</span>
        <span className="pill" style={{ color: badgeColor }}>{badge}</span>
      </div>
      <div className="mono muted ellipsis" style={{ fontSize: 12, margin: '2px 0 8px' }}>{node.file}</div>
      <div className="kv">
        {s && <><span className="muted">Signature</span><span className="mono" style={{ fontSize: 12, wordBreak: 'break-word' }}>{s.signature}</span></>}
        <span className="muted">Kind</span><span>{node.kind}{s ? ` · v${s.version}` : ''}</span>
        <span className="muted">Held by</span><span style={{ color: node.owner?.color }}>{node.owner ? node.owner.name : 'nobody'}</span>
        <span className="muted">Called by</span><span className="mono" style={{ fontSize: 12 }}>{callers.join(', ') || 'none'}</span>
        <span className="muted">Calls</span><span className="mono" style={{ fontSize: 12 }}>{callees.join(', ') || 'none'}</span>
        {s?.behaviorNote && <><span className="muted">Behavior</span><span>{s.behaviorNote}</span></>}
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Click a symbol on the map to inspect it.</div>
    </div>
  );
}

/** 16 bars of tokens logged per slice of the run so far. */
function Spark({ stats, start }: { stats: TokenStats; start: number }) {
  const pts = stats.series;
  if (!pts.length) return null;
  const end = Math.max(start + 1, pts[pts.length - 1].at);
  const bins = new Array(16).fill(0);
  let prev = 0;
  for (const p of pts) {
    const tot = p.useful + p.wasted + p.contract;
    const i = Math.min(15, Math.floor(((p.at - start) / (end - start)) * 16));
    bins[Math.max(0, i)] += tot - prev;
    prev = tot;
  }
  const max = Math.max(1, ...bins);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 34 }} aria-hidden="true">
      {bins.map((b, i) => <span key={i} style={{ width: 4, borderRadius: 1, background: KIND_COLOR.plan, height: Math.max(2, (b / max) * 34) }} />)}
    </div>
  );
}
