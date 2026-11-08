// Shared helpers for seed.ts, reset.ts and run-demo.ts. Owner: dashboard + demo.
import { config as loadEnv } from 'dotenv';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
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

/** This laptop's machine id: the hostname, lowercased (override with --machine or CONTRACT_MACHINE). */
export function machineId(name = hostname()): string {
  const id = name.toLowerCase().replace(/\.local$/, '').replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 64);
  return id || 'laptop';
}

/** The identities.json key the control daemon and the scripts share for this laptop's machine row. */
export const machineTokenKey = (id: string) => `machine:${id}`;

/**
 * An operator connection for run bookkeeping: start_run, end_run, create_task,
 * mark_attempt_wasted, reset_demo_state, and reading token_usage. Those reducers accept only
 * operators (a registered agent, a laptop's control daemon, or a dashboard paired with one),
 * so this connects as this laptop's `machine` row with the same saved token `npm run control`
 * uses (.contract/identities.json). Without a daemon it registers the machine row itself; the
 * daemon later re-registers it with the same identity, so nothing is lost. A machine row held
 * by another identity (a daemon from another checkout of this repo) is left alone: set
 * CONTRACT_MACHINE to a different name for this checkout.
 */
export function adminConnect(queries: string[], timeoutMs = 10_000): Promise<DbConnection> {
  const host = process.env.SPACETIME_HOST;
  const dbName = process.env.SPACETIME_DB_NAME;
  if (!host || !dbName) throw new Error('SPACETIME_HOST and SPACETIME_DB_NAME must be set (see .env.example)');
  const id = machineId(process.env.CONTRACT_MACHINE);
  const tokenKey = machineTokenKey(id);
  const machineQuery = `SELECT * FROM machine WHERE id = '${id.replace(/'/g, "''")}'`;
  return new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error(`no response from ${host} (${dbName}) within ${timeoutMs} ms`)), timeoutMs);
    const fail = (e: unknown) => (clearTimeout(timer), rej(e instanceof Error ? e : new Error(String(e))));
    const conn: DbConnection = DbConnection.builder()
      .withUri(host)
      .withDatabaseName(dbName)
      .withToken(savedToken(tokenKey))
      .onConnect((_ctx, identity, token) => {
        saveToken(tokenKey, token);
        conn
          .subscriptionBuilder()
          .onApplied(() => {
            const row = conn.db.machine.id.find(id);
            if (row && !row.identity.equals(identity)) {
              conn.disconnect();
              fail(new Error(
                `machine '${id}' belongs to another identity (npm run control from another checkout of this repo?). ` +
                  `Run the scripts from that checkout, or set CONTRACT_MACHINE=<another name> for this one.`,
              ));
              return;
            }
            const ready = row ? Promise.resolve() : conn.reducers.registerMachine({ id });
            ready.then(() => (clearTimeout(timer), res(conn)), fail);
          })
          .onError((ctx) => fail(new Error(`subscription failed: ${String(ctx.event ?? 'unknown')}`)))
          .subscribe(queries.includes(machineQuery) ? queries : [...queries, machineQuery]);
      })
      .onConnectError((_ctx, err) => fail(err))
      .build();
  });
}

/** Ends every run that is still open (start_run refuses while one is). Returns their ids. */
export async function endOpenRuns(conn: DbConnection): Promise<bigint[]> {
  const open = [...conn.db.run.iter()].filter((r) => r.endedAt === undefined).map((r) => r.id);
  for (const id of open) await conn.reducers.endRun({ runId: id });
  return open;
}

/**
 * Ends any open run, then clears per-run server state (code map, plans, claims, pending
 * instructions; see reset_demo_state) so nothing from the last run leaks into the next.
 * `conn` must subscribe to the run table.
 */
export async function resetServerState(conn: DbConnection): Promise<bigint[]> {
  const ended = await endOpenRuns(conn);
  await conn.reducers.resetDemoState({});
  return ended;
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
 * Keyed per server too: a maincloud token is rejected by a local server (401) and vice versa.
 * The worker (agents/worker/src/index.ts) uses the same file and keys.
 */
const IDENTITIES = join(STATE_DIR, 'identities.json');
export const identityKey = (agentId: string) => `${agentId}@${process.env.SPACETIME_DB_NAME}@${process.env.SPACETIME_HOST}`;
export function savedToken(agentId: string): string | undefined {
  if (!existsSync(IDENTITIES)) return undefined;
  return (JSON.parse(readFileSync(IDENTITIES, 'utf8')) as Record<string, string>)[identityKey(agentId)];
}
export function saveToken(agentId: string, token: string) {
  mkdirSync(STATE_DIR, { recursive: true });
  const all = existsSync(IDENTITIES) ? (JSON.parse(readFileSync(IDENTITIES, 'utf8')) as Record<string, string>) : {};
  all[identityKey(agentId)] = token;
  writeFileSync(IDENTITIES, JSON.stringify(all, null, 2) + '\n', { mode: 0o600 });
}
