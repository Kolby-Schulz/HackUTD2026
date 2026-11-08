// Scoreboard tab (storyboard F5; spec section 15 "The proof"). Headline numbers come only
// from measured run totals, averaged per mode; nothing estimated feeds them.
import type { ModeSummary } from './model.ts';
import { fmtK, fmtUsd } from './model.ts';
import { BenchTable } from './BenchTable.tsx';

const NOT_RECORDED = 'not recorded';

export function ScoreboardTab({ without, withC }: { without?: ModeSummary; withC?: ModeSummary }) {
  const final = !!without && !!withC && !without.running && !withC.running;
  const pct = final && without!.total > 0 ? Math.round((1 - withC!.total / without!.total) * 100) : undefined;
  const costPct = final && without!.cost > 0 ? Math.round((1 - withC!.cost / without!.cost) * 100) : undefined;
  const wastedCut = final && without!.wasted > 0 ? Math.round((1 - withC!.wasted / without!.wasted) * 100) : undefined;
  const few = final && (without!.runs < 3 || withC!.runs < 3);

  const sub = (m?: ModeSummary) => !m ? 'no run yet' : m.running ? 'running now (unfinished)' : `average of ${m.runs} run${m.runs === 1 ? '' : 's'}`;
  const tok = (m: ModeSummary | undefined, k: keyof ModeSummary) => (m ? fmtK(m[k] as number) : '—');
  const one = (m: ModeSummary | undefined, k: keyof ModeSummary) => (m ? (Math.round((m[k] as number) * 10) / 10).toString() : '—');
  const lower = (a?: number, b?: number) => (a !== undefined && b !== undefined && final ? a < b : false);
  const rows: { label: string; wo: string; wi: string; win: boolean; pending?: boolean }[] = [
    { label: 'Total tokens', wo: tok(without, 'total'), wi: tok(withC, 'total'), win: lower(withC?.total, without?.total) },
    { label: 'Wasted tokens', wo: tok(without, 'wasted'), wi: tok(withC, 'wasted'), win: lower(withC?.wasted, without?.wasted) },
    { label: 'Merge-fix tokens', wo: tok(without, 'mergeFix'), wi: tok(withC, 'mergeFix'), win: lower(withC?.mergeFix, without?.mergeFix) },
    { label: 'Coordinator tokens (Contract’s own)', wo: tok(without, 'coordination'), wi: tok(withC, 'coordination'), win: false },
    { label: 'Cost', wo: without ? fmtUsd(without.cost) : '—', wi: withC ? fmtUsd(withC.cost) : '—', win: lower(withC?.cost, without?.cost) },
    { label: 'Conflicts caught while coding', wo: one(without, 'conflictsCaught'), wi: one(withC, 'conflictsCaught'), win: false },
    { label: 'Agents that needed a merge fix', wo: one(without, 'mergeFixAgents'), wi: one(withC, 'mergeFixAgents'), win: lower(withC?.mergeFixAgents, without?.mergeFixAgents) },
    { label: 'Duplicate helpers at merge', wo: NOT_RECORDED, wi: NOT_RECORDED, win: false, pending: true },
    { label: 'Tests passing after merge', wo: NOT_RECORDED, wi: NOT_RECORDED, win: false, pending: true },
  ];
  const bars = [
    { label: 'Total tokens', wo: without?.total ?? 0, wi: withC?.total ?? 0 },
    { label: 'Wasted tokens', wo: without?.wasted ?? 0, wi: withC?.wasted ?? 0 },
  ];

  return (
    <>
      <section className="card score-head" aria-label="Result">
        <div>
          <div className="cap muted" style={{ fontSize: 13, marginBottom: 6 }}>Result</div>
          {pct !== undefined ? (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 56, fontWeight: 600, letterSpacing: '-0.02em', color: pct >= 0 ? 'var(--accent)' : 'var(--danger)', lineHeight: 1 }}>{Math.abs(pct)}%</span>
              <span style={{ fontSize: 22, fontWeight: 600 }}>{pct >= 0 ? 'fewer' : 'more'} tokens with Contract</span>
            </div>
          ) : (
            <div style={{ fontSize: 32, fontWeight: 600, lineHeight: 1.2 }}>{!without && !withC ? 'No runs yet' : !final ? 'Waiting for both modes to finish' : 'Not enough data'}</div>
          )}
          <div className="muted" style={{ fontSize: 14, marginTop: 6 }}>
            {final ? `without: ${sub(without)} · with: ${sub(withC)}` : 'Run npm run demo -- --mode without_contract, then npm run reset and --mode with_contract.'}
            {costPct !== undefined && ` · cost ${costPct >= 0 ? '−' : '+'}${Math.abs(costPct)}%`}
            {wastedCut !== undefined && ` · wasted ${wastedCut >= 0 ? '−' : '+'}${Math.abs(wastedCut)}%`}
          </div>
        </div>
        <div className="muted" style={{ maxWidth: 380, fontSize: 13, lineHeight: 1.5, borderLeft: '1px solid var(--border)', paddingLeft: 24 }}>
          {final ? `Headline numbers are the measured totals of each mode's finished runs, averaged.${few ? ' The spec asks for at least three runs per mode before judging.' : ''}` :
            'Each column fills in when a run of that mode exists. Unfinished runs show their running total and do not count toward the headline.'}
        </div>
      </section>

      <section className="card" style={{ padding: '20px 28px' }} aria-label="Without vs with Contract">
        <div className="score-grid" style={{ fontSize: 13, fontWeight: 600, paddingTop: 0 }}>
          <span className="muted">Measured</span>
          <span style={{ textAlign: 'right' }}>Without Contract<span className="muted" style={{ display: 'block', fontWeight: 400, fontSize: 12 }}>{sub(without)}</span></span>
          <span style={{ textAlign: 'right', color: 'var(--accent)' }}>With Contract<span className="muted" style={{ display: 'block', fontWeight: 400, fontSize: 12 }}>{sub(withC)}</span></span>
        </div>
        {bars.map((b) => {
          const max = Math.max(1, b.wo, b.wi);
          return (
            <div key={b.label} style={{ display: 'grid', gridTemplateColumns: '150px minmax(0,1fr)', gap: 20, alignItems: 'center', padding: '14px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{b.label}</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <BarRow pct={(b.wo / max) * 100} v={fmtK(b.wo)} color="var(--text2)" label="without" />
                <BarRow pct={(b.wi / max) * 100} v={fmtK(b.wi)} color="var(--accent)" label="with" />
              </div>
            </div>
          );
        })}
        {rows.map((r) => (
          <div key={r.label} className="score-grid">
            <span>{r.label}</span>
            <span className="mono" style={{ textAlign: 'right', color: r.pending ? 'var(--text2)' : undefined }}>{r.wo}</span>
            <span className="mono" style={{ textAlign: 'right', fontWeight: 600, color: r.pending ? 'var(--text2)' : r.win ? 'var(--ok)' : 'var(--text)' }}>{r.wi}</span>
          </div>
        ))}
        <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>Duplicate helpers and tests passing come from run-demo’s check-dupes and test pass after merge; the tables don’t record them yet.</div>
      </section>

      <BenchTable />

      <section className="card notes3" aria-label="How to read this">
        <div><div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>What counts</div><div className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>Only finished, measured runs. Each mode should be run at least three times and averaged, because model output varies.</div></div>
        <div><div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>What is estimated</div><div className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>Per-feature savings on the Tokens tab are labeled estimates and never feed the headline number.</div></div>
        <div><div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Contract’s own cost</div><div className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>Coordinator tokens are shown separately and are included in the with-Contract total.</div></div>
      </section>
    </>
  );
}

function BarRow({ pct, v, color, label }: { pct: number; v: string; color: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }} aria-label={`${label}: ${v}`}>
      <span className="bar grow" style={{ height: 12, borderRadius: 3 }}><span style={{ width: `${pct}%`, background: color, opacity: color === 'var(--text2)' ? 0.6 : 1 }} /></span>
      <span className="mono" style={{ width: 60, fontSize: 12, textAlign: 'right', color: color === 'var(--accent)' ? 'var(--accent)' : undefined }}>{v}</span>
    </div>
  );
}
