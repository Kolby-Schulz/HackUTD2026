// scripts/run-demo.ts (spec sections 14, 15). Owner: dashboard + demo.
// npm run demo -- --mode without_contract|with_contract [--seed 7] [--runs 1]
//                 [--timeout-min 20] [--no-fix] [--scenario planted]
// --scenario picks a task pair from scripts/scenarios.ts (issue #28; `npm run bench` runs them all).
//
// One measured run:
//  1. (with_contract) map demo-repo so the code map is current
//  2. seed: open a run and create both tasks
//  3. run both workers at once, each in its own worktree and branch
//  4. merge agent/agent-a then agent/agent-b into a fresh demo/merge-<run> worktree
//  5. check: unit tests, integration test, check-dupes
//  6. if anything fails: mark both coding attempts wasted, then let each agent in turn try
//     to fix the merged code (purpose merge_fix, attempt 2) until the checks pass
//  7. end the run; write .contract/runs/<run>.json and print the averages per mode
// --runs N repeats reset + run N times (spec: average at least 3 runs per mode).
//
// The coordinator (npm run coordinator) must be running for with_contract, or a paused
// worker waits until --timeout-min.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { connect } from '@contract/client';
import { checkAll, conflictMarkers, merge, mergeFix, run, warnIfNoCoordinator, type Check, type TestCount } from './merge.ts';
import { demoRepoChanges, resetFiles, resetRuns } from './reset.ts';
import { seed } from './seed.ts';
import { scenarioOrDie } from './scenarios.ts';
import {
  adminConnect, AGENTS, git, log, MODES, REPO, resetServerState, RESULTS_DIR, savedToken, saveToken, TSX, TSX_CLI, WORKTREES, type Mode,
} from './lib.ts';

const { values } = parseArgs({
  options: {
    mode: { type: 'string' },
    seed: { type: 'string', default: '7' },
    runs: { type: 'string', default: '1' },
    'timeout-min': { type: 'string', default: '20' },
    'no-fix': { type: 'boolean', default: false },
    summary: { type: 'boolean', default: false },
    scenario: { type: 'string', default: 'planted' },
  },
});
const scenarioName = values.scenario!;
const scenario = scenarioOrDie(scenarioName);
if (process.env.CONTRACT_TARGET) {
  console.error('[demo] run-demo is the canned with/without experiment on demo-repo/; unset CONTRACT_TARGET, or use `npm run session` for your own repo');
  process.exit(1);
}

interface RunResult {
  runId: string;
  mode: Mode;
  /** scripts/scenarios.ts key; missing on runs from before issue #28 (= planted) */
  scenario?: string;
  seed: number;
  startedAt: string;
  workers: Record<string, { exitCode: number | null; timedOut: boolean }>;
  /** git textual conflicts inside demo-repo/ when merging the two branches */
  mergeConflictFiles: string[];
  /** first check after the merge, before any fix: the "conflicts at merge" evidence */
  atMerge: { checks: Check[]; tests: TestCount; dateFormatters: number };
  final: { checks: Check[]; tests: TestCount; dateFormatters: number; allPassing: boolean };
  mergeFixPasses: number;
  tokens: TokenTotals;
}
interface TokenTotals {
  prompt: number; completion: number; cacheRead: number; costUsd: number;
  wasted: number; mergeFix: number; coordination: number;
}

if (values.summary) {
  printSummary();
  process.exit(0);
}
const mode = values.mode as Mode;
if (!MODES.includes(mode)) die(`--mode must be one of ${MODES.join(', ')}`);
const runs = Number(values.runs);
const timeoutMs = Number(values['timeout-min']) * 60_000;

for (let i = 1; i <= runs; i++) {
  if (runs > 1) log('demo', `=== ${mode} run ${i}/${runs} ===`);
  if (i > 1 || hasLeftovers()) {
    // resetFiles() refuses to discard uncommitted edits; say which files instead of failing generically.
    const dirty = demoRepoChanges();
    if (dirty.length) {
      die(`demo-repo has uncommitted changes; commit or discard them first (npm run reset -- --force):\n${dirty.join('\n')}`);
    }
    if (i === 1) log('demo', 'leftovers from an earlier run; resetting first');
    resetFiles();
    await resetRuns();
  }
  await runOnce();
}
printSummary();
process.exit(0);

async function runOnce() {
  const startedAt = new Date().toISOString();

  // 1. Fresh code map. Clear the last run's server state first: the mapper only sends files
  //    that changed and keeps agent-reported signatures, so stale symbols would otherwise
  //    survive (and leftover instructions would reach the new agents).
  {
    const conn = await adminConnect(['SELECT * FROM run']);
    await resetServerState(conn);
    conn.disconnect();
    log('demo', 'cleared server state from the last run');
  }
  if (mode === 'with_contract') {
    const code = await run('mapper', TSX, [TSX_CLI, join(REPO, 'mapper/src/cli.ts')], REPO, 5 * 60_000);
    if (code.exitCode !== 0) die('mapper failed; is the server reachable?');
  }

  // 2. Seed.
  const admin = await adminConnect(['SELECT * FROM run', 'SELECT * FROM task', 'SELECT * FROM agent']);
  const s = await seed(admin, mode, Number(values.seed), scenarioName);
  log('demo', `run ${s.runId}: tasks ${AGENTS.map((a) => `${a.id}=${s.tasks[a.id]}`).join(', ')}`);
  if (mode === 'with_contract') warnIfNoCoordinator(admin);

  // Stable identities, so agent ids can be reused right after the previous run.
  for (const a of AGENTS) await ensureIdentity(a.id);

  // 3. Both workers in parallel. Create the worktrees first, one at a time, so two
  // `git worktree add` calls don't race on the repository's locks.
  mkdirSync(WORKTREES, { recursive: true });
  for (const a of AGENTS) {
    if (!existsSync(join(WORKTREES, a.id))) git(['worktree', 'add', '-B', `agent/${a.id}`, join(WORKTREES, a.id), 'HEAD']);
  }
  const workers: RunResult['workers'] = {};
  await Promise.all(
    AGENTS.map(async (a) => {
      const r = await run(
        a.id,
        TSX,
        [TSX_CLI, join(REPO, 'agents/worker/src/index.ts'), '--id', a.id, '--task', a.task, '--task-id', String(s.tasks[a.id]), '--mode', mode,
          '--task-text', a.id === 'agent-a' ? scenario.a.task : scenario.b.task],
        REPO,
        timeoutMs,
        { CONTRACT_TOKEN: savedToken(a.id) ?? '' },
      );
      workers[a.id] = r;
      if (r.exitCode !== 0) log('demo', `${a.id} exited with ${r.timedOut ? 'a timeout' : `code ${r.exitCode}`}; merging what it committed`);
    }),
  );

  // 4. Merge both branches into a fresh worktree.
  const mergeBranch = `demo/merge-${s.runId}`;
  const mergeDir = join(WORKTREES, `merge-${s.runId}`);
  git(['worktree', 'add', '-B', mergeBranch, mergeDir, 'HEAD']);
  const mergeConflictFiles: string[] = [];
  for (const a of AGENTS) mergeConflictFiles.push(...merge(mergeDir, `agent/${a.id}`));
  if (mergeConflictFiles.length) log('demo', `git conflicts in ${mergeConflictFiles.join(', ')} (left with markers for the fix pass)`);
  const demoDir = join(mergeDir, 'demo-repo');

  // 5. Checks.
  const atMerge = await checkAll(demoDir, scenario.checks);
  let final = atMerge;
  let mergeFixPasses = 0;

  // 6. Merge fix: each agent in turn, until green.
  const allOk = (c: typeof atMerge) => c.checks.every((x) => x.ok) && mergeConflictFiles.length === 0;
  if (!allOk(atMerge) && !values['no-fix']) {
    for (const a of AGENTS) await admin.reducers.markAttemptWasted({ taskId: s.tasks[a.id]!, attempt: 1 });
    log('demo', 'merged code fails its checks; coding attempts marked wasted');
    for (const a of AGENTS) {
      if (mergeFixPasses > 0 && final.checks.every((x) => x.ok)) break;
      mergeFixPasses++;
      await mergeFix(a.id, s.tasks[a.id]!, demoDir, final.checks, mergeConflictFiles);
      mergeConflictFiles.splice(0, mergeConflictFiles.length, ...conflictMarkers(mergeDir));
      final = await checkAll(demoDir, scenario.checks);
    }
  }
  git(['add', '-A'], mergeDir);
  git(['commit', '-m', `merge run ${s.runId} (${mode})`, '--allow-empty', '--no-verify'], mergeDir);

  // 7. Close the run and record results.
  await admin.reducers.endRun({ runId: s.runId });
  const tokens = await tokenTotals(s.runId);
  admin.disconnect();

  const result: RunResult = {
    runId: String(s.runId),
    mode,
    scenario: scenarioName,
    seed: Number(values.seed),
    startedAt,
    workers,
    mergeConflictFiles,
    atMerge: { ...atMerge },
    final: { ...final, allPassing: allOk(final) },
    mergeFixPasses,
    tokens,
  };
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(join(RESULTS_DIR, `${s.runId}.json`), JSON.stringify(result, null, 2) + '\n');
  log('demo', `run ${s.runId} done: tests ${final.tests.passed} passed / ${final.tests.failed} failed, ` +
    `${final.dateFormatters} date formatter(s), ${tokens.prompt + tokens.completion} tokens, $${tokens.costUsd.toFixed(3)} ` +
    `(merge result on branch ${mergeBranch})`);
}

// ---------------------------------------------------------------------------------

async function ensureIdentity(agentId: string) {
  if (savedToken(agentId)) return;
  const c = await connect({
    host: process.env.SPACETIME_HOST!,
    dbName: process.env.SPACETIME_DB_NAME!,
    noHeartbeat: false,
    agent: { id: agentId, name: agentId, ownerDev: process.env.USER ?? 'dev', machine: process.env.HOSTNAME ?? 'laptop', model: 'claude-code', tokenBudget: 200_000 },
  });
  saveToken(agentId, c.token);
  await c.disconnect();
}

async function tokenTotals(runId: bigint): Promise<TokenTotals> {
  const conn = await adminConnect([`SELECT * FROM token_usage WHERE run_id = ${runId}`]);
  const t: TokenTotals = { prompt: 0, completion: 0, cacheRead: 0, costUsd: 0, wasted: 0, mergeFix: 0, coordination: 0 };
  for (const r of conn.db.tokenUsage.iter()) {
    const n = r.promptTokens + r.completionTokens;
    t.prompt += r.promptTokens;
    t.completion += r.completionTokens;
    t.cacheRead += r.cacheReadTokens;
    t.costUsd += r.costUsd;
    if (r.wasted) t.wasted += n;
    if (r.purpose === 'merge_fix') t.mergeFix += n;
    if (r.purpose === 'coordination') t.coordination += n;
  }
  conn.disconnect();
  return t;
}

function hasLeftovers(): boolean {
  return git(['for-each-ref', '--format=%(refname)', 'refs/heads/agent', 'refs/heads/demo']) !== '' ||
    demoRepoChanges() !== '';
}

function printSummary() {
  if (!existsSync(RESULTS_DIR)) return log('demo', 'no results yet');
  const all = readdirSync(RESULTS_DIR).filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(RESULTS_DIR, f), 'utf8')) as RunResult);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const rows = MODES.map((m) => {
    const rs = all.filter((r) => r.mode === m);
    return {
      mode: m,
      runs: rs.length,
      'total tokens': Math.round(avg(rs.map((r) => r.tokens.prompt + r.tokens.completion))),
      'fresh tokens': Math.round(avg(rs.map((r) => r.tokens.prompt - r.tokens.cacheRead + r.tokens.completion))),
      'cost $': Number(avg(rs.map((r) => r.tokens.costUsd)).toFixed(3)),
      'wasted tokens': Math.round(avg(rs.map((r) => r.tokens.wasted))),
      'merge-fix tokens': Math.round(avg(rs.map((r) => r.tokens.mergeFix))),
      'coordinator tokens': Math.round(avg(rs.map((r) => r.tokens.coordination))),
      'failing checks at merge': Number(avg(rs.map((r) => r.atMerge.checks.filter((c) => !c.ok).length + (r.mergeConflictFiles.length ? 1 : 0))).toFixed(1)),
      'date formatters at merge': Number(avg(rs.map((r) => r.atMerge.dateFormatters)).toFixed(1)),
      'all passing (final)': `${rs.filter((r) => r.final.allPassing).length}/${rs.length}`,
    };
  });
  console.table(rows);
}

function die(msg: string): never {
  console.error(`[demo] ${msg}`);
  process.exit(1);
}
