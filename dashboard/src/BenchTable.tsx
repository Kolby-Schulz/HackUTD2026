// Benchmark table on the Scoreboard (issue #28): reads /bench.json, which `npm run bench`
// writes into dashboard/public/. Shows nothing until a benchmark has run.
import { useEffect, useState } from 'react';
import { fmtK, fmtUsd } from './model.ts';

interface Stats { runs: number; tokens: number; cost: number; wasted: number; brokenAtMerge: number }
interface Row { scenario: string; title: string; without?: Stats; with?: Stats; costSaving?: number }
interface Report { generatedAt: string; rows: Row[]; overall: { runs: number; costSaving?: number; tokenSaving?: number; brokenWith: number; brokenWithout: number; runsWith: number; runsWithout: number } }

const pct = (x?: number) => (x === undefined ? '—' : `${Math.round(x * 100)}%`);

export function BenchTable() {
  const [report, setReport] = useState<Report>();
  useEffect(() => {
    fetch('/bench.json').then((r) => (r.ok ? r.json() : undefined)).then(setReport).catch(() => undefined);
  }, []);
  if (!report?.rows.length) return null;
  const o = report.overall;
  return (
    <section className="card" style={{ padding: '18px 20px' }} aria-label="Benchmark">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 18 }}>Benchmark: {report.rows.length} scenario{report.rows.length === 1 ? '' : 's'}</h2>
        <span className="muted" style={{ fontSize: 12 }}>{o.runs} runs · {new Date(report.generatedAt).toLocaleString()} · npm run bench</span>
      </div>
      {o.costSaving !== undefined && (
        <div style={{ fontSize: 15, margin: '6px 0 12px' }}>
          Contract saved <b style={{ color: 'var(--ok)' }}>{pct(o.costSaving)}</b> of the cost ({pct(o.tokenSaving)} of tokens);
          broken merges <b>{o.brokenWith}/{o.runsWith}</b> with vs <b>{o.brokenWithout}/{o.runsWithout}</b> without.
        </div>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table className="bench">
          <thead><tr><th>Scenario</th><th>Runs</th><th>Cost without</th><th>Cost with</th><th>Saved</th><th>Tokens without</th><th>Tokens with</th><th>Broken merges</th></tr></thead>
          <tbody>
            {report.rows.map((r) => (
              <tr key={r.scenario}>
                <td>{r.title}</td>
                <td className="mono">{r.without?.runs ?? 0} / {r.with?.runs ?? 0}</td>
                <td className="mono">{r.without ? fmtUsd(r.without.cost) : '—'}</td>
                <td className="mono">{r.with ? fmtUsd(r.with.cost) : '—'}</td>
                <td className="mono" style={{ color: (r.costSaving ?? 0) > 0 ? 'var(--ok)' : undefined }}>{pct(r.costSaving)}</td>
                <td className="mono">{r.without ? fmtK(r.without.tokens) : '—'}</td>
                <td className="mono">{r.with ? fmtK(r.with.tokens) : '—'}</td>
                <td className="mono">{r.without ? `${r.without.brokenAtMerge}/${r.without.runs}` : '—'} → {r.with ? `${r.with.brokenAtMerge}/${r.with.runs}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
