// Shared helpers for seed.ts, reset.ts and run-demo.ts. Owner: dashboard + demo.
import { config as loadEnv } from 'dotenv';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DbConnection } from '@contract/client';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
loadEnv({ path: join(REPO, '.env'), quiet: true });

export const DEMO_REPO = join(REPO, 'demo-repo');
export const WORKTREES = join(REPO, '.worktrees');
export const STATE_DIR = join(REPO, '.contract'); // gitignored; reset keeps it
export const RESULTS_DIR = join(STATE_DIR, 'runs');
export const TSX = join(REPO, 'node_modules/.bin/tsx');

/** The two demo agents and the TASKS key each one runs (spec section 14). */
export const AGENTS = [
  { id: 'agent-a', task: '1', title: 'Late fees on invoices' },
  { id: 'agent-b', task: '2', title: 'Receipt at checkout' },
] as const;

export type Mode = 'with_contract' | 'without_contract';
export const MODES: Mode[] = ['with_contract', 'without_contract'];

export function git(args: string[], cwd = REPO): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function log(scope: string, msg: string) {
  console.log(`[${scope}] ${msg}`);
}

/**
 * A plain SpacetimeDB connection (not an agent) for run bookkeeping: start_run, end_run,
 * create_task, mark_attempt_wasted, and reading token_usage. None of those reducers check
 * the caller's identity.
 */
export function adminConnect(queries: string[], timeoutMs = 10_000): Promise<DbConnection> {
  const host = process.env.SPACETIME_HOST;
  const dbName = process.env.SPACETIME_DB_NAME;
  if (!host || !dbName) throw new Error('SPACETIME_HOST and SPACETIME_DB_NAME must be set (see .env.example)');
  return new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error(`no response from ${host} (${dbName}) within ${timeoutMs} ms`)), timeoutMs);
    const conn: DbConnection = DbConnection.builder()
      .withUri(host)
      .withDatabaseName(dbName)
      .onConnect(() => {
        conn
          .subscriptionBuilder()
          .onApplied(() => (clearTimeout(timer), res(conn)))
          .onError((ctx) => (clearTimeout(timer), rej(new Error(`subscription failed: ${String(ctx.event ?? 'unknown')}`))))
          .subscribe(queries);
      })
      .onConnectError((_ctx, err) => (clearTimeout(timer), rej(err)))
      .build();
  });
}

/** Ends every run that is still open (start_run refuses while one is). Returns their ids. */
export async function endOpenRuns(conn: DbConnection): Promise<bigint[]> {
  const open = [...conn.db.run.iter()].filter((r) => r.endedAt === undefined).map((r) => r.id);
  for (const id of open) await conn.reducers.endRun({ runId: id });
  return open;
}

/** Waits until `check()` is true after reducer results reach the local cache. */
export async function waitFor<T>(check: () => T | undefined, what: string, timeoutMs = 5_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = check();
    if (v !== undefined) return v;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

/**
 * Persistent SpacetimeDB tokens per agent id. register_agent refuses an id held by another
 * identity for 60 s after its last heartbeat, so reusing the token lets the same agent run
 * again straight away (next demo run, merge-fix pass).
 */
const IDENTITIES = join(STATE_DIR, 'identities.json');
export function savedToken(agentId: string): string | undefined {
  if (!existsSync(IDENTITIES)) return undefined;
  return (JSON.parse(readFileSync(IDENTITIES, 'utf8')) as Record<string, string>)[agentId];
}
export function saveToken(agentId: string, token: string) {
  mkdirSync(STATE_DIR, { recursive: true });
  const all = existsSync(IDENTITIES) ? (JSON.parse(readFileSync(IDENTITIES, 'utf8')) as Record<string, string>) : {};
  all[agentId] = token;
  writeFileSync(IDENTITIES, JSON.stringify(all, null, 2) + '\n', { mode: 0o600 });
}
