// Tokens tab (storyboard F4): totals, useful vs wasted over time, estimated savings, by agent.
import type { AgentCard, CaseView, CoordView, TokenStats } from './model.ts';
import { fmtClock, fmtK, fmtUsd } from './model.ts';
import { Avatar, Empty } from './ui.tsx';

export function TokensTab({ stats, agents, coord, cases, runStart }: { stats: TokenStats; agents: AgentCard[]; coord: CoordView; cases: CaseView[]; runStart: number }) {
  const cards = [
    { label: 'Total this run', v: fmtK(stats.total), sub: `${fmtUsd(stats.cost)} · ${fmtK(stats.cached)} cached reads not counted`, color: undefined },
    { label: 'Useful', v: fmtK(stats.useful), sub: 'kept work', color: 'var(--accent)' },
    { label: 'Wasted', v: fmtK(stats.wasted), sub: 'attempts thrown away or merge fixes', color: 'var(--warn)' },
    { label: 'Contract’s own', v: fmtK(stats.contract), sub: 'coordinator, only when a rule fires', color: 'var(--text2)' },
  ];
  return (
    <>
      <div className="stat-row">
        {cards.map((c) => (
          <div key={c.label} className="card" style={{ padding: '14px 18px' }}>
            <div className="muted" style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 7 }}>{c.color && <span style={{ width: 10, height: 10, borderRadius: 2, background: c.color }} />}{c.label}</div>
            <div className="stat-v">{c.v}</div>
            <div className="muted ellipsis" style={{ fontSize: 12 }}>{c.sub}</div>
          </div>
        ))}
      </div>

      <div className="tok-grid">
        <section className="card" style={{ padding: 16 }} aria-label="Tokens over time">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ fontSize: 16 }}>Tokens over time</h2>
            <div className="muted" style={{ display: 'flex', gap: 14, fontSize: 12 }}>
              {[['useful', 'var(--accent)'], ['wasted', 'var(--warn)'], ['Contract’s own', 'var(--text2)']].map(([l, c]) => (
                <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: c }} />{l}</span>
              ))}
            </div>
          </div>
          <Chart stats={stats} cases={cases} start={runStart} />
          <div className="muted" style={{ fontSize: 12, marginTop: 8, lineHeight: 1.4 }}>Tokens are logged when each Claude Code step finishes, so the line moves in steps, not token by token. Marking an attempt wasted recolors it after the fact. Counts are fresh prompt plus completion tokens; cache reads are listed separately.</div>
        </section>

        <section className="card" style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 9 }} aria-label="Tokens avoided">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ fontSize: 16 }}>Tokens avoided</h2>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--warn)', background: 'var(--warn-soft)', padding: '1px 8px', borderRadius: 'var(--radius)' }}>Estimated</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 30, fontWeight: 600, color: 'var(--ok)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>{fmtK(stats.savingsTotal)}</span>
            <span className="muted" style={{ fontSize: 13 }}>avoided so far</span>
          </div>
          {stats.savings.map((s) => (
            <div key={s.kind} style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 600 }}><span>{s.label}</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtK(s.tokens)}</span></div>
              <div className="bar" style={{ height: 5, margin: '5px 0' }}><span style={{ width: `${stats.savingsTotal ? (s.tokens / stats.savingsTotal) * 100 : 0}%`, background: 'var(--ok)' }} /></div>
              <div className="muted" style={{ fontSize: 12, lineHeight: 1.35 }}>{s.count} {s.count === 1 ? 'event' : 'events'} · {s.how}</div>
            </div>
          ))}
          <div className="muted" style={{ fontSize: 12, lineHeight: 1.4 }}>Estimates never feed the scoreboard’s headline number.</div>
        </section>
      </div>

      <section className="card" style={{ padding: '16px 20px' }} aria-label="By agent">
        <h2 style={{ fontSize: 16, marginBottom: 8 }}>By agent</h2>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Agent</th><th>Task</th><th className="num">Useful</th><th className="num">Wasted</th><th className="num">Total / budget</th><th style={{ width: 220 }}>Budget used</th></tr></thead>
            <tbody>
              {agents.map((a) => (
                <tr key={a.id}>
                  <td><span style={{ display: 'flex', alignItems: 'center', gap: 9, fontWeight: 600 }}><Avatar p={a.person} size={24} />{a.person.name}</span></td>
                  <td className="muted">{a.task}{a.attempt > 1 && ` · attempt ${a.attempt}`}</td>
                  <td className="num">{fmtK(a.useful)}</td>
                  <td className="num" style={{ color: 'var(--warn)' }}>{fmtK(a.wasted)}</td>
                  <td className="num">{fmtK(a.total)} / {a.budget ? fmtK(a.budget) : '—'}</td>
                  <td>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="bar grow"><span style={{ width: `${a.usePct}%`, background: a.person.color }} /><span className="waste-stripe" style={{ width: `${a.wastePct}%` }} /></span>
                      <span className="muted" style={{ fontSize: 12, width: 38, textAlign: 'right' }}>{a.budget ? Math.round((a.total / a.budget) * 100) + '%' : ''}</span>
                    </span>
                  </td>
                </tr>
              ))}
              <tr>
                <td><span style={{ display: 'flex', alignItems: 'center', gap: 9, fontWeight: 600 }}><Avatar p={{ id: 'coordinator', name: 'Coordinator', letter: 'C', color: '#9198a1' }} size={24} />Coordinator</span></td>
                <td className="muted">Contract’s own cost, only runs when a rule fires</td>
                <td className="num muted">n/a</td><td className="num muted">n/a</td>
                <td className="num">{fmtK(coord.tokens)}</td><td />
              </tr>
            </tbody>
          </table>
        </div>
        {!agents.length && <Empty>No agents in this run yet.</Empty>}
      </section>
    </>
  );
}

const CW = 632, CH = 250, PL = 44, PR = 8, PT = 26, PB = 22;

function Chart({ stats, cases, start }: { stats: TokenStats; cases: CaseView[]; start: number }) {
  const pts = stats.series;
  if (!pts.length) return <div style={{ height: CH, display: 'grid', placeItems: 'center' }}><Empty>No tokens logged in this run yet.</Empty></div>;
  const end = Math.max(start + 1000, pts[pts.length - 1].at);
  const top = Math.max(1, stats.total);
  const step = niceStep(top / 4);
  const ymax = Math.ceil(top / step) * step;
  const X = (t: number) => PL + ((t - start) / (end - start)) * (CW - PL - PR);
  const Y = (v: number) => CH - PB - (v / ymax) * (CH - PT - PB);
  const layer = (lo: (p: (typeof pts)[number]) => number, hi: (p: (typeof pts)[number]) => number) => {
    const upper: string[] = [`${X(start)},${Y(0)}`], lower: string[] = [];
    let prevHi = 0, prevLo = 0;
    for (const p of pts) {
      upper.push(`${X(p.at)},${Y(prevHi)}`, `${X(p.at)},${Y(hi(p))}`);
      // walked right to left on the way back: arrive at the new level, then drop to the old one
      lower.unshift(`${X(p.at)},${Y(lo(p))}`, `${X(p.at)},${Y(prevLo)}`);
      prevHi = hi(p); prevLo = lo(p);
    }
    upper.push(`${X(end)},${Y(prevHi)}`);
    lower.unshift(`${X(end)},${Y(prevLo)}`);
    return [...upper, ...lower, `${X(start)},${Y(0)}`].join(' ');
  };
  const grid = Array.from({ length: Math.round(ymax / step) + 1 }, (_, i) => i * step);
  const marks = cases.flatMap((c) => [{ at: c.openedAt, label: c.rule || 'Conflict', color: 'var(--danger)' }, ...(c.decidedAt ? [{ at: c.decidedAt, label: 'Decision', color: 'var(--ok)' }] : [])])
    .filter((m) => m.at >= start && m.at <= end);
  return (
    <svg viewBox={`0 0 ${CW} ${CH}`} width="100%" style={{ display: 'block', marginTop: 14 }} role="img" aria-label={`Cumulative tokens: ${fmtK(stats.useful)} useful, ${fmtK(stats.wasted)} wasted, ${fmtK(stats.contract)} Contract's own`}>
      {grid.map((g) => (
        <g key={g}><line x1={PL} x2={CW - PR} y1={Y(g)} y2={Y(g)} stroke="var(--border)" strokeWidth={1} /><text x={PL - 6} y={Y(g) + 4} fontSize={11} fill="var(--text2)" textAnchor="end">{fmtK(g)}</text></g>
      ))}
      <polygon points={layer(() => 0, (p) => p.useful)} fill="var(--accent)" opacity={0.92} />
      <polygon points={layer((p) => p.useful, (p) => p.useful + p.wasted)} fill="var(--warn)" opacity={0.92} />
      <polygon points={layer((p) => p.useful + p.wasted, (p) => p.useful + p.wasted + p.contract)} fill="var(--text2)" opacity={0.92} />
      {marks.map((m, i) => (
        <g key={i}><line x1={X(m.at)} x2={X(m.at)} y1={PT - 6} y2={CH - PB} stroke={m.color} strokeWidth={1.5} strokeDasharray="3 3" /><text x={X(m.at) + 4} y={16} fontSize={11} fontWeight={600} fill={m.color}>{m.label}</text></g>
      ))}
      <text x={PL} y={CH - 4} fontSize={11} fill="var(--text2)">00:00</text>
      <text x={CW - PR} y={CH - 4} fontSize={11} fill="var(--text2)" textAnchor="end">{fmtClock(end - start, false)}</text>
    </svg>
  );
}

function niceStep(x: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(1, x))));
  const f = x / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}
