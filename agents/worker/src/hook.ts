// contract-hook (spec section 11, "Automatic change reporting"). Owner: agents,
// using the mapper's parser. Claude Code runs it after every Edit|Write|MultiEdit via the
// PostToolUse hook in agents/worker/hook-settings.json.
//
// It re-parses the edited file, compares each symbol with the shared `symbol` rows for
// that file, and calls report_change for every created, removed or re-signed symbol, so
// Rule 1 (broken dependency) fires without the model having to remember.
//
// It never calls upsert_symbols (a worktree must not overwrite the shared code map) and
// never uses the client's getContext (that logs savings). Always exits 0.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signatureHash, type MappedSymbol } from '@contract/mapper';
import { repoFile } from './summary-hook.ts';

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

async function main() {
  console.log = console.error; // the SpacetimeDB SDK logs to stdout
  const input = JSON.parse(readFileSync(0, 'utf8')) as HookInput;
  const repoDir = process.env.CONTRACT_REPO_DIR ?? input.cwd;
  const rel = editedFile(input, repoDir);
  if (!rel) return;

  const agentId = process.env.CONTRACT_AGENT_ID;
  const token = process.env.CONTRACT_TOKEN;
  const host = process.env.SPACETIME_HOST;
  if (!agentId || !token || !host) return; // not running under a Contract worker

  const { mapFile } = await import('@contract/mapper');
  const { symbols } = mapFile(resolve(repoDir, rel), { repoDir, edges: false });

  const { DbConnection } = await import('@contract/client');
  const conn = await new Promise<InstanceType<typeof DbConnection>>((ok, fail) => {
    const c: InstanceType<typeof DbConnection> = DbConnection.builder()
      .withUri(host)
      .withDatabaseName(process.env.SPACETIME_DB_NAME ?? 'contract')
      .withToken(token)
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
    const sessionId = input.session_id ?? agentId;
    for (const ch of detectChanges(symbols, rows)) {
      if (ch.kind === 'removed' && !firstRemoval(sessionId, ch.symbolId)) continue;
      try {
        await conn.reducers.reportChange({ agentId, ...ch, newSignature: ch.newSignature });
        console.error(`contract-hook: reported ${ch.kind} ${ch.symbolId}`);
      } catch (e) {
        console.error(`contract-hook: report_change ${ch.symbolId} failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } finally {
    conn.disconnect();
  }
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
