// Merge, check and merge-fix helpers shared by run-demo.ts and session.ts. Owner: dashboard + demo.
import { spawn } from 'node:child_process';
import { checkTools, connect, toolPath, type Check as TargetCheck, type DbConnection } from '@contract/client';
import { createLLM } from '@contract/llm';
import { git, log, savedToken } from './lib.ts';

export interface Check { name: string; ok: boolean; output: string; cmd: string }
export interface TestCount { passed: number; failed: number }
export interface CheckResult { checks: Check[]; tests: TestCount; dateFormatters: number }

/** demo-repo npm scripts and the names results use for them. */
export const CHECKS = {
  test: 'unit tests',
  'test:integration': 'integration test',
  'check:dupes': 'check-dupes',
  typecheck: 'typecheck',
} as const;
export type CheckScript = keyof typeof CHECKS;

/**
 * Merges `branch` into the worktree. Returns conflicted target files (left unresolved).
 * `prefix` is the target folder inside the repo ('demo-repo/' for the demo, '' = whole repo).
 */
export function merge(dir: string, branch: string, prefix = 'demo-repo/'): string[] {
  try {
    git(['merge', '--no-edit', '--no-ff', '-m', `merge ${branch}`, branch], dir);
    return [];
  } catch {
    const conflicted = git(['diff', '--name-only', '--diff-filter=U'], dir).split('\n').filter(Boolean);
    // Files outside demo-repo/ (e.g. each worker's .contract-mcp.json) are run plumbing,
    // not code: take ours and move on.
    for (const f of conflicted.filter((f) => !f.startsWith(prefix))) {
      git(['checkout', '--ours', '--', f], dir);
      git(['add', '--', f], dir);
    }
    git(['add', '-A'], dir); // commit with markers in place; the fix pass resolves them
    git(['commit', '--no-edit', '--no-verify'], dir);
    return conflicted.filter((f) => f.startsWith(prefix));
  }
}

export function conflictMarkers(dir: string, path = 'demo-repo'): string[] {
  try {
    return git(['grep', '-l', '-E', '^(<<<<<<<|>>>>>>>) ', '--', path || '.'], dir).split('\n').filter(Boolean);
  } catch {
    return []; // git grep exits 1 when nothing matches
  }
}

export async function checkAll(demoDir: string, scripts: readonly CheckScript[] = ['test', 'test:integration', 'check:dupes']): Promise<CheckResult> {
  return runChecks(demoDir, scripts.map((s) => ({ name: CHECKS[s], cmd: `npm run --silent ${s}` })));
}

/** Runs each check's shell command in `dir` (issue #18: any repo's own checks). */
export async function runChecks(dir: string, list: readonly TargetCheck[]): Promise<CheckResult> {
  const checks: Check[] = [];
  const testRuns: string[] = [];
  let dupesOut = '';
  for (const c of list) {
    // The checkout's own tools first (.venv/bin for pytest, node_modules/.bin for vitest).
    const r = await run(`check:${c.name}`, 'sh', ['-c', c.cmd], dir, 5 * 60_000, { PATH: toolPath(dir) }, true);
    checks.push({ name: c.name, ok: r.exitCode === 0, output: r.output, cmd: c.cmd });
    if (/test/.test(c.name) || /\btest\b/.test(c.cmd)) testRuns.push(r.output);
    if (c.name === 'check-dupes') dupesOut = r.output;
  }
  const tests = testRuns.map(countTests).reduce((x, y) => ({ passed: x.passed + y.passed, failed: x.failed + y.failed }), { passed: 0, failed: 0 });
  const fm = /(\d+) date formatter/.exec(dupesOut);
  for (const c of checks) log('check', `${c.ok ? 'PASS' : 'FAIL'} ${c.name}`);
  return { checks, tests, dateFormatters: fm ? Number(fm[1]) : 0 };
}

/** Passed/failed counts from vitest ("Tests 3 passed | 1 failed") or node:test/TAP ("ℹ pass 3", "# fail 1"). */
export function countTests(out: string): TestCount {
  const text = out.replace(/\x1b\[[0-9;]*m/g, '');
  const line = /Tests\s+(.*)/.exec(text)?.[1];
  if (line) return { passed: Number(/(\d+) passed/.exec(line)?.[1] ?? 0), failed: Number(/(\d+) failed/.exec(line)?.[1] ?? 0) };
  const tap = (word: string) => Number(new RegExp(`^(?:ℹ|#) ${word} (\\d+)`, 'm').exec(text)?.[1] ?? 0);
  if (tap('pass') || tap('fail')) return { passed: tap('pass'), failed: tap('fail') };
  // pytest: "3 passed, 1 failed in 0.12s"; rspec: "4 examples, 1 failure"
  const py = /^=*\s*(.*\b(?:passed|failed)\b.*) in [\d.]+s/m.exec(text)?.[1];
  if (py) return { passed: Number(/(\d+) passed/.exec(py)?.[1] ?? 0), failed: Number(/(\d+) failed/.exec(py)?.[1] ?? 0) };
  const rs = /(\d+) examples?, (\d+) failures?/.exec(text);
  if (rs) return { passed: Number(rs[1]) - Number(rs[2]), failed: Number(rs[2]) };
  return { passed: 0, failed: 0 };
}

/** One Claude Code pass (purpose merge_fix, attempt 2) that repairs the merged code as `agentId`. */
export async function mergeFix(agentId: string, taskId: bigint, demoDir: string, checks: Check[], conflicts: string[]) {
  log('demo', `merge fix by ${agentId}`);
  const failing = checks.filter((c) => !c.ok);
  const cmds = checks.map((c) => `\`${c.cmd.replace('npm run --silent test', 'npm test').replace('npm run --silent ', 'npm run ')}\``);
  const commands = cmds.length > 1 ? `${cmds.slice(0, -1).join(', ')} and ${cmds.at(-1)}` : cmds.join('');
  const prompt = [
    'Two features were developed in parallel and merged into this repository. The merged code fails these checks.',
    conflicts.length ? `These files still contain git conflict markers: ${conflicts.join(', ')}.` : '',
    ...failing.map((c) => `--- ${c.name} ---\n${c.output.slice(-3000)}`),
    `Fix the source so ${commands} all pass, keeping both features.`,
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
      env: { PATH: toolPath(demoDir) },
      purpose: 'merge_fix',
      allowedTools: checkTools({ checks }),
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

/** `conn` must subscribe to the agent table. */
export function warnIfNoCoordinator(conn: DbConnection) {
  const c = [...conn.db.agent.iter()].find((a) => a.id === 'coordinator');
  const ageMs = c ? Date.now() - Number(c.lastHeartbeat.microsSinceUnixEpoch / 1000n) : Infinity;
  if (ageMs > 60_000) log('demo', 'WARNING: no live coordinator; start `npm run coordinator` or paused workers will wait until the timeout');
}

/** Runs a command, prefixing its output with [scope]. Kills it after timeoutMs. */
export function run(scope: string, cmd: string, args: string[], cwd: string, timeoutMs: number, env: Record<string, string> = {}, quiet = false) {
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
