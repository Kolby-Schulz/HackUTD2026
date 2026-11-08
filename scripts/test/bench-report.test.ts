// Benchmark report aggregation (issue #28).
import { describe, it, expect } from 'vitest';
import { benchMarkdown, benchReport, type BenchRun } from '../bench-report.ts';
import { SCENARIOS } from '../scenarios.ts';

const runOf = (scenario: string | undefined, mode: BenchRun['mode'], cost: number, tokens: number, broken: boolean): BenchRun => ({
  runId: String(Math.random()), mode, ...(scenario ? { scenario } : {}),
  mergeConflictFiles: [],
  atMerge: { checks: [{ ok: !broken }], tests: { passed: 1, failed: broken ? 1 : 0 }, dateFormatters: 1 },
  final: { allPassing: true, tests: { passed: 2, failed: 0 } },
  tokens: { prompt: tokens, completion: 0, cacheRead: 0, costUsd: cost, wasted: broken ? tokens / 2 : 0, mergeFix: 0, coordination: 0 },
});

describe('benchReport', () => {
  it('averages per scenario and mode; old runs without a scenario count as planted', () => {
    const r = benchReport([
      runOf(undefined, 'without_contract', 1.0, 100_000, true),
      runOf('planted', 'without_contract', 0.6, 60_000, true),
      runOf('planted', 'with_contract', 0.4, 40_000, false),
      runOf('control', 'with_contract', 0.3, 30_000, false),
    ]);
    const planted = r.rows.find((x) => x.scenario === 'planted')!;
    expect(planted.without).toMatchObject({ runs: 2, tokens: 80_000, brokenAtMerge: 2 });
    expect(planted.without!.cost).toBeCloseTo(0.8);
    expect(planted.costSaving).toBeCloseTo(0.5);
    expect(r.rows.find((x) => x.scenario === 'control')).toMatchObject({ without: undefined, costSaving: undefined });
    expect(r.overall).toMatchObject({ runs: 4, brokenWithout: 2, runsWithout: 2, brokenWith: 0, runsWith: 2 });
    expect(r.overall.costSaving).toBeCloseTo(0.5); // only scenarios with both modes
    expect(r.rows.map((x) => x.scenario)).not.toContain('duplicate-helper'); // never run
  });
  it('renders a README table with the headline', () => {
    const md = benchMarkdown(benchReport([runOf('planted', 'without_contract', 1, 100_000, true), runOf('planted', 'with_contract', 0.25, 30_000, false)]));
    expect(md).toMatch(/InSync saved \*\*75%\*\* of the cost \(70% of tokens\) and left 0\/1 merges broken vs 1\/1 without it/);
    expect(md).toContain(`| ${SCENARIOS.planted.title} | 1 / 1 | $1.00 | $0.25 | 75% |`);
  });
  it('has five scenarios, each with two tasks and checks', () => {
    expect(Object.keys(SCENARIOS)).toEqual(['planted', 'duplicate-helper', 'claim-contention', 'signature-change', 'control']);
    for (const s of Object.values(SCENARIOS)) expect(s.a.task && s.b.task && s.checks.length).toBeTruthy();
  });
});
