// Worker script (spec section 11). Owner: agents.
// npm run worker -- --id agent-a --task 1 --mode with_contract|without_contract
//   [--task-id <task row id>]  (default: --task; scripts/seed.ts creates new rows each run)
//   CONTRACT_TOKEN in env reuses an identity, so the same agent id can run again at once.
//
// Two-laptop session flow (always with_contract; `npm run session -- start` opens the run):
// npm run worker -- --id agent-b --prompt "add a receipt to checkout..."   own task row
// npm run worker -- --id agent-b --wait          take the next todo task (dashboard form)
//   Both push agent/<id> to origin when done (--no-push to skip) and branch the worktree
//   from origin/main (--base <ref> to change), so both laptops start from the same commit.
//
// Runs one Claude Code session headless in its own git worktree. In with_contract
// mode it joins Contract (MCP server + rules + edit hook), stops on pause and resumes
// with the coordinator's decision. In without_contract mode every coordination call
// is a no-op but tokens are still logged, so the same script produces the baseline.
import { config as loadEnv } from 'dotenv';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { connect, noopClient, type ContractClient } from '@contract/client';
import { createLLM, LLMAbortError, type Usage } from '@contract/llm';
import { earlyStopEstimate, readTokenLog, resumeInstructions } from './resume.ts';
import { CONTRACT_RULES } from './rules.ts';
import { createPromptTask, waitForTask } from './session-task.ts';
import { TASKS } from './tasks.ts';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
// npm -w runs us inside our own folder, so load the monorepo's .env explicitly.
loadEnv({ path: resolve(REPO, '.env'), quiet: true });
/** Saved SpacetimeDB tokens per agent id and server (gitignored; same file and keys as scripts/lib.ts). */
const IDENTITIES = join(REPO, '.contract', 'identities.json');
const identityKey = (id: string) => `${id}@${process.env.SPACETIME_DB_NAME}@${process.env.SPACETIME_HOST}`;

const { values } = parseArgs({
  options: {
    id: { type: 'string' },
    task: { type: 'string' },
    'task-id': { type: 'string' },
    prompt: { type: 'string' },
    wait: { type: 'boolean', default: false },
    base: { type: 'string' },
    'no-push': { type: 'boolean', default: false },
    mode: { type: 'string', default: 'with_contract' },
    owner: { type: 'string', default: process.env.USER ?? 'dev' },
    machine: { type: 'string', default: process.env.HOSTNAME ?? hostname().replace(/\.local$/, '') },
  },
});
const agentId = values.id ?? die('--id is required');
const mode = values.mode as 'with_contract' | 'without_contract';
/** --prompt / --wait: the two-laptop flow, where the task row comes from the open run. */
const session = values.prompt !== undefined || values.wait;
if (session && values.task !== undefined) die('use --task, --prompt or --wait, not several');
if (values.prompt !== undefined && values.wait) die('use --prompt or --wait, not both');
if (session && mode !== 'with_contract') die('--prompt and --wait need --mode with_contract');
if (values.prompt !== undefined && !values.prompt.trim()) die('--prompt is empty');
const taskKey = values.task ?? '1';
if (!session && !TASKS[taskKey]) die(`unknown --task ${taskKey}`);
const push = session && !values['no-push'];
let taskId = BigInt(values['task-id'] ?? taskKey);
let task = TASKS[taskKey] ?? '';
let attempt = 1;

// 1. Worktree + branch (shares git history with the monorepo; agents work in its demo-repo/).
// The session flow branches from origin/main so both laptops start from the same commit.
const base = values.base ?? (session ? 'origin/main' : 'HEAD');
const worktree = join(REPO, '.worktrees', agentId);
if (!existsSync(worktree)) {
  if (base.startsWith('origin/')) execFileSync('git', ['fetch', 'origin', base.slice('origin/'.length)], { cwd: REPO, stdio: 'inherit' });
  mkdirSync(join(REPO, '.worktrees'), { recursive: true });
  execFileSync('git', ['worktree', 'add', '-B', `agent/${agentId}`, worktree, base], { cwd: REPO, stdio: 'inherit' });
} else if (session) {
  console.warn(`[${agentId}] reusing ${worktree} from an earlier run; \`npm run reset\` first for a clean start from ${base}`);
}
const cwd = join(worktree, 'demo-repo');

// 2. Join Contract (or not).
// Every run is also logged locally (outside .worktrees/, which reset removes); the
// baseline lines give the early_stop estimate in later with_contract runs.
const localLog = join(REPO, '.contract', 'tokens.jsonl');
mkdirSync(dirname(localLog), { recursive: true });
const logLocally: ContractClient['logTokens'] = async (t, a, purpose, usage) =>
  appendFileSync(localLog, JSON.stringify({ agentId, mode, task: String(t), attempt: a, purpose, ...usage }) + '\n');

const connectOpts = {
  host: process.env.SPACETIME_HOST!,
  dbName: process.env.SPACETIME_DB_NAME!,
  repoDir: cwd,
  // Reuse this agent id's saved identity (register_agent refuses an id held by another
  // identity for 60 s), so a worker can be restarted straight away on the same laptop.
  token: process.env.CONTRACT_TOKEN || savedToken() || undefined,
  agent: { id: agentId, name: agentId, ownerDev: values.owner!, machine: values.machine!, model: 'claude-code', tokenBudget: 200_000 },
};
let contract: ContractClient;
if (mode === 'with_contract') {
  contract = await connect(connectOpts);
} else {
  // Baseline: no coordination at all, but tokens still reach token_usage when a server
  // is up, so the scoreboard can compare the two runs.
  const server = process.env.SPACETIME_HOST ? await connect(connectOpts).catch(() => undefined) : undefined;
  if (!server) console.warn(`[${agentId}] no Contract server; baseline tokens logged to ${localLog} only`);
  contract = noopClient(agentId, async (...a) => {
    await logLocally(...a);
    await server?.logTokens(...a);
  });
  contract.disconnect = async () => server?.disconnect();
}
if (mode === 'with_contract') saveToken(contract.token);

// Session flow: the task row comes from the open run (our own, or one the dashboard made).
if (session) {
  const o = { host: connectOpts.host, dbName: connectOpts.dbName, token: contract.token, agentId };
  try {
    const t = values.prompt !== undefined
      ? await createPromptTask(o, values.prompt.trim())
      : await waitForTask(o, (msg) => console.log(`[${agentId}] ${msg}`));
    taskId = t.id;
    task = t.description;
  } catch (e) {
    await contract.disconnect();
    die(`[${agentId}] ${e instanceof Error ? e.message : String(e)}`);
  }
  console.log(`[${agentId}] task ${taskId}: ${task}`);
}

const logTokens: ContractClient['logTokens'] =
  mode === 'with_contract' ? async (...a) => (await logLocally(...a), await contract.logTokens(...a)) : contract.logTokens;

// 3. Claude Code wiring for with_contract mode: MCP server, rules, edit hook.
const env: Record<string, string> = {
  CONTRACT_AGENT_ID: agentId,
  CONTRACT_TOKEN: contract.token,
  CONTRACT_TASK_ID: String(taskId),
  CONTRACT_REPO: REPO,
  CONTRACT_REPO_DIR: cwd,
  SPACETIME_HOST: process.env.SPACETIME_HOST ?? '',
  SPACETIME_DB_NAME: process.env.SPACETIME_DB_NAME ?? '',
};
const mcpConfig = join(worktree, '.contract-mcp.json');
if (mode === 'with_contract') {
  writeFileSync(
    mcpConfig,
    JSON.stringify({
      mcpServers: { contract: { command: join(REPO, 'node_modules/.bin/tsx'), args: [join(REPO, 'packages/mcp/src/index.ts')], env } },
    }),
  );
}
const contractOpts =
  mode === 'with_contract'
    ? { appendSystemPrompt: CONTRACT_RULES, mcpConfig, settings: join(REPO, 'agents/worker/hook-settings.json'), allowedTools: ['mcp__contract'] }
    : {};

const llm = createLLM();
const onUsage = (usage: Usage, purpose: Parameters<ContractClient['logTokens']>[2]) =>
  logTokens(taskId, attempt, purpose, usage).catch((e: unknown) => console.warn(`[${agentId}] logTokens failed: ${String(e)}`));

// The task moves to in_progress (and the agent to working). Seeding creates the task;
// without it, keep going rather than fail the run.
await contract.setTaskStatus(taskId, 'in_progress').catch((e: unknown) => console.warn(`[${agentId}] set_task_status: ${String(e)}`));

// 4. Early stop: abort the running Claude Code process when we get paused.
let controller = new AbortController();
contract.onStatusChange((status) => {
  if (status === 'paused') controller.abort();
});

// 5. Run, and on pause wait for an instruction then resume the same session.
let sessionId: string | undefined;
let prompt = task;
for (;;) {
  try {
    const r = await llm.runWorker(prompt, {
      ...contractOpts,
      cwd,
      // Load every tool schema up front: with lazy loading the model's first Contract calls
      // guess the arguments and fail validation.
      env: { ...env, ENABLE_TOOL_SEARCH: 'false' },
      signal: controller.signal,
      resumeSessionId: sessionId,
      onSessionId: (id) => (sessionId = id),
      onUsage,
      // After the spread, so contractOpts.allowedTools can't drop the test commands.
      allowedTools: ['Bash(npm test:*)', 'Bash(npm run:*)', 'Bash(npx vitest:*)', ...(contractOpts.allowedTools ?? [])],
    });
    console.log(`[${agentId}] done (${r.usage.prompt_tokens}+${r.usage.completion_tokens} tokens, $${r.usage.cost_usd.toFixed(4)})`);
    break;
  } catch (e) {
    if (!(e instanceof LLMAbortError)) throw e;
    sessionId = e.sessionId ?? sessionId;
    const est = earlyStopEstimate(readTokenLog(localLog), e.usage?.completion_tokens ?? 0);
    console.log(`[${agentId}] paused; stopped Claude Code (~${est.tokens} tokens avoided${est.fromBaseline ? '' : ', default estimate'})`);
    await contract
      .logSaving('early_stop', est.tokens, `paused during ${sessionId ?? 'run'}${est.fromBaseline ? '' : ' (no baseline yet: default estimate)'}`)
      .catch((err: unknown) => console.warn(`[${agentId}] logSaving failed: ${String(err)}`));
    if (!sessionId) throw new Error(`[${agentId}] paused before Claude Code reported a session id; cannot resume`);

    // Wait for the coordinator: resolve/dismiss unpauses us after inserting its instruction.
    await waitUntilUnpaused(contract);
    const instrs = resumeInstructions(contract.pendingInstructions());
    for (const i of contract.pendingInstructions()) await contract.ack(i.id);
    const text = instrs.map((i) => i.text).join(' ') || 'No change needed.';
    console.log(`[${agentId}] resuming: ${text}`);
    prompt = `Coordinator decision: ${text} Continue your task.`;
    controller = new AbortController();
  }
}

// 6. Commit to the agent's branch, release claims, mark the task done.
execFileSync('git', ['add', '-A'], { cwd: worktree });
execFileSync('git', ['commit', '-m', `${agentId}: ${task.slice(0, 60)}`, '--allow-empty'], { cwd: worktree, stdio: 'inherit' });
for (const symbolId of contract.myClaims()) {
  await contract.release(symbolId).catch((e: unknown) => console.warn(`[${agentId}] release ${symbolId}: ${String(e)}`));
}
await contract.setTaskStatus(taskId, 'done').catch((e: unknown) => console.warn(`[${agentId}] set_task_status: ${String(e)}`));
await contract.disconnect();

// 7. Session flow: publish the branch so `npm run session -- merge` on either laptop sees it.
if (push) {
  try {
    execFileSync('git', ['push', '--force', '-u', 'origin', `agent/${agentId}`], { cwd: worktree, stdio: 'inherit' });
    console.log(`[${agentId}] pushed agent/${agentId}; run \`npm run session -- merge\` once every agent is done`);
  } catch {
    console.error(`[${agentId}] git push failed; push agent/${agentId} by hand before the merge`);
    process.exit(1);
  }
}
process.exit(0);

function savedToken(): string | undefined {
  try {
    return (JSON.parse(readFileSync(IDENTITIES, 'utf8')) as Record<string, string>)[identityKey(agentId)];
  } catch {
    return undefined;
  }
}

/** Same file scripts/lib.ts uses, so run-demo and a hand-started worker share identities. */
function saveToken(token: string) {
  let all: Record<string, string> = {};
  try {
    all = JSON.parse(readFileSync(IDENTITIES, 'utf8')) as Record<string, string>;
  } catch { /* first save */ }
  if (all[identityKey(agentId)] === token) return;
  all[identityKey(agentId)] = token;
  mkdirSync(dirname(IDENTITIES), { recursive: true });
  writeFileSync(IDENTITIES, JSON.stringify(all, null, 2) + '\n', { mode: 0o600 });
}

/** Resolves once this agent's status is no longer 'paused'. */
function waitUntilUnpaused(c: ContractClient) {
  return new Promise<void>((res) => {
    if (c.status() !== 'paused') return res();
    const off = c.onStatusChange((s) => {
      if (s === 'paused') return;
      off();
      res();
    });
  });
}

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}
