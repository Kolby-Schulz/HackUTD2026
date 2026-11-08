// scripts/join.ts: get a new laptop into a Contract run with one command (issue #19).
//   npm run join -- --agent agent-b --name "Agent B" [--owner Bob] [--repo <path|git URL>]
//   npm run join -- --agent dana --name "Dana" --client claude-code|cursor|codex [--dir .] [--task "…"]
//
// --client (issue #22) joins your own editor instead of our worker script: it creates a task
// for the agent in the open run and writes that editor's MCP config and Contract rules into
// --dir (default: the target repo). Claude Code also gets the edit hooks (claim guard, change
// reporting, pause); Cursor/Codex use `npm run watch-agent` for change reporting. No tokens
// are written: the MCP server and hooks read the saved identity.
//
// Checks what a worker needs and says how to fix anything missing:
//   Node >= 22, .env with SPACETIME_HOST / SPACETIME_DB_NAME, the `claude` CLI and its login,
//   git and the target repo's origin. Then registers the agent (saving its identity so the
//   worker reuses it) and prints the command to start working.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { connect, resolveTarget } from '@contract/client';
import { joinedRules } from '../agents/worker/src/rules.ts';
import { clientFiles, CLIENTS, codexToml, type ClientKind } from './join-clients.ts';
import { adminConnect, log, REPO, savedToken, saveToken, waitFor } from './lib.ts';

export interface CheckLine { ok: boolean; what: string; fix?: string }

/** Node major version check (tsx + the SpacetimeDB SDK need a recent Node). */
export function nodeCheck(version = process.versions.node): CheckLine {
  const major = Number(version.split('.')[0]);
  return major >= 22 ? { ok: true, what: `Node ${version}` } : { ok: false, what: `Node ${version}`, fix: 'install Node 22 or newer (nvm install 22)' };
}

/** .env present and pointing at a server; localhost only works on one laptop. */
export function envCheck(env: NodeJS.ProcessEnv, hasEnvFile: boolean): CheckLine[] {
  const out: CheckLine[] = [];
  if (!hasEnvFile) out.push({ ok: false, what: '.env missing', fix: 'cp .env.example .env, then set SPACETIME_HOST and SPACETIME_DB_NAME' });
  if (!env.SPACETIME_HOST || !env.SPACETIME_DB_NAME) {
    out.push({ ok: false, what: 'SPACETIME_HOST / SPACETIME_DB_NAME not set', fix: 'set both in .env (see README, "Shared cloud database")' });
  } else if (/\/\/(localhost|127\.0\.0\.1)/.test(env.SPACETIME_HOST)) {
    out.push({ ok: true, what: `server ${env.SPACETIME_HOST} (${env.SPACETIME_DB_NAME}): local only; a second laptop can't reach it`, fix: 'use wss://maincloud.spacetimedb.com for two laptops' });
  } else {
    out.push({ ok: true, what: `server ${env.SPACETIME_HOST} (${env.SPACETIME_DB_NAME})` });
  }
  return out;
}

/** `claude auth status` JSON -> logged in or not. */
export function claudeCheck(run: () => string): CheckLine {
  try {
    const status = JSON.parse(run()) as { loggedIn?: boolean; authMethod?: string };
    return status.loggedIn
      ? { ok: true, what: `claude logged in (${status.authMethod ?? 'ok'})` }
      : { ok: false, what: 'claude is not logged in', fix: 'run `claude` once and log in' };
  } catch {
    return { ok: false, what: 'claude CLI not found or too old', fix: 'install Claude Code (npm i -g @anthropic-ai/claude-code), then log in' };
  }
}

const sh = (cmd: string, args: string[], cwd = REPO) =>
  execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20_000 }).trim();

async function main() {
  const { values } = parseArgs({
    options: {
      agent: { type: 'string' },
      name: { type: 'string' },
      owner: { type: 'string', default: process.env.USER ?? 'dev' },
      machine: { type: 'string', default: hostname().replace(/\.local$/, '') },
      repo: { type: 'string' },
      client: { type: 'string' },
      dir: { type: 'string' },
      task: { type: 'string' },
    },
  });
  const editor = values.client as ClientKind | undefined;
  if (editor && !CLIENTS.includes(editor)) throw new Error(`--client must be one of ${CLIENTS.join(', ')}`);
  const agentId = values.agent;
  if (!agentId || !/^[\w-]+$/.test(agentId)) throw new Error('usage: npm run join -- --agent agent-b --name "Agent B" [--owner Bob] [--repo <path|git URL>]');

  const checks: CheckLine[] = [nodeCheck(), ...envCheck(process.env, existsSync(join(REPO, '.env'))), claudeCheck(() => sh(process.env.CLAUDE_BIN ?? 'claude', ['auth', 'status']))];
  let repoLine: CheckLine;
  try {
    const target = resolveTarget(REPO, values.repo);
    try {
      sh('git', ['ls-remote', '--exit-code', 'origin', 'HEAD'], target.gitRoot);
      repoLine = { ok: true, what: `target ${target.label}: origin reachable` };
    } catch {
      repoLine = { ok: false, what: `target ${target.label}: can't reach its git origin`, fix: 'check the remote and your git credentials (workers push agent/<id> there)' };
    }
  } catch (e) {
    repoLine = { ok: false, what: 'target repo', fix: e instanceof Error ? e.message : String(e) };
  }
  checks.push(repoLine);

  for (const c of checks) log('join', `${c.ok ? 'ok  ' : 'FIX '} ${c.what}${c.fix && !c.ok ? `\n         -> ${c.fix}` : c.fix ? ` (${c.fix})` : ''}`);
  if (checks.some((c) => !c.ok)) throw new Error('fix the items above, then run join again');

  // Register (or re-register) the agent and keep its identity for the worker.
  const client = await connect({
    host: process.env.SPACETIME_HOST!,
    dbName: process.env.SPACETIME_DB_NAME!,
    token: savedToken(agentId),
    agent: { id: agentId, name: values.name ?? agentId, ownerDev: values.owner!, machine: values.machine!, model: 'claude-code', tokenBudget: 200_000 },
  });
  saveToken(agentId, client.token);
  await client.disconnect();
  if (editor) {
    await joinEditor(editor, agentId, values);
    return;
  }
  const repo = values.repo ? ` --repo ${values.repo}` : '';
  log('join', `registered ${agentId} (${values.name ?? agentId}, ${values.owner} on ${values.machine}); it shows on the dashboard now`);
  log('join', `start working:  npm run worker -- --id ${agentId}${repo} --wait     (takes tasks from the dashboard)`);
  log('join', `           or:  npm run worker -- --id ${agentId}${repo} --prompt "what to build"`);
}

/** --client: a task in the open run, then the editor's config files in --dir. */
async function joinEditor(client: ClientKind, agentId: string, values: { name?: string; owner?: string; machine?: string; repo?: string; dir?: string; task?: string }) {
  const dir = resolve(process.env.INIT_CWD ?? process.cwd(), values.dir ?? resolveTarget(REPO, values.repo).dir);
  if (!existsSync(dir)) throw new Error(`--dir ${dir} does not exist`);

  const conn = await adminConnect(['SELECT * FROM run', 'SELECT * FROM task']);
  const run = [...conn.db.run.iter()].find((r) => r.endedAt === undefined);
  if (!run) throw new Error('no open run; start one first: npm run session -- start');
  const description = values.task?.trim() || `Interactive ${client} session (${values.name ?? agentId})`;
  const mine = () => [...conn.db.task.iter()].find((t) => t.runId === run.id && t.agentId === agentId && (t.status === 'todo' || t.status === 'in_progress'));
  let task = mine();
  if (!task) {
    await conn.reducers.createTask({ title: description.length > 60 ? `${description.slice(0, 57)}...` : description, description, agentId, runId: run.id });
    task = await waitFor(mine, 'the new task');
  }
  if (task.status === 'todo') await conn.reducers.setTaskStatus({ taskId: task.id, status: 'in_progress' });
  conn.disconnect();

  const info = {
    monorepo: REPO, dir, agentId, name: values.name ?? agentId, owner: values.owner ?? '', machine: values.machine ?? '',
    taskId: task.id, host: process.env.SPACETIME_HOST!, dbName: process.env.SPACETIME_DB_NAME!, rules: joinedRules(client === 'claude-code'),
  };
  const created: string[] = [];
  for (const f of clientFiles(client, info)) {
    const current = existsSync(f.path) ? readFileSync(f.path, 'utf8') : undefined;
    if (current === undefined) created.push(f.path);
    mkdirSync(dirname(f.path), { recursive: true });
    writeFileSync(f.path, f.write(current));
    log('join', `${current === undefined ? 'wrote' : 'updated'} ${f.path}`);
  }
  excludeFromGit(dir, created);

  log('join', `${agentId} works on task ${task.id} in run ${run.id}: ${task.description}`);
  if (client === 'claude-code') {
    log('join', `start it:  cd ${dir} && claude      (Contract tools, rules and edit hooks load automatically)`);
  } else if (client === 'cursor') {
    log('join', `open ${dir} in Cursor; enable the "contract" MCP server in Settings > MCP if asked.`);
    log('join', `and run next to it:  npm run watch-agent -w @contract/worker -- --agent ${agentId} --dir ${dir}`);
  } else {
    log('join', 'add this to ~/.codex/config.toml, then run `codex` in that folder (AGENTS.md has the rules):');
    console.log('\n' + codexToml(info) + '\n');
    log('join', `and run next to it:  npm run watch-agent -w @contract/worker -- --agent ${agentId} --dir ${dir}`);
  }
}

/** New editor files are machine-specific: keep them out of `git status` without touching .gitignore. */
function excludeFromGit(dir: string, files: string[]) {
  if (!files.length) return;
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8' }).trim();
    const exclude = resolve(dir, execFileSync('git', ['rev-parse', '--git-path', 'info/exclude'], { cwd: dir, encoding: 'utf8' }).trim());
    const have = existsSync(exclude) ? readFileSync(exclude, 'utf8') : '';
    const add = files.map((f) => '/' + relative(top, f)).filter((l) => !have.split('\n').includes(l));
    if (add.length) {
      mkdirSync(dirname(exclude), { recursive: true });
      appendFileSync(exclude, `${have && !have.endsWith('\n') ? '\n' : ''}# contract join\n${add.join('\n')}\n`);
    }
  } catch { /* not a git folder: nothing to exclude */ }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then(() => process.exit(0))
    .catch((e: unknown) => {
      console.error(`[join] ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    });
}
