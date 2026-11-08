// scripts/run-demo.ts (spec sections 14, 15). Owner: dashboard + demo.
// npm run demo -- --mode without_contract|with_contract [--seed 7] [--runs 1]
//                 [--timeout-min 20] [--no-fix]
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
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { connect, type DbConnection } from '@contract/client';
import { createLLM } from '@contract/llm';
import { demoRepoChanges, resetFiles, resetRuns } from './reset.ts';
import { seed } from './seed.ts';
import {
  adminConnect, AGENTS, git, log, MODES, REPO, resetServerState, RESULTS_DIR, savedToken, saveToken, TSX, WORKTREES, type Mode,
} from './lib.ts';

const { values } = parseArgs({
  options: {
    mode: { type: 'string' },
    seed: { type: 'string', default: '7' },
    runs: { type: 'string', default: '1' },
    'timeout-min': { type: 'string', default: '20' },
    'no-fix': { type: 'boolean', default: false },
    summary: { type: 'boolean', default: false },
  },
});

interface Check { name: string; ok: boolean; output: string }
interface RunResult {
  runId: string;
  mode: Mode;
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
interface TestCount { passed: number; failed: number }
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
    const code = await run('mapper', TSX, [join(REPO, 'mapper/src/cli.ts')], REPO, 5 * 60_000);
    if (code.exitCode !== 0) die('mapper failed; is the server reachable?');
  }

  // 2. Seed.
  const admin = await adminConnect(['SELECT * FROM run', 'SELECT * FROM task', 'SELECT * FROM agent']);
  const s = await seed(admin, mode, Number(values.seed));
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
        [join(REPO, 'agents/worker/src/index.ts'), '--id', a.id, '--task', a.task, '--task-id', String(s.tasks[a.id]), '--mode', mode],
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
  const atMerge = await checkAll(demoDir);
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
      final = await checkAll(demoDir);
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

/** Merges `branch` into the worktree. Returns conflicted demo-repo/ files (left unresolved). */
function merge(dir: string, branch: string): string[] {
  try {
    git(['merge', '--no-edit', '--no-ff', '-m', `merge ${branch}`, branch], dir);
    return [];
  } catch {
    const conflicted = git(['diff', '--name-only', '--diff-filter=U'], dir).split('\n').filter(Boolean);
    // Files outside demo-repo/ (e.g. each worker's .contract-mcp.json) are run plumbing,
    // not code: take ours and move on.
    for (const f of conflicted.filter((f) => !f.startsWith('demo-repo/'))) {
      git(['checkout', '--ours', '--', f], dir);
      git(['add', '--', f], dir);
    }
    git(['add', '-A'], dir); // commit with markers in place; the fix pass resolves them
    git(['commit', '--no-edit', '--no-verify'], dir);
    return conflicted.filter((f) => f.startsWith('demo-repo/'));
  }
}

function conflictMarkers(dir: string): string[] {
  try {
    return git(['grep', '-l', '-E', '^(<<<<<<<|>>>>>>>) ', '--', 'demo-repo'], dir).split('\n').filter(Boolean);
  } catch {
    return []; // git grep exits 1 when nothing matches
  }
}

async function checkAll(demoDir: string) {
  const npm = (script: string) => run(`check:${script}`, 'npm', ['run', '--silent', script], demoDir, 5 * 60_000, {}, true);
  const unit = await npm('test');
  const integration = await npm('test:integration');
  const dupes = await npm('check:dupes');
  const checks: Check[] = [
    { name: 'unit tests', ok: unit.exitCode === 0, output: unit.output },
    { name: 'integration test', ok: integration.exitCode === 0, output: integration.output },
    { name: 'check-dupes', ok: dupes.exitCode === 0, output: dupes.output },
  ];
  const tests = [unit, integration].map((r) => countTests(r.output)).reduce((x, y) => ({ passed: x.passed + y.passed, failed: x.failed + y.failed }));
  const fm = /(\d+) date formatter/.exec(dupes.output);
  for (const c of checks) log('check', `${c.ok ? 'PASS' : 'FAIL'} ${c.name}`);
  return { checks, tests, dateFormatters: fm ? Number(fm[1]) : 0 };
}

function countTests(out: string): TestCount {
  const line = /Tests\s+(.*)/.exec(out.replace(/\x1b\[[0-9;]*m/g, ''))?.[1] ?? '';
  return { passed: Number(/(\d+) passed/.exec(line)?.[1] ?? 0), failed: Number(/(\d+) failed/.exec(line)?.[1] ?? 0) };
}

async function mergeFix(agentId: string, taskId: bigint, demoDir: string, checks: Check[], conflicts: string[]) {
  log('demo', `merge fix by ${agentId}`);
  const failing = checks.filter((c) => !c.ok);
  const prompt = [
    'Two features were developed in parallel and merged into this repository. The merged code fails these checks.',
    conflicts.length ? `These files still contain git conflict markers: ${conflicts.join(', ')}.` : '',
    ...failing.map((c) => `--- ${c.name} ---\n${c.output.slice(-3000)}`),
    'Fix the source so `npm test`, `npm run test:integration` and `npm run check:dupes` all pass, keeping both features.',
    'Do not edit tests/ or scripts/.',
  ].filter(Boolean).join('\n\n');

  const client = await connect({
    host: process.env.SPACETIME_HOST!,
    dbName: process.env.SPACETIME_DB_NAME!,
    token: savedToken(agentId),
    repoDir: demoDir,
    agent: { id: agentId, name: agentId, ownerDev: process.env.USER ?? 'dev', machine: process.env.HOSTNAME ?? 'laptop', model: 'claude-code', tokenBudget: 200_000 },
  });
  try {
    const r = await createLLM().runWorker(prompt, {
      cwd: demoDir,
      purpose: 'merge_fix',
      allowedTools: ['Bash(npm test:*)', 'Bash(npm run:*)', 'Bash(npx vitest:*)'],
      onUsage: (u, purpose) =>
        client.logTokens(taskId, 2, purpose, u).catch((e: unknown) => log(agentId, `logTokens failed: ${String(e)}`)),
    });
    log(agentId, `merge fix done (${r.usage.prompt_tokens}+${r.usage.completion_tokens} tokens, $${r.usage.cost_usd.toFixed(4)})`);
  } catch (e) {
    log(agentId, `merge fix failed: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    await client.disconnect();
  }
}

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

function warnIfNoCoordinator(conn: DbConnection) {
  const c = [...conn.db.agent.iter()].find((a) => a.id === 'coordinator');
  const ageMs = c ? Date.now() - Number(c.lastHeartbeat.microsSinceUnixEpoch / 1000n) : Infinity;
  if (ageMs > 60_000) log('demo', 'WARNING: no live coordinator; start `npm run coordinator` or paused workers will wait until the timeout');
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

/** Runs a command, prefixing its output with [scope]. Kills it after timeoutMs. */
function run(scope: string, cmd: string, args: string[], cwd: string, timeoutMs: number, env: Record<string, string> = {}, quiet = false) {
  return new Promise<{ exitCode: number | null; timedOut: boolean; output: string }>((res) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env, FORCE_COLOR: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let timedOut = false;
    const onData = (buf: Buffer) => {
      const text = buf.toString();
      output += text;
      if (!quiet) for (const line of text.split('\n')) if (line.trim()) console.log(`[${scope}] ${line}`);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const timer = setTimeout(() => ((timedOut = true), child.kill('SIGTERM')), timeoutMs);
    child.on('close', (exitCode) => (clearTimeout(timer), res({ exitCode, timedOut, output })));
  });
}

function die(msg: string): never {
  console.error(`[demo] ${msg}`);
  process.exit(1);
}
