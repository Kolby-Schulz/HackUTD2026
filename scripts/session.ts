// scripts/session.ts: the two-laptop live demo. Owner: dashboard + demo.
//
// npm run session -- start [--no-map]
//   Ends any open run, clears per-run server state, opens a with_contract run and maps
//   demo-repo once. Then on each laptop:
//     npm run worker -- --id agent-a --prompt "..."   (or --wait + the dashboard's New task form)
//   Each worker pushes agent/<id> to origin when it finishes.
//
// npm run session -- merge [--agents agent-a,agent-b] [--integration] [--no-fix]
//                          [--fixer <id>] [--fix-passes 2] [--push]
//   On either laptop, once every agent is done: fetches origin/agent/<id> for each agent
//   with a task in the open run, merges them onto origin/main in .worktrees/merge-<run>,
//   runs the checks, lets one local agent fix the merged code if they fail, then ends the run.
//   --integration adds demo-repo's integration test, which only passes for the two canned
//   tasks (agents/worker/src/tasks.ts); free-form prompts get unit tests, typecheck, check-dupes.
//
// Needs `npm run coordinator` running on one laptop while the workers run.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type { DbConnection } from '@contract/client';
import { checkAll, conflictMarkers, merge, mergeFix, run, warnIfNoCoordinator, type CheckScript } from './merge.ts';
import { adminConnect, git, log, REPO, resetServerState, savedToken, TSX, waitFor, WORKTREES } from './lib.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    'no-map': { type: 'boolean', default: false },
    agents: { type: 'string' },
    integration: { type: 'boolean', default: false },
    'no-fix': { type: 'boolean', default: false },
    fixer: { type: 'string' },
    'fix-passes': { type: 'string', default: '2' },
    push: { type: 'boolean', default: false },
  },
});

const QUERIES = ['SELECT * FROM run', 'SELECT * FROM task', 'SELECT * FROM agent'];

try {
  if (positionals[0] === 'start') await start();
  else if (positionals[0] === 'merge') await mergeSession();
  else throw new Error('usage: npm run session -- start | merge   (see scripts/session.ts)');
} catch (e) {
  console.error(`[session] ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
process.exit(0);

async function start() {
  const conn = await adminConnect(QUERIES);
  const ended = await resetServerState(conn);
  if (ended.length) log('session', `ended open run(s) ${ended.join(', ')}`);
  await conn.reducers.startRun({ mode: 'with_contract', seed: 0 });
  const runRow = await waitFor(() => openRun(conn), 'the new run');
  log('session', `run ${runRow.id} open (with_contract)`);

  if (!values['no-map']) {
    // The code map comes from this laptop's demo-repo; workers start from origin/main.
    try {
      git(['fetch', 'origin', 'main']);
      if (git(['diff', '--name-only', 'origin/main', '--', 'demo-repo', ':!demo-repo/package-lock.json'])) {
        log('session', 'WARNING: local demo-repo/ differs from origin/main; the code map will not match what the workers start from');
      }
    } catch {
      log('session', 'WARNING: could not fetch origin/main to compare demo-repo/');
    }
    const r = await run('mapper', TSX, [join(REPO, 'mapper/src/cli.ts')], REPO, 5 * 60_000);
    if (r.exitCode !== 0) throw new Error('mapper failed; is the server reachable?');
  }
  warnIfNoCoordinator(conn);
  conn.disconnect();

  log('session', 'ready. On each laptop (a different --id each):');
  log('session', '  npm run worker -- --id agent-a --prompt "what this agent should build"');
  log('session', '  npm run worker -- --id agent-b --wait     (then assign it a task from the dashboard)');
  log('session', 'When every agent is done: npm run session -- merge');
}

async function mergeSession() {
  const conn = await adminConnect(QUERIES);
  const runRow = openRun(conn);
  if (!runRow) throw new Error('no open run; start one with `npm run session -- start`');
  const tasks = [...conn.db.task.iter()].filter((t) => t.runId === runRow.id);
  const agents = values.agents?.split(',').map((s) => s.trim()).filter(Boolean) ?? [...new Set(tasks.map((t) => t.agentId))].sort();
  if (!agents.length) throw new Error(`run ${runRow.id} has no tasks yet`);
  const unfinished = tasks.filter((t) => agents.includes(t.agentId) && t.status !== 'done' && t.status !== 'discarded');
  if (unfinished.length) log('session', `WARNING: still running: ${unfinished.map((t) => `${t.agentId} (task ${t.id}, ${t.status})`).join(', ')}`);

  // 1. Fetch main and every agent's branch.
  git(['fetch', 'origin', 'main']);
  const branches: string[] = [];
  for (const a of agents) {
    try {
      git(['fetch', 'origin', `+refs/heads/agent/${a}:refs/remotes/origin/agent/${a}`]);
      branches.push(`origin/agent/${a}`);
    } catch {
      log('session', `WARNING: origin has no agent/${a}; did its worker finish and push? Skipping it`);
    }
  }
  if (!branches.length) throw new Error('no agent branches on origin to merge');

  // 2. Merge onto origin/main in a fresh worktree.
  const mergeBranch = `demo/merge-${runRow.id}`;
  const mergeDir = join(WORKTREES, `merge-${runRow.id}`);
  if (existsSync(mergeDir)) throw new Error(`${mergeDir} already exists; \`npm run reset\` removes it`);
  git(['worktree', 'add', '-B', mergeBranch, mergeDir, 'origin/main']);
  const conflicts: string[] = [];
  for (const b of branches) conflicts.push(...merge(mergeDir, b));
  if (conflicts.length) log('session', `git conflicts in ${conflicts.join(', ')} (left with markers for the fix pass)`);
  const demoDir = join(mergeDir, 'demo-repo');

  // 3. Checks.
  const scripts: CheckScript[] = ['test', 'typecheck', 'check:dupes', ...(values.integration ? (['test:integration'] as const) : [])];
  const atMerge = await checkAll(demoDir, scripts);
  let final = atMerge;
  const green = () => final.checks.every((c) => c.ok) && conflicts.length === 0;
  log('session', `at merge: ${green() ? 'all checks pass' : 'checks fail'}`);

  // 4. Merge fix by one agent whose identity this laptop holds.
  let passes = 0;
  if (!green() && !values['no-fix']) {
    const fixer = values.fixer ?? agents.find((a) => localToken(a));
    const fixerTask = tasks.filter((t) => t.agentId === fixer).at(-1);
    if (!fixer || !fixerTask) {
      log('session', `no local agent to run the fix (this laptop has no saved identity for ${agents.join(', ')}); pass --fixer <id>`);
    } else {
      for (const t of tasks.filter((t) => agents.includes(t.agentId))) {
        await conn.reducers.markAttemptWasted({ taskId: t.id, attempt: 1 }).catch(() => undefined);
      }
      log('session', 'coding attempts marked wasted');
      while (!green() && passes < Number(values['fix-passes'])) {
        passes++;
        await mergeFix(fixer, fixerTask.id, demoDir, final.checks, conflicts);
        conflicts.splice(0, conflicts.length, ...conflictMarkers(mergeDir));
        final = await checkAll(demoDir, scripts);
      }
    }
  }
  git(['add', '-A'], mergeDir);
  git(['commit', '-m', `merge run ${runRow.id} (session: ${agents.join(', ')})`, '--allow-empty', '--no-verify'], mergeDir);
  if (values.push) git(['push', '--force', '-u', 'origin', mergeBranch], mergeDir);

  // 5. Close the run.
  await conn.reducers.endRun({ runId: runRow.id });
  conn.disconnect();
  log('session', `run ${runRow.id} ended: ${green() ? 'ALL CHECKS PASS' : 'checks still failing'}` +
    ` (${final.tests.passed} tests passed, ${final.tests.failed} failed, ${final.dateFormatters} date formatter(s),` +
    ` ${passes} fix pass(es)); merged code on branch ${mergeBranch}${values.push ? ' (pushed)' : ''}`);
  if (!green()) process.exit(1);
}

function openRun(conn: DbConnection) {
  return [...conn.db.run.iter()].find((r) => r.endedAt === undefined);
}

function localToken(agentId: string): boolean {
  return Boolean(savedToken(agentId));
}
