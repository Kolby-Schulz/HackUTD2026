// Claim guard (docs/spec-additions-live-code.md part C, issue #24). Owner: agents.
// Claude Code runs it before every Edit|Write|MultiEdit (PreToolUse hook in
// agents/worker/hook-settings.json). It works out which mapped symbols the pending edit
// touches; if another agent holds an unexpired claim on one, it exits 2 with a message on
// stderr, which makes Claude Code block the edit and show the model that message.
//
// It also blocks every edit while this agent is paused (Rule 1, issue #22): a worker stops on
// its own, but a joined interactive Claude Code session needs the hook to make it wait.
//
// With CONTRACT_ALLOWED_PATHS (comma-separated folder prefixes, issue #29 judge tasks) it
// also refuses edits to any file outside those folders.
//
// Protocol enforcement (spec section 11, found running Contract on itself: an agent with a
// one-file task skipped declare_plan and claim_symbol entirely, so Rule 1 had nothing to
// match): an edit to a mapped source file needs an active plan from this agent, and an edit
// that touches a symbol in the shared code map needs this agent's own live claim on it.
// Both block with a message that names the tool to call. CONTRACT_PROTOCOL=off turns this
// part off (the other-agent claim and pause checks stay).
//
// Fails open: no Contract env, a parse error or a server problem lets the edit through.
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SymbolRange } from '@contract/mapper';
import { repoFile } from './summary-hook.ts';
import { hookAgent } from './hook.ts';

export interface GuardInput {
  cwd: string;
  tool_name?: string;
  tool_input: {
    file_path?: string;
    old_string?: string;
    replace_all?: boolean;
    content?: string;
    edits?: { old_string: string; replace_all?: boolean }[];
  };
}

export interface ClaimRow {
  symbolId: string;
  agentId: string;
  expiresAtMs: number;
}

/** 1-based line numbers of `text` covered by each occurrence of `needle` (first only unless all). */
function linesOf(text: string, needle: string, all: boolean): number[] {
  if (!needle) return [];
  const out: number[] = [];
  let from = 0;
  for (;;) {
    const i = text.indexOf(needle, from);
    if (i < 0) break;
    const start = text.slice(0, i).split('\n').length;
    const end = start + needle.split('\n').length - 1;
    for (let l = start; l <= end; l++) out.push(l);
    if (!all) break;
    from = i + needle.length;
  }
  return out;
}

/** Lines of `before` that a full rewrite to `after` changes (between the common prefix and suffix). */
function rewrittenLines(before: string, after: string): number[] {
  const a = before.split('\n');
  const b = after.split('\n');
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  const out: number[] = [];
  for (let l = p + 1; l <= a.length - s; l++) out.push(l);
  if (!out.length && a.length !== b.length) out.push(Math.min(p + 1, a.length)); // pure insertion
  return out;
}

/** Lines of the current file the pending tool call would change. */
export function pendingLines(input: GuardInput, current: string): number[] {
  const ti = input.tool_input ?? {};
  if (input.tool_name === 'Write') return ti.content === undefined ? [] : rewrittenLines(current, ti.content);
  if (input.tool_name === 'MultiEdit') return (ti.edits ?? []).flatMap((e) => linesOf(current, e.old_string, !!e.replace_all));
  return linesOf(current, ti.old_string ?? '', !!ti.replace_all);
}

/** Claims by other agents, still live at `nowMs`, on any of `symbolIds`. */
export function blockingClaims(claims: ClaimRow[], symbolIds: string[], me: string, nowMs: number): ClaimRow[] {
  const ids = new Set(symbolIds);
  return claims.filter((c) => ids.has(c.symbolId) && c.agentId !== me && c.expiresAtMs > nowMs);
}

/** Whether `rel` (repo-relative, '/'-separated) is inside one of the allowed prefixes. */
export function pathAllowed(rel: string | undefined, allowed: string[]): boolean {
  if (!allowed.length) return true;
  if (!rel) return false; // outside the repo
  return allowed.some((p) => rel === p.replace(/\/$/, '') || rel.startsWith(p.endsWith('/') ? p : `${p}/`));
}

export function pausedMessage(conflictHint: string): string {
  return [
    `Contract: you are paused${conflictHint}. Another agent changed code your plan depends on, and the coordinator is deciding who changes what.`,
    "Don't edit anything yet. Call get_instructions (Contract MCP tool) until it gives you the coordinator's decision, follow it, then continue.",
  ].join('\n');
}

export function blockMessage(blocks: ClaimRow[], owners: Map<string, string>): string {
  const lines = blocks.map((c) => {
    const name = c.symbolId.split('#')[1] ?? c.symbolId;
    const mins = Math.max(1, Math.round((c.expiresAtMs - Date.now()) / 60_000));
    return `- ${name} (${c.symbolId}) is claimed by ${c.agentId}${owners.get(c.agentId) ? ` (${owners.get(c.agentId)})` : ''} for about ${mins} more min.`;
  });
  return [
    'Contract claim guard: this edit touches code another agent is working on.',
    ...lines,
    "Don't edit it. Use it as is (get_context / find_existing), list it as a 'depend' in declare_plan, or put your change in your own function. If you really need it changed, say so and wait for the coordinator.",
  ].join('\n');
}

/** Touched symbols that are in the shared code map (`mapped`) without a live claim by `me`. */
export function unclaimedByMe(claims: ClaimRow[], touched: string[], mapped: Set<string>, me: string, nowMs: number): string[] {
  const mine = new Set(claims.filter((c) => c.agentId === me && c.expiresAtMs > nowMs).map((c) => c.symbolId));
  return touched.filter((id) => mapped.has(id) && !mine.has(id));
}

export function planFirstMessage(rel: string): string {
  return [
    `Contract: declare your plan before editing ${rel}.`,
    'Call get_context on the functions your task names, find_existing before writing a new helper, then declare_plan',
    "with every function you will modify, create or depend on (intent 'depend' for code you call but don't change).",
    'Then claim_symbol each function you will change, and retry this edit.',
  ].join('\n');
}

export function claimFirstMessage(ids: string[]): string {
  return [
    'Contract: claim before you change it. This edit changes:',
    ...ids.map((id) => `- ${id}`),
    'Call claim_symbol for each of these, then retry the edit. If a claim fails, call get_instructions and follow them.',
  ].join('\n');
}

const sql = (s: string) => `'${s.replace(/'/g, "''")}'`;

async function main(): Promise<number> {
  // stderr is the message Claude Code shows the model, so keep the SpacetimeDB SDK's logs out of it.
  console.log = console.info = console.debug = () => {};
  const input = JSON.parse(readFileSync(0, 'utf8')) as GuardInput;
  const repoDir = process.env.CONTRACT_REPO_DIR ?? input.cwd;
  const path = input.tool_input?.file_path;
  // Allowed folders first: a local check, no server needed.
  const allowed = (process.env.CONTRACT_ALLOWED_PATHS ?? '').split(',').map((p) => p.trim()).filter(Boolean);
  if (path && allowed.length) {
    const inRepo = relative(repoDir, isAbsolute(path) ? path : resolve(input.cwd, path)).split(sep).join('/');
    if (inRepo.startsWith('..') || isAbsolute(inRepo) || !pathAllowed(inRepo, allowed)) {
      process.stderr.write(`Contract guard rail: this task may only edit files under ${allowed.join(', ')}; ${path} is outside. Put the change there or explain why you can't.\n`);
      return 2;
    }
  }
  const agent = hookAgent();
  if (!agent) return 0;
  const { agentId, token, host } = agent;
  const rel = path ? repoFile(path, input.cwd, repoDir) : undefined;
  if (!rel) return 0;

  const { isMappable, symbolRangesAsync, symbolsTouched, useMapPolicy } = await import('@contract/mapper');
  useMapPolicy(repoDir); // the target's contract.json "map"
  const enforce = (process.env.CONTRACT_PROTOCOL ?? 'enforce') !== 'off';
  const sourceFile = isMappable(rel);
  let touched: string[] = [];
  if (existsSync(resolve(repoDir, rel))) { // new files have no claims
    const current = readFileSync(resolve(repoDir, rel), 'utf8');
    const ranges: SymbolRange[] = await symbolRangesAsync(rel, current);
    touched = symbolsTouched(ranges, pendingLines(input, current));
  }
  if (!sourceFile && !touched.length) return 0;

  const { DbConnection } = await import('@contract/client');
  const conn = await new Promise<InstanceType<typeof DbConnection>>((ok, fail) => {
    const c: InstanceType<typeof DbConnection> = DbConnection.builder()
      .withUri(host)
      .withDatabaseName(agent.dbName)
      .withToken(token)
      .onConnect(() => {
        c.subscriptionBuilder()
          .onApplied(() => ok(c))
          .onError((ctx) => fail(new Error(`subscription failed: ${String(ctx.event ?? 'unknown error')}`)))
          .subscribe([
            ...touched.map((id) => `SELECT * FROM claim WHERE symbol_id = ${sql(id)}`),
            ...touched.map((id) => `SELECT * FROM symbol WHERE id = ${sql(id)}`),
            `SELECT * FROM plan WHERE agent_id = ${sql(agentId)}`,
            'SELECT * FROM agent',
            `SELECT * FROM conflict WHERE agent_b = ${sql(agentId)}`,
          ]);
      })
      .onConnectError((_ctx, err) => fail(err))
      .build();
  });
  try {
    if (conn.db.agent.id.find(agentId)?.status === 'paused') {
      const c = [...conn.db.conflict.iter()].find((x) => x.status === 'open' || x.status === 'resolving');
      process.stderr.write(pausedMessage(c ? ` on conflict #${c.id} (${c.symbolId})` : '') + '\n');
      return 2;
    }
    const claims = [...conn.db.claim.iter()].map((c) => ({
      symbolId: c.symbolId,
      agentId: c.agentId,
      expiresAtMs: Number(c.expiresAt.microsSinceUnixEpoch / 1000n),
    }));
    const blocks = blockingClaims(claims, touched, agentId, Date.now());
    if (blocks.length) {
      const owners = new Map([...conn.db.agent.iter()].map((a) => [a.id, [a.ownerDev, a.machine].filter(Boolean).join(', ')]));
      process.stderr.write(blockMessage(blocks, owners) + '\n');
      return 2;
    }
    if (!enforce) return 0;
    if (sourceFile && ![...conn.db.plan.iter()].some((p) => p.agentId === agentId && p.active)) {
      process.stderr.write(planFirstMessage(rel) + '\n');
      return 2;
    }
    const mapped = new Set([...conn.db.symbol.iter()].map((s) => s.id));
    const unclaimed = unclaimedByMe(claims, touched, mapped, agentId, Date.now());
    if (unclaimed.length) {
      process.stderr.write(claimFirstMessage(unclaimed) + '\n');
      return 2;
    }
    return 0;
  } finally {
    conn.disconnect();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  setTimeout(() => {
    console.error('claim-guard: timed out; allowing the edit');
    process.exit(0);
  }, 8_000).unref();
  main()
    .then((code) => process.exit(code))
    .catch((e: unknown) => {
      console.error(`claim-guard: ${e instanceof Error ? e.message : String(e)}; allowing the edit`);
      process.exit(0);
    });
}
