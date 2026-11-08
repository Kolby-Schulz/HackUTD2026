// contract-hook (spec section 11, "Automatic change reporting"). Owner: agents,
// using the mapper's parser. Claude Code runs it after every Edit|Write|MultiEdit via the
// PostToolUse hook in agents/worker/hook-settings.json.
//
// It re-parses the edited file, compares each symbol with the shared `symbol` rows for
// that file, and calls report_change for every created, removed or re-signed symbol, so
// Rule 1 (broken dependency) fires without the model having to remember.
//
// It also sends the edit itself to the live diff stream (report_edit, issue #24): the file's
// unified diff against the worktree's base commit plus the symbols the changed lines touch.
//
// It never calls upsert_symbols (a worktree must not overwrite the shared code map) and
// never uses the client's getContext (that logs savings). Always exits 0.
import { config as loadEnv } from 'dotenv';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signatureHash, type MappedSymbol } from '@contract/mapper';
import { readSavedToken } from '@contract/client';
import { repoFile } from './summary-hook.ts';

const MONOREPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export interface HookInput {
  session_id?: string;
  cwd: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input: { file_path?: string };
}

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

/** Who to report as: env from the worker, or a joined editor's saved identity (issue #22). */
export function hookAgent(): { agentId: string; token: string; host: string; dbName: string } | undefined {
  const agentId = process.env.CONTRACT_AGENT_ID;
  if (!agentId) return undefined; // not a Contract agent
  // Joined editors run hooks without the worker's env: take the monorepo's .env and saved token.
  loadEnv({ path: join(MONOREPO, '.env'), quiet: true });
  const token = process.env.CONTRACT_TOKEN || readSavedToken(MONOREPO, agentId);
  const host = process.env.SPACETIME_HOST;
  if (!token || !host) return undefined;
  return { agentId, token, host, dbName: process.env.SPACETIME_DB_NAME ?? 'contract' };
}

/**
 * Reports one edited file (repo-relative `rel` in `repoDir`): report_change for created,
 * removed or re-signed symbols, and report_edit with its diff. Used by the PostToolUse hook
 * and by the watcher sidecar for agents without hooks (agents/worker/src/watch.ts).
 */
export async function reportFile(o: { agentId: string; token: string; host: string; dbName: string; repoDir: string; rel: string; sessionKey: string; log?: (m: string) => void }) {
  const { agentId, repoDir, rel } = o;
  const say = o.log ?? ((m: string) => console.error(`contract-hook: ${m}`));
  const { mapFile, symbolRanges, symbolsTouched } = await import('@contract/mapper');
  const { symbols } = mapFile(resolve(repoDir, rel), { repoDir, edges: false });
  const diff = fileDiff(repoDir, rel);
  let touched: string[] = [];
  try {
    touched = symbolsTouched(symbolRanges(rel, readFileSync(resolve(repoDir, rel), 'utf8')), changedLines(diff));
  } catch { /* deleted or unreadable: send the diff without symbols */ }

  const { DbConnection } = await import('@contract/client');
  const conn = await new Promise<InstanceType<typeof DbConnection>>((ok, fail) => {
    const c: InstanceType<typeof DbConnection> = DbConnection.builder()
      .withUri(o.host)
      .withDatabaseName(o.dbName)
      .withToken(o.token)
      .onConnect(() => {
        c.subscriptionBuilder()
          .onApplied(() => ok(c))
          .onError((ctx) => fail(new Error(`subscription failed: ${String(ctx.event ?? 'unknown error')}`)))
          .subscribe([`SELECT * FROM symbol WHERE file = ${sql(rel)}`]);
      })
      .onConnectError((_ctx, err) => fail(err))
      .build();
  });
  try {
    const rows = [...conn.db.symbol.iter()].filter((r) => r.file === rel);
    for (const ch of detectChanges(symbols, rows)) {
      if (ch.kind === 'removed' && !firstRemoval(o.sessionKey, ch.symbolId)) continue;
      try {
        await conn.reducers.reportChange({ agentId, ...ch, newSignature: ch.newSignature });
        say(`reported ${ch.kind} ${ch.symbolId}`);
      } catch (e) {
        say(`report_change ${ch.symbolId} failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (diff.trim()) {
      await conn.reducers
        .reportEdit({ agentId, file: rel, diff, symbolIds: touched })
        .then(() => say(`reported edit ${rel}${touched.length ? ` (${touched.join(', ')})` : ''}`))
        .catch((e: unknown) => say(`report_edit failed: ${e instanceof Error ? e.message : String(e)}`));
    }
  } finally {
    conn.disconnect();
  }
}

async function main() {
  console.log = console.error; // the SpacetimeDB SDK logs to stdout
  const input = JSON.parse(readFileSync(0, 'utf8')) as HookInput;
  const agent = hookAgent();
  if (!agent) return; // not running under a Contract agent
  const repoDir = process.env.CONTRACT_REPO_DIR ?? input.cwd;
  const rel = editedFile(input, repoDir);
  if (!rel) return;
  await reportFile({ ...agent, repoDir, rel, sessionKey: input.session_id ?? agent.agentId });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  setTimeout(() => {
    console.error('contract-hook: timed out');
    process.exit(0);
  }, 10_000).unref();
  main()
    .catch((e: unknown) => console.error(`contract-hook: ${e instanceof Error ? e.message : String(e)}`))
    .finally(() => process.exit(0));
}
