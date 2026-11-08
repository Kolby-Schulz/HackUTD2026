// scripts/bench.ts (issue #28): the benchmark behind the token-savings claim.
//   npm run bench -- [--scenarios all|planted,control,…] [--modes without_contract,with_contract]
//                    [--runs 1] [--report-only] [--since-run <id>]
// --since-run limits the report to runs with id >= <id> (e.g. to drop runs from older code).
// For each scenario and mode it runs `run-demo --scenario <s> --mode <m> --runs N` (both
// agents, merge, checks, merge-fix pass), then writes a report from every recorded run:
//   .contract/bench/report.json + report.md, dashboard/public/bench.json (Scoreboard tab)
//   and the table between the bench markers in README.md.
// with_contract runs need `npm run coordinator` running. Each run costs real tokens.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { benchMarkdown, benchReport, type BenchRun } from './bench-report.ts';
import { run } from './merge.ts';
import { scenarioOrDie, SCENARIO_NAMES } from './scenarios.ts';
import { log, MODES, REPO, RESULTS_DIR, STATE_DIR, TSX, TSX_CLI, type Mode } from './lib.ts';

const { values } = parseArgs({
  options: {
    scenarios: { type: 'string', default: 'all' },
    modes: { type: 'string', default: MODES.slice().reverse().join(',') }, // without first
    runs: { type: 'string', default: '1' },
    'report-only': { type: 'boolean', default: false },
    'timeout-min': { type: 'string', default: '20' },
    'since-run': { type: 'string' },
  },
});
const scenarios = values.scenarios === 'all' ? SCENARIO_NAMES : values.scenarios!.split(',').map((s) => s.trim());
for (const s of scenarios) scenarioOrDie(s);
const modes = values.modes!.split(',').map((m) => m.trim()) as Mode[];
for (const m of modes) if (!MODES.includes(m)) throw new Error(`unknown mode ${m}`);

if (!values['report-only']) {
  for (const s of scenarios) {
    for (const m of modes) {
      log('bench', `=== ${s} · ${m} · ${values.runs} run(s) ===`);
      const r = await run('demo', TSX, [TSX_CLI, join(REPO, 'scripts/run-demo.ts'), '--scenario', s, '--mode', m, '--runs', values.runs!, '--timeout-min', values['timeout-min']!], REPO, 6 * 3600_000);
      if (r.exitCode !== 0) log('bench', `run-demo exited ${r.exitCode} for ${s} · ${m}; continuing`);
    }
  }
}

const results = existsSync(RESULTS_DIR)
  ? readdirSync(RESULTS_DIR).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(RESULTS_DIR, f), 'utf8')) as BenchRun)
      .filter((r) => !values['since-run'] || Number(r.runId) >= Number(values['since-run']))
  : [];
const report = benchReport(results);
const md = benchMarkdown(report);
const dir = join(STATE_DIR, 'bench');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
writeFileSync(join(dir, 'report.md'), md + '\n');
writeFileSync(join(REPO, 'dashboard/public/bench.json'), JSON.stringify(report, null, 2) + '\n');
const readme = join(REPO, 'README.md');
const BEGIN = '<!-- bench:begin -->';
const END = '<!-- bench:end -->';
const text = readFileSync(readme, 'utf8');
if (text.includes(BEGIN) && text.includes(END)) {
  writeFileSync(readme, text.slice(0, text.indexOf(BEGIN) + BEGIN.length) + '\n' + md + '\n' + text.slice(text.indexOf(END)));
}
console.log('\n' + md + '\n');
log('bench', `report: .contract/bench/report.md, dashboard/public/bench.json${text.includes(BEGIN) ? ', README.md' : ''}`);
process.exit(0);
