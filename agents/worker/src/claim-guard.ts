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
// Thin like hook.ts: the question goes to this agent's sidecar (sidecar.ts), which answers from
// its live subscription in milliseconds. With no sidecar it falls back to report.ts's
// directGuard: parse the file and open a fresh connection (seconds).
//
// Fails open: no Contract env, a parse error or a server problem lets the edit through.
import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DbConnection } from '@contract/client';
import { askSidecar } from './sidecar-client.ts';

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

/** What the guard decided: 0 lets the edit through, 2 blocks it with `message`. */
export interface GuardVerdict {
  code: 0 | 2;
  message?: string;
}

/** The rows the guard reads, taken from whatever connection holds them. */
export interface GuardView {
  status?: string;
  /** An open or resolving conflict this agent is the paused side of. */
  conflict?: { id: bigint; symbolId: string };
  claims: ClaimRow[];
  owners: Map<string, string>;
  planActive: boolean;
  mapped: Set<string>;
}

/** Reads a GuardView from a connection subscribed to claim, symbol, agent, this agent's plans and conflicts. */
export function guardView(conn: DbConnection, agentId: string): GuardView {
  const c = [...conn.db.conflict.iter()].find((x) => x.agentB === agentId && (x.status === 'open' || x.status === 'resolving'));
  return {
    status: conn.db.agent.id.find(agentId)?.status,
    conflict: c ? { id: c.id, symbolId: c.symbolId } : undefined,
    claims: [...conn.db.claim.iter()].map((r) => ({ symbolId: r.symbolId, agentId: r.agentId, expiresAtMs: Number(r.expiresAt.microsSinceUnixEpoch / 1000n) })),
    owners: new Map([...conn.db.agent.iter()].map((a) => [a.id, [a.ownerDev, a.machine].filter(Boolean).join(', ')])),
    planActive: [...conn.db.plan.iter()].some((p) => p.agentId === agentId && p.active),
    mapped: new Set([...conn.db.symbol.iter()].map((s) => s.id)),
  };
}

/**
 * The guard's decision for an edit to `rel` touching `touched`. `retryable` marks the blocks
 * that only mean "your own plan/claim isn't in the cache yet", which a cache a few ms behind the
 * agent's own MCP call could produce; the sidecar re-checks those once before answering.
 */
export function guardVerdict(v: GuardView, o: { agentId: string; rel: string; touched: string[]; sourceFile: boolean; enforce: boolean; nowMs: number }): GuardVerdict & { retryable?: boolean } {
  if (!o.sourceFile && !o.touched.length) return { code: 0 };
  if (v.status === 'paused') return { code: 2, message: pausedMessage(v.conflict ? ` on conflict #${v.conflict.id} (${v.conflict.symbolId})` : '') };
  const blocks = blockingClaims(v.claims, o.touched, o.agentId, o.nowMs);
  if (blocks.length) return { code: 2, message: blockMessage(blocks, v.owners) };
  if (!o.enforce) return { code: 0 };
  if (o.sourceFile && !v.planActive) return { code: 2, message: planFirstMessage(o.rel), retryable: true };
  const unclaimed = unclaimedByMe(v.claims, o.touched, v.mapped, o.agentId, o.nowMs);
  if (unclaimed.length) return { code: 2, message: claimFirstMessage(unclaimed), retryable: true };
  return { code: 0 };
}

/** Body of POST /guard on the sidecar. */
export interface GuardRequest {
  input: GuardInput;
  repoDir: string;
  enforce: boolean;
}

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
  const agentId = process.env.CONTRACT_AGENT_ID;
  if (!agentId || !path) return 0;
  const enforce = (process.env.CONTRACT_PROTOCOL ?? 'enforce') !== 'off';
  const req: GuardRequest = { input, repoDir, enforce };
  const verdict =
    (await askSidecar<GuardVerdict>(agentId, '/guard', req, 3000)) ??
    (await (await import('./report.ts')).directGuard(input, repoDir, enforce));
  if (verdict.code === 2 && verdict.message) process.stderr.write(verdict.message + '\n');
  return verdict.code === 2 ? 2 : 0;
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
