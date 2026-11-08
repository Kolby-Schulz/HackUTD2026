// The heavy half of the edit hooks (contract-hook and the claim guard). Owner: agents.
//
// hook.ts and claim-guard.ts are thin: they hand the edit to this agent's sidecar
// (sidecar.ts) when one is running, and only import this file when it isn't. Everything here
// works on a DbConnection, so the sidecar runs it over its one long-lived connection while the
// fallback path opens a connection per call (the old behaviour, seconds per edit).
//
// Reporting an edit: re-parse the file, compare each symbol with the shared `symbol` rows for
// that file, report_change every created, removed or re-signed symbol (so Rule 1 fires without
// the model having to remember), then report_edit with the file's diff against the worktree's
// base commit plus the symbols the changed lines touch (live diff stream, issue #24).
// Never calls upsert_symbols (a worktree must not overwrite the shared code map) and never uses
// the client's getContext (that logs savings).
import { config as loadEnv } from 'dotenv';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { signatureHash, type MappedSymbol, type SymbolRange } from '@contract/mapper';
import { DbConnection, readSavedToken } from '@contract/client';
import { repoFile } from './summary-hook.ts';
import { guardVerdict, guardView, pendingLines, type GuardInput, type GuardVerdict } from './claim-guard.ts';
import { MONOREPO, type HookInput } from './sidecar-client.ts';

export type { HookInput } from './sidecar-client.ts';

/** The fields of a shared `symbol` row this hook looks at. */
export interface SymbolRow {
  id: string;
  signature: string;
  signatureHash: string;
}

export interface Change {
  symbolId: string;
  kind: 'signature' | 'created' | 'removed';
  newSignature?: string;
  description: string;
}

/**
 * Changes between a freshly mapped file and the shared rows for that file.
 * A row's signature_hash is the mapper's, but report_change only updates `signature`,
 * so a row whose signature already hashes to the new one was reported before.
 */
export function detectChanges(mapped: MappedSymbol[], rows: SymbolRow[]): Change[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: Change[] = [];
  for (const m of mapped) {
    const row = byId.get(m.id);
    if (!row) {
      out.push({ symbolId: m.id, kind: 'created', newSignature: m.signature, description: `contract-hook: created ${m.signature}` });
    } else if (row.signatureHash !== m.signatureHash && signatureHash(row.signature) !== m.signatureHash) {
      out.push({
        symbolId: m.id,
        kind: 'signature',
        newSignature: m.signature,
        description: `contract-hook: signature changed to ${m.signature}`,
      });
    }
  }
  const ids = new Set(mapped.map((m) => m.id));
  for (const r of rows) {
    if (!ids.has(r.id)) out.push({ symbolId: r.id, kind: 'removed', description: `contract-hook: removed ${r.id}` });
  }
  return out;
}

/** The edited file relative to the repo dir, or undefined for non-source / out-of-repo files. */
export function editedFile(input: HookInput, repoDir: string): string | undefined {
  const path = input.tool_input?.file_path;
  return path ? repoFile(path, input.cwd, repoDir) : undefined;
}

/**
 * The new-side line numbers a unified diff adds or changes. A pure deletion counts as the
 * line it was removed before, so deleting lines inside a function still touches it.
 */
export function changedLines(diff: string): number[] {
  const out = new Set<number>();
  let line = 0;
  for (const l of diff.split('\n')) {
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l);
    if (h) {
      line = Number(h[1]);
      continue;
    }
    if (!line || l.startsWith('+++') || l.startsWith('---')) continue;
    if (l.startsWith('+')) out.add(line++);
    else if (l.startsWith('-')) out.add(Math.max(1, line));
    else if (l.startsWith(' ')) line++;
  }
  return [...out].sort((a, b) => a - b);
}

/** Unified diff of `rel` in repoDir against HEAD (the agent's base); new files diff against /dev/null. */
export function fileDiff(repoDir: string, rel: string): string {
  const git = (args: string[]) => {
    try {
      return execFileSync('git', args, { cwd: repoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 8 << 20 });
    } catch (e) {
      // --no-index exits 1 when the files differ; its stdout is still the diff.
      return String((e as { stdout?: string }).stdout ?? '');
    }
  };
  const tracked = git(['ls-files', '--', rel]).trim() !== '';
  return tracked ? git(['diff', '--no-color', 'HEAD', '--', rel]) : git(['diff', '--no-color', '--no-index', '--', '/dev/null', rel]);
}

const sql = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** report_change leaves removed rows in place: remember them per session so they're reported once. */
function firstRemoval(sessionId: string, symbolId: string): boolean {
  const dir = join(tmpdir(), 'contract-hook', sessionId.replace(/[^\w-]/g, '_'));
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, createHash('sha1').update(symbolId).digest('hex')), symbolId, { flag: 'wx' });
    return true;
  } catch {
    return false;
  }
}

export interface HookAgent {
  agentId: string;
  token: string;
  host: string;
  dbName: string;
}

/** Who to report as: env from the worker, or a joined editor's saved identity (issue #22). */
export function hookAgent(): HookAgent | undefined {
  const agentId = process.env.CONTRACT_AGENT_ID;
  if (!agentId) return undefined; // not a Contract agent
  // Joined editors run hooks without the worker's env: take the monorepo's .env and saved token.
  loadEnv({ path: join(MONOREPO, '.env'), quiet: true });
  const token = process.env.CONTRACT_TOKEN || readSavedToken(MONOREPO, agentId);
  const host = process.env.SPACETIME_HOST;
  if (!token || !host) return undefined;
  return { agentId, token, host, dbName: process.env.SPACETIME_DB_NAME ?? 'contract' };
}

/** A one-off connection with `queries` applied (the fallback path; the sidecar keeps one open). */
export function openOnce(a: HookAgent, queries: string[]): Promise<DbConnection> {
  return new Promise((ok, fail) => {
    const c: DbConnection = DbConnection.builder()
      .withUri(a.host)
      .withDatabaseName(a.dbName)
      .withToken(a.token)
      .onConnect(() => {
        c.subscriptionBuilder()
          .onApplied(() => ok(c))
          .onError((ctx) => fail(new Error(`subscription failed: ${String(ctx.event ?? 'unknown error')}`)))
          .subscribe(queries);
      })
      .onConnectError((_ctx, err) => fail(err))
      .build();
  });
}

const since = (t: number) => Math.round(performance.now() - t);

/** What an edit looks like locally: its symbols, its diff, the symbols the diff touches. */
export interface FileAnalysis {
  symbols: MappedSymbol[];
  diff: string;
  touched: string[];
  /** Milliseconds spent parsing (mapper) and diffing (git). */
  mapMs: number;
  diffMs: number;
}

export async function analyzeFile(repoDir: string, rel: string): Promise<FileAnalysis> {
  const { mapFileAsync, symbolRangesAsync, symbolsTouched, useMapPolicy } = await import('@contract/mapper');
  useMapPolicy(repoDir); // the target's contract.json "map" (e.g. a repo whose code lives in scripts/)
  let t = performance.now();
  const { symbols } = await mapFileAsync(resolve(repoDir, rel), { repoDir, edges: false });
  const mapMs = since(t);
  t = performance.now();
  const diff = fileDiff(repoDir, rel);
  const diffMs = since(t);
  let touched: string[] = [];
  try {
    touched = symbolsTouched(await symbolRangesAsync(rel, readFileSync(resolve(repoDir, rel), 'utf8')), changedLines(diff));
  } catch { /* deleted or unreadable: send the diff without symbols */ }
  return { symbols, diff, touched, mapMs, diffMs };
}

/**
 * Sends one analysed edit over `conn` (subscribed to at least this file's symbol rows):
 * report_change per changed symbol, then report_edit. Returns the milliseconds the reducer
 * calls took (each awaits the server's reply).
 */
export async function sendReport(conn: DbConnection, agentId: string, rel: string, a: FileAnalysis, sessionKey: string, say: (m: string) => void): Promise<number> {
  const t = performance.now();
  const rows = [...conn.db.symbol.iter()].filter((r) => r.file === rel);
  const calls: Promise<unknown>[] = [];
  for (const ch of detectChanges(a.symbols, rows)) {
    if (ch.kind === 'removed' && !firstRemoval(sessionKey, ch.symbolId)) continue;
    // Sent back to back on one socket: the server runs them in order, so no need to wait between them.
    calls.push(conn.reducers.reportChange({ agentId, ...ch, newSignature: ch.newSignature }).then(
      () => say(`reported ${ch.kind} ${ch.symbolId}`),
      (e: unknown) => say(`report_change ${ch.symbolId} failed: ${e instanceof Error ? e.message : String(e)}`),
    ));
  }
  if (a.diff.trim()) {
    calls.push(conn.reducers.reportEdit({ agentId, file: rel, diff: a.diff, symbolIds: a.touched }).then(
      () => say(`reported edit ${rel}${a.touched.length ? ` (${a.touched.join(', ')})` : ''}`),
      (e: unknown) => say(`report_edit failed: ${e instanceof Error ? e.message : String(e)}`),
    ));
  }
  await Promise.all(calls);
  return since(t);
}

export interface ReportTimings {
  mapMs: number;
  diffMs: number;
  connectMs: number;
  reduceMs: number;
}

/**
 * Reports one edited file (repo-relative `rel` in `repoDir`) over a fresh connection. The
 * fallback when no sidecar runs for this agent; the sidecar does the same over its open one.
 */
export async function reportFile(o: HookAgent & { repoDir: string; rel: string; sessionKey: string; log?: (m: string) => void }): Promise<ReportTimings> {
  const say = o.log ?? ((m: string) => console.error(`contract-hook: ${m}`));
  const a = await analyzeFile(o.repoDir, o.rel);
  const t = performance.now();
  const conn = await openOnce(o, [`SELECT * FROM symbol WHERE file = ${sql(o.rel)}`]);
  const connectMs = since(t);
  try {
    const reduceMs = await sendReport(conn, o.agentId, o.rel, a, o.sessionKey, say);
    return { mapMs: a.mapMs, diffMs: a.diffMs, connectMs, reduceMs };
  } finally {
    conn.disconnect();
  }
}

/** The PostToolUse hook without a sidecar. */
export async function directReport(input: HookInput): Promise<void> {
  console.log = console.error; // the SpacetimeDB SDK logs to stdout
  const agent = hookAgent();
  if (!agent) return; // not running under a Contract agent
  const repoDir = process.env.CONTRACT_REPO_DIR ?? input.cwd;
  const rel = editedFile(input, repoDir);
  if (!rel) return;
  await reportFile({ ...agent, repoDir, rel, sessionKey: input.session_id ?? agent.agentId });
}

/** Mapped symbols the pending edit to `rel` touches, and whether `rel` is a mapped source file. */
export async function pendingTouched(input: GuardInput, repoDir: string, rel: string): Promise<{ touched: string[]; sourceFile: boolean }> {
  const { isMappable, symbolRangesAsync, symbolsTouched, useMapPolicy } = await import('@contract/mapper');
  useMapPolicy(repoDir); // the target's contract.json "map"
  const sourceFile = isMappable(rel);
  let touched: string[] = [];
  if (existsSync(resolve(repoDir, rel))) { // new files have no claims
    const current = readFileSync(resolve(repoDir, rel), 'utf8');
    const ranges: SymbolRange[] = await symbolRangesAsync(rel, current);
    touched = symbolsTouched(ranges, pendingLines(input, current));
  }
  return { touched, sourceFile };
}

/** The PreToolUse claim guard without a sidecar: a fresh connection per edit. */
export async function directGuard(input: GuardInput, repoDir: string, enforce: boolean): Promise<GuardVerdict> {
  const agent = hookAgent();
  if (!agent) return { code: 0 };
  const { agentId } = agent;
  const path = input.tool_input?.file_path;
  const rel = path ? repoFile(path, input.cwd, repoDir) : undefined;
  if (!rel) return { code: 0 };
  const { touched, sourceFile } = await pendingTouched(input, repoDir, rel);
  if (!sourceFile && !touched.length) return { code: 0 };
  const conn = await openOnce(agent, [
    ...touched.map((id) => `SELECT * FROM claim WHERE symbol_id = ${sql(id)}`),
    ...touched.map((id) => `SELECT * FROM symbol WHERE id = ${sql(id)}`),
    `SELECT * FROM plan WHERE agent_id = ${sql(agentId)}`,
    'SELECT * FROM agent',
    `SELECT * FROM conflict WHERE agent_b = ${sql(agentId)}`,
  ]);
  try {
    return guardVerdict(guardView(conn, agentId), { agentId, rel, touched, sourceFile, enforce, nowMs: Date.now() });
  } finally {
    conn.disconnect();
  }
}
