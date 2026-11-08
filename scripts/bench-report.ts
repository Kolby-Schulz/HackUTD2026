// Benchmark report (issue #28): averages run-demo results per scenario and mode. Pure, so
// it's unit-tested; scripts/bench.ts reads .contract/runs/*.json and writes the outputs.
import { SCENARIOS } from './scenarios.ts';

/** The parts of a run-demo result (.contract/runs/<run>.json) the report reads. */
export interface BenchRun {
  runId: string;
  mode: 'with_contract' | 'without_contract';
  scenario?: string;
  mergeConflictFiles: string[];
  atMerge: { checks: { ok: boolean }[]; tests: { passed: number; failed: number }; dateFormatters: number };
  final: { allPassing: boolean; tests: { passed: number; failed: number } };
  tokens: { prompt: number; completion: number; cacheRead: number; costUsd: number; wasted: number; mergeFix: number; coordination: number };
}

export interface ModeStats {
  runs: number;
  tokens: number; // prompt + completion, average
  fresh: number; // minus cache reads
  cost: number;
  wasted: number;
  mergeFix: number;
  coordination: number;
  brokenAtMerge: number; // runs whose merge failed a check or had git conflicts
  passingFinal: number; // runs green after the fix pass
}

export interface ScenarioRow {
  scenario: string;
  title: string;
  without?: ModeStats;
  with?: ModeStats;
  /** 1 - with/without on average cost, when both exist */
  costSaving?: number;
  tokenSaving?: number;
}

export interface BenchReport {
  generatedAt: string;
  rows: ScenarioRow[];
  overall: { runs: number; costSaving?: number; tokenSaving?: number; brokenWithout: number; brokenWith: number; runsWithout: number; runsWith: number };
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const broken = (r: BenchRun) => r.atMerge.checks.some((c) => !c.ok) || r.mergeConflictFiles.length > 0;

function stats(rs: BenchRun[]): ModeStats | undefined {
  if (!rs.length) return undefined;
  return {
    runs: rs.length,
    tokens: Math.round(avg(rs.map((r) => r.tokens.prompt + r.tokens.completion))),
    fresh: Math.round(avg(rs.map((r) => r.tokens.prompt - r.tokens.cacheRead + r.tokens.completion))),
    cost: avg(rs.map((r) => r.tokens.costUsd)),
    wasted: Math.round(avg(rs.map((r) => r.tokens.wasted))),
    mergeFix: Math.round(avg(rs.map((r) => r.tokens.mergeFix))),
    coordination: Math.round(avg(rs.map((r) => r.tokens.coordination))),
    brokenAtMerge: rs.filter(broken).length,
    passingFinal: rs.filter((r) => r.final.allPassing).length,
  };
}

const saving = (w?: number, wo?: number) => (w !== undefined && wo ? 1 - w / wo : undefined);

export function benchReport(results: BenchRun[], now = new Date()): BenchReport {
  const by = (s: string, m: BenchRun['mode']) => results.filter((r) => (r.scenario ?? 'planted') === s && r.mode === m);
  const names = [...new Set([...Object.keys(SCENARIOS), ...results.map((r) => r.scenario ?? 'planted')])];
  const rows = names
    .map((s): ScenarioRow => {
      const without = stats(by(s, 'without_contract'));
      const withC = stats(by(s, 'with_contract'));
      return { scenario: s, title: SCENARIOS[s]?.title ?? s, without, with: withC, costSaving: saving(withC?.cost, without?.cost), tokenSaving: saving(withC?.tokens, without?.tokens) };
    })
    .filter((r) => r.without || r.with);
  const both = rows.filter((r) => r.with && r.without);
  const wo = results.filter((r) => r.mode === 'without_contract');
  const wi = results.filter((r) => r.mode === 'with_contract');
  return {
    generatedAt: now.toISOString(),
    rows,
    overall: {
      runs: results.length,
      // Average of per-scenario savings, so a long scenario doesn't dominate.
      costSaving: both.length ? avg(both.map((r) => r.costSaving!)) : undefined,
      tokenSaving: both.length ? avg(both.map((r) => r.tokenSaving!)) : undefined,
      brokenWithout: wo.filter(broken).length,
      brokenWith: wi.filter(broken).length,
      runsWithout: wo.length,
      runsWith: wi.length,
    },
  };
}

const pct = (x?: number) => (x === undefined ? '–' : `${Math.round(x * 100)}%`);
const k = (n?: number) => (n === undefined ? '–' : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const usd = (n?: number) => (n === undefined ? '–' : `$${n.toFixed(2)}`);

/** Markdown table for the README / docs. */
export function benchMarkdown(r: BenchReport): string {
  const o = r.overall;
  const head = o.costSaving === undefined
    ? `${o.runs} run(s) so far; run both modes of a scenario to compare.`
    : `Across ${r.rows.filter((x) => x.with && x.without).length} scenario(s) and ${o.runs} runs, Contract saved **${pct(o.costSaving)}** of the cost ` +
      `(${pct(o.tokenSaving)} of tokens) and left ${o.brokenWith}/${o.runsWith} merges broken vs ${o.brokenWithout}/${o.runsWithout} without it.`;
  const lines = [
    head,
    '',
    '| Scenario | Runs (without / with) | Cost without | Cost with | Saved | Tokens without | Tokens with | Wasted without | Broken merges without | Broken merges with |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...r.rows.map((x) =>
      `| ${x.title} | ${x.without?.runs ?? 0} / ${x.with?.runs ?? 0} | ${usd(x.without?.cost)} | ${usd(x.with?.cost)} | ${pct(x.costSaving)} | ${k(x.without?.tokens)} | ${k(x.with?.tokens)} | ${k(x.without?.wasted)} | ${x.without ? `${x.without.brokenAtMerge}/${x.without.runs}` : '–'} | ${x.with ? `${x.with.brokenAtMerge}/${x.with.runs}` : '–'} |`),
    '',
    `_Generated ${r.generatedAt} by \`npm run bench\`. Averages per run; tokens include cache reads (cost is what was billed)._`,
  ];
  return lines.join('\n');
}
