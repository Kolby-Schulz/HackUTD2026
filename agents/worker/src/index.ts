// Worker script (spec section 11). Owner: agents.
// npm run worker -- --id agent-a --task 1 --mode with_contract|without_contract
//
// Runs one Claude Code session headless in its own git worktree. In with_contract
// mode it joins Contract (MCP server + rules + edit hook), stops on pause and resumes
// with the coordinator's decision. In without_contract mode every coordination call
// is a no-op but tokens are still logged, so the same script produces the baseline.
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { connect, noopClient, type ContractClient } from '@contract/client';
import { createLLM, LLMAbortError, type Usage } from '@contract/llm';
import { CONTRACT_RULES } from './rules.ts';
import { TASKS } from './tasks.ts';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const { values } = parseArgs({
  options: {
    id: { type: 'string' },
    task: { type: 'string', default: '1' },
    mode: { type: 'string', default: 'with_contract' },
    owner: { type: 'string', default: process.env.USER ?? 'dev' },
    machine: { type: 'string', default: process.env.HOSTNAME ?? 'laptop' },
  },
});
const agentId = values.id ?? die('--id is required');
const mode = values.mode as 'with_contract' | 'without_contract';
const taskId = BigInt(values.task!);
const task = TASKS[values.task!] ?? die(`unknown --task ${values.task}`);
let attempt = 1;

// 1. Worktree + branch (shares git history with the monorepo; agents work in its demo-repo/).
const worktree = join(REPO, '.worktrees', agentId);
if (!existsSync(worktree)) {
  mkdirSync(join(REPO, '.worktrees'), { recursive: true });
  execFileSync('git', ['worktree', 'add', '-B', `agent/${agentId}`, worktree, 'HEAD'], { cwd: REPO, stdio: 'inherit' });
}
const cwd = join(worktree, 'demo-repo');

// 2. Join Contract (or not).
const localLog = join(REPO, '.worktrees', `${agentId}.tokens.jsonl`);
const logLocally: ContractClient['logTokens'] = async (t, a, purpose, usage) =>
  appendFileSync(localLog, JSON.stringify({ agentId, mode, task: String(t), attempt: a, purpose, ...usage }) + '\n');

const contract: ContractClient =
  mode === 'with_contract'
    ? await connect({
        host: process.env.SPACETIME_HOST!,
        dbName: process.env.SPACETIME_DB_NAME!,
        agent: { id: agentId, name: agentId, ownerDev: values.owner!, machine: values.machine!, model: 'claude-code', tokenBudget: 200_000 },
      })
    : noopClient(agentId, logLocally);

// 3. Claude Code wiring for with_contract mode: MCP server, rules, edit hook.
const env = { CONTRACT_AGENT_ID: agentId, CONTRACT_TOKEN: contract.token, CONTRACT_REPO: REPO };
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
  contract.logTokens(taskId, attempt, purpose, usage);

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
      cwd,
      env,
      signal: controller.signal,
      resumeSessionId: sessionId,
      onSessionId: (id) => (sessionId = id),
      onUsage,
      allowedTools: ['Bash(npm test:*)', 'Bash(npx vitest:*)', ...(contractOpts.allowedTools ?? [])],
      ...contractOpts,
    });
    console.log(`[${agentId}] done (${r.usage.prompt_tokens}+${r.usage.completion_tokens} tokens, $${r.usage.cost_usd.toFixed(4)})`);
    break;
  } catch (e) {
    if (!(e instanceof LLMAbortError)) throw e;
    // TODO(agents): log an early_stop saving (estimate from the baseline run's average coding step).
    await contract.logSaving('early_stop', 0, `paused during ${sessionId}`);
    const instr = await nextInstruction(contract);
    await contract.ack(instr.id);
    prompt = `Coordinator decision: ${instr.text}. Continue your task.`;
    controller = new AbortController();
  }
}

// 6. Commit to the agent's branch, release claims, mark the task done.
execFileSync('git', ['add', '-A'], { cwd: worktree });
execFileSync('git', ['commit', '-m', `${agentId}: ${task.slice(0, 60)}`, '--allow-empty'], { cwd: worktree, stdio: 'inherit' });
// TODO(agents): release claims and call set_task_status(taskId, 'done') once the client has them.
await contract.disconnect();

function nextInstruction(c: ContractClient) {
  return new Promise<{ id: bigint; text: string }>((res) => {
    const pending = c.pendingInstructions()[0];
    if (pending) return res(pending);
    const off = c.onInstruction((i) => {
      off();
      res(i);
    });
  });
}

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}
