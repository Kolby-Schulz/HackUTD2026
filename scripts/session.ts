// scripts/session.ts: the two-laptop live demo. Owner: dashboard + demo.
//
// npm run session -- start [--no-map]
//   Ends any open run, clears per-run server state, opens a with_contract run and maps
//   demo-repo once. Then on each laptop:
//     npm run worker -- --id agent-a --prompt "..."   (or --wait + the dashboard's New task form)
//   Each worker pushes agent/<id> to origin when it finishes.
//
// npm run session -- merge [--agents agent-a,agent-b] [--integration] [--no-fix]
//                          [--fixer <id>] [--fix-passes 2] [--push] [--land]
//   On either laptop, once every agent is done: fetches origin/agent/<id> for each agent
//   with a task in the open run, merges them onto origin/main in .worktrees/merge-<run>,
//   runs the checks, lets one local agent fix the merged code if they fail, then ends the run.
//   --integration adds demo-repo's integration test, which only passes for the two canned
//   tasks (agents/worker/src/tasks.ts); free-form prompts get unit tests, typecheck, check-dupes.
//   --land pushes the merge commit to the base branch on origin (e.g. main) when every check
//   passes; otherwise the merged code only stays on demo/merge-<run>.
//
// Any repo (issue #18): add --repo <path|git URL> (or set CONTRACT_TARGET) to start, merge,
// the workers and reset. start maps that repo; merge runs its contract.json checks (or
// `npm test`). `start --tasks tasks.json` queues tasks for workers started with --wait:
//   [{ "agent": "agent-a", "task": "Add a dark mode toggle" }, ...]   ("title" optional)
//
// Needs `npm run coordinator` running on one laptop while the workers run.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { resolveTarget, runInstall, stageAll, subdirPrefix, worktreeDir, type DbConnection } from '@contract/client';
import { conflictMarkers, merge, mergeFix, run, runChecks, warnIfNoCoordinator } from './merge.ts';
import { adminConnect, fastForwardToBase, git, log, REPO, resetServerState, savedToken, TSX, TSX_CLI, waitFor } from './lib.ts';

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
    land: { type: 'boolean', default: false },
    repo: { type: 'string' },
    tasks: { type: 'string' },
  },
});
const target = resolveTarget(REPO, values.repo);

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
    // The code map comes from this laptop's checkout of the target; workers start from target.base.
    const path = target.subdir || '.';
    if (target.base.startsWith('origin/')) {
      try {
        git(['fetch', 'origin', target.base.slice('origin/'.length)], target.gitRoot);
        // A merge that landed since the last session (Merge and check's --land) is on origin only:
        // fast-forward the checkout so the code map shows it.
        const ff = fastForwardToBase(target.gitRoot, target.base);
        if (ff.status === 'updated') log('session', `updated ${target.label} to ${target.base}`);
        else if (ff.status === 'skipped') log('session', `not updating ${target.label} to ${target.base}: ${ff.reason}`);
        if (git(['diff', '--name-only', target.base, '--', path, `:!${subdirPrefix(target)}package-lock.json`], target.gitRoot)) {
          log('session', `WARNING: local ${target.label} differs from ${target.base}; the code map will not match what the workers start from`);
        }
      } catch {
        log('session', `WARNING: could not fetch ${target.base} to compare ${target.label}`);
      }
    }
    const r = await run('mapper', TSX, [TSX_CLI, join(REPO, 'mapper/src/cli.ts'), '--repo', target.dir], REPO, 5 * 60_000);
    if (r.exitCode !== 0) throw new Error('mapper failed; is the server reachable?');
  }

  if (values.tasks) {
    for (const t of readTasks(values.tasks)) {
      await conn.reducers.createTask({ title: t.title, description: t.task, agentId: t.agent, runId: runRow.id });
      log('session', `queued for ${t.agent}: ${t.title}`);
    }
  }
  warnIfNoCoordinator(conn);
  conn.disconnect();

  const repo = target.demo ? '' : ` --repo ${values.repo ?? process.env.CONTRACT_TARGET}`;
  log('session', `ready (${target.label}). On each laptop (a different --id each):`);
  log('session', `  npm run worker -- --id agent-a${repo} --prompt "what this agent should build"`);
  log('session', `  npm run worker -- --id agent-b${repo} --wait     (${values.tasks ? 'takes its queued task' : 'then assign it a task from the dashboard'})`);
  log('session', `When every agent is done: npm run session -- merge${repo}`);
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

  // 1. Fetch the base and every agent's branch (in the target repo).
  const root = target.gitRoot;
  const base = target.base.startsWith('origin/') ? target.base : 'HEAD';
  if (base !== 'HEAD') git(['fetch', 'origin', base.slice('origin/'.length)], root);
  const branches: string[] = [];
  for (const a of agents) {
    try {
      git(['fetch', 'origin', `+refs/heads/agent/${a}:refs/remotes/origin/agent/${a}`], root);
      branches.push(`origin/agent/${a}`);
    } catch {
      log('session', `WARNING: origin has no agent/${a}; did its worker finish and push? Skipping it`);
    }
  }
  if (!branches.length) throw new Error('no agent branches on origin to merge');

  // 2. Merge onto the base in a fresh worktree.
  const mergeBranch = `demo/merge-${runRow.id}`;
  const mergeDir = worktreeDir(REPO, target, `merge-${runRow.id}`);
  if (existsSync(mergeDir)) throw new Error(`${mergeDir} already exists; \`npm run reset\` removes it`);
  mkdirSync(dirname(mergeDir), { recursive: true });
  git(['worktree', 'add', '-B', mergeBranch, mergeDir, base], root);
  const conflicts: string[] = [];
  for (const b of branches) conflicts.push(...merge(mergeDir, b, subdirPrefix(target)));
  if (conflicts.length) log('session', `git conflicts in ${conflicts.join(', ')} (left with markers for the fix pass)`);
  const demoDir = target.subdir ? join(mergeDir, target.subdir) : mergeDir;
  if (target.install.length) runInstall(demoDir, target, (m) => log('session', m)); // so the checks can run

  // 3. Checks: the target's own (contract.json / npm test); the demo can add its integration test.
  const checkList = [...target.checks, ...(target.demo && values.integration ? [{ name: 'integration test', cmd: 'npm run --silent test:integration' }] : [])];
  if (!checkList.length) log('session', `WARNING: ${target.label} has no checks (add contract.json "checks" or an npm test script); the merge is unchecked`);
  const atMerge = await runChecks(demoDir, checkList);
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
        conflicts.splice(0, conflicts.length, ...conflictMarkers(mergeDir, target.subdir));
        final = await runChecks(demoDir, checkList);
      }
    }
  }
  stageAll(mergeDir); // never installed dependencies
  git(['commit', '-m', `merge run ${runRow.id} (session: ${agents.join(', ')})`, '--allow-empty', '--no-verify'], mergeDir);
  if (values.push) git(['push', '--force', '-u', 'origin', mergeBranch], mergeDir);
  const landed = values.land && land(mergeDir, base, mergeBranch, green());

  // 5. Close the run.
  await conn.reducers.endRun({ runId: runRow.id });
  conn.disconnect();
  log('session', `run ${runRow.id} ended: ${green() ? 'ALL CHECKS PASS' : 'checks still failing'}` +
    ` (${final.tests.passed} tests passed, ${final.tests.failed} failed, ${final.dateFormatters} date formatter(s),` +
    ` ${passes} fix pass(es)); merged code on branch ${mergeBranch}${values.push ? ' (pushed)' : ''}${landed ? `, landed on ${base}` : ''}`);
  if (!green()) process.exit(1);
}

/** --land: fast-forward the base branch on origin to the merge commit, only when the checks pass. */
function land(mergeDir: string, base: string, mergeBranch: string, green: boolean): boolean {
  if (!green) {
    log('session', `not landing: checks fail; the merged code stays on ${mergeBranch}`);
    return false;
  }
  if (!base.startsWith('origin/')) {
    log('session', `not landing: ${target.label} has no origin branch to push to; the merged code stays on ${mergeBranch}`);
    return false;
  }
  try {
    // No --force: if someone pushed to the base since the fetch, this fails instead of dropping their commits.
    git(['push', 'origin', `HEAD:refs/heads/${base.slice('origin/'.length)}`], mergeDir);
    log('session', `landed on ${base}`);
    return true;
  } catch (e) {
    log('session', `could not push to ${base} (did it move since the merge started?): ${e instanceof Error ? e.message : String(e)}; the merged code stays on ${mergeBranch}`);
    return false;
  }
}

function openRun(conn: DbConnection) {
  return [...conn.db.run.iter()].find((r) => r.endedAt === undefined);
}

/** --tasks file: [{ agent, task, title? }]. */
export function readTasks(path: string): { agent: string; task: string; title: string }[] {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  if (!Array.isArray(raw)) throw new Error(`${path}: expected a JSON array of { "agent", "task" }`);
  return raw.map((t: { agent?: unknown; task?: unknown; title?: unknown }, i) => {
    if (typeof t.agent !== 'string' || typeof t.task !== 'string' || !t.agent.trim() || !t.task.trim()) {
      throw new Error(`${path}[${i}]: needs string "agent" and "task"`);
    }
    const task = t.task.trim();
    const title = typeof t.title === 'string' && t.title.trim() ? t.title.trim() : task.length > 60 ? `${task.slice(0, 57)}...` : task;
    return { agent: t.agent.trim(), task, title };
  });
}

function localToken(agentId: string): boolean {
  return Boolean(savedToken(agentId));
}
