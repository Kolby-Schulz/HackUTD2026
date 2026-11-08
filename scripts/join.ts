// scripts/join.ts: get a new laptop into a Contract run with one command (issue #19).
//   npm run join -- --agent agent-b --name "Agent B" [--owner Bob] [--repo <path|git URL>]
//
// Checks what a worker needs and says how to fix anything missing:
//   Node >= 22, .env with SPACETIME_HOST / SPACETIME_DB_NAME, the `claude` CLI and its login,
//   git and the target repo's origin. Then registers the agent (saving its identity so the
//   worker reuses it) and prints the command to start working.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { connect, resolveTarget } from '@contract/client';
import { log, REPO, savedToken, saveToken } from './lib.ts';

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
    },
  });
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
  const repo = values.repo ? ` --repo ${values.repo}` : '';
  log('join', `registered ${agentId} (${values.name ?? agentId}, ${values.owner} on ${values.machine}); it shows on the dashboard now`);
  log('join', `start working:  npm run worker -- --id ${agentId}${repo} --wait     (takes tasks from the dashboard)`);
  log('join', `           or:  npm run worker -- --id ${agentId}${repo} --prompt "what to build"`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then(() => process.exit(0))
    .catch((e: unknown) => {
      console.error(`[join] ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    });
}
