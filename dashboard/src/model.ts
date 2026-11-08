// Pure derivations from the live tables (spec sections 6 and 13) to what each panel shows.
// No React and no connection here, so it can be unit tested with plain rows.
import type * as R from '@bindings/types.ts';

export type Rows<T> = readonly T[];

export interface Tables {
  agents: Rows<R.Agent>;
  tasks: Rows<R.Task>;
  symbols: Rows<R.Symbol>;
  edges: Rows<R.SymbolEdge>;
  plans: Rows<R.Plan>;
  planItems: Rows<R.PlanItem>;
  claims: Rows<R.Claim>;
  changes: Rows<R.Change>;
  conflicts: Rows<R.Conflict>;
  decisions: Rows<R.Decision>;
  instructions: Rows<R.Instruction>;
  runs: Rows<R.Run>;
  usage: Rows<R.TokenUsage>;
  savings: Rows<R.TokenSaving>;
  fileEdits: Rows<R.FileEdit>;
}

/* ---------------- basics ---------------- */

type TimestampLike = { toMillis(): bigint };
export const ms = (t: TimestampLike): number => Number(t.toMillis());

/** Ids the spec reserves for Contract's own processes; everything else is a worker agent. */
export const SYSTEM_IDS = new Set(['coordinator', 'mapper', 'triage']);
const AGENT_COLORS = ['#58a6ff', '#f778ba', '#3fb950', '#ab7df8', '#f0883e', '#39c5cf'];
export const COORD_COLOR = '#9198a1';

/** Tokens we count: fresh prompt tokens plus completion. Cache reads are shown separately
 *  (TASKS.md "Scoreboard units": Claude Code re-sends ~40k cached tokens per turn). */
export function tokensOf(u: R.TokenUsage): number {
  return Math.max(0, u.promptTokens - u.cacheReadTokens) + u.completionTokens;
}

export function fmtK(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(Math.round(n));
}

export function fmtUsd(n: number): string {
  return '$' + n.toFixed(n < 10 ? 2 : 1);
}

/** Time since the run started, as mm:ss.s (the storyboard's T+ clock). */
export function fmtClock(msSinceStart: number, tenths = true): string {
  const t = Math.max(0, msSinceStart) / 1000;
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  const ss = tenths ? s.toFixed(1).padStart(4, '0') : String(Math.floor(s)).padStart(2, '0');
  return String(m).padStart(2, '0') + ':' + ss;
}

export function symbolName(id: string, symbols?: Rows<R.Symbol>): string {
  const row = symbols?.find((s) => s.id === id);
  if (row) return row.name;
  const i = id.lastIndexOf('#');
  return i >= 0 ? id.slice(i + 1) : id;
}

export function symbolFile(id: string): string {
  const i = id.lastIndexOf('#');
  return i >= 0 ? id.slice(0, i) : '';
}

/* ---------------- runs ---------------- */

export function latestRun(runs: Rows<R.Run>): R.Run | undefined {
  let best: R.Run | undefined;
  for (const r of runs) if (!best || r.id > best.id) best = r;
  return best;
}

export interface Window { start: number; end: number; live: boolean }

export function runWindow(run: R.Run | undefined, now: number): Window {
  if (!run) return { start: 0, end: now, live: false };
  const end = run.endedAt ? ms(run.endedAt) : now;
  return { start: ms(run.startedAt), end, live: !run.endedAt };
}

const inWin = (w: Window, t: number) => t >= w.start - 1 && t <= w.end + 1;

/* ---------------- people ---------------- */

export interface Person { id: string; name: string; letter: string; color: string }

export function people(agents: Rows<R.Agent>): Map<string, Person> {
  const map = new Map<string, Person>();
  const workers = agents.filter((a) => !SYSTEM_IDS.has(a.id)).slice().sort((a, b) => a.id.localeCompare(b.id));
  workers.forEach((a, i) => {
    const tail = a.name.replace(/^agent\s+/i, '').trim();
    map.set(a.id, { id: a.id, name: a.name || a.id, letter: (tail[0] || a.id[0] || '?').toUpperCase(), color: AGENT_COLORS[i % AGENT_COLORS.length] });
  });
  map.set('coordinator', { id: 'coordinator', name: 'Coordinator', letter: 'C', color: COORD_COLOR });
  map.set('operator', { id: 'operator', name: 'Operator', letter: 'O', color: COORD_COLOR });
  return map;
}

export function person(map: Map<string, Person>, id: string): Person {
  return map.get(id) ?? { id, name: id, letter: (id[0] || '?').toUpperCase(), color: COORD_COLOR };
}

/* ---------------- conflicts ---------------- */

export const CONFLICT_KIND: Record<string, { label: string; rule: string }> = {
  broken_dependency: { label: 'Broken dependency', rule: 'Rule 1' },
  duplicate: { label: 'Duplicate implementation', rule: 'Rule 2' },
  claim_contention: { label: 'Claim contention', rule: 'Rule 3' },
  plan_clash: { label: 'Plan clash', rule: 'Triage' },
};

export type StepState = 'done' | 'running' | 'waiting';
export interface Step { label: string; time: string; state: StepState }

export interface CaseView {
  id: bigint;
  key: string;
  kind: string;
  rule: string;
  symbolId: string;
  symbol: string;
  details: string;
  status: string;
  open: boolean;
  agentA: Person;
  agentB: Person;
  opened: string;
  openedAt: number;
  decidedAt?: number;
  owner?: Person;
  reason?: string;
  instructionsA?: string;
  instructionsB?: string;
  durationText?: string;
  steps: Step[];
}

export function cases(t: Tables, w: Window): CaseView[] {
  const ppl = people(t.agents);
  return t.conflicts
    .filter((c) => inWin(w, ms(c.createdAt)))
    .slice()
    .sort((a, b) => Number(b.id - a.id))
    .map((c) => {
      const k = CONFLICT_KIND[c.kind] ?? { label: c.kind, rule: '' };
      const d = t.decisions.find((x) => x.conflictId === c.id);
      const openedAt = ms(c.createdAt);
      const decidedAt = d ? ms(d.createdAt) : c.resolvedAt ? ms(c.resolvedAt) : undefined;
      const pushes = t.instructions.filter((i) => i.conflictId === c.id && decidedAt !== undefined && ms(i.createdAt) >= decidedAt - 1);
      const pushedAt = pushes.length ? Math.max(...pushes.map((i) => ms(i.createdAt))) : undefined;
      const open = c.status === 'open' || c.status === 'resolving';
      const rel = (x: number) => fmtClock(x - w.start);
      const steps: Step[] = [{ label: 'Detected', time: rel(openedAt), state: 'done' }];
      if (c.status === 'dismissed') {
        steps.push({ label: 'Dismissed', time: decidedAt ? rel(decidedAt) : '', state: 'done' }, { label: 'No push', time: '', state: 'done' });
      } else if (decidedAt !== undefined && !open) {
        steps.push({ label: 'Decided', time: rel(decidedAt), state: 'done' });
        steps.push(pushedAt !== undefined ? { label: 'Pushed', time: rel(pushedAt), state: 'done' } : { label: 'Push', time: 'waiting', state: 'running' });
      } else {
        steps.push({ label: c.status === 'resolving' ? 'Deciding' : 'Queued', time: c.status === 'resolving' ? 'running' : 'waiting', state: c.status === 'resolving' ? 'running' : 'waiting' });
        steps.push({ label: 'Push', time: 'waiting', state: 'waiting' });
      }
      return {
        id: c.id, key: String(c.id), kind: k.label, rule: k.rule, symbolId: c.symbolId, symbol: symbolName(c.symbolId, t.symbols),
        details: c.details, status: statusLabel(c.status), open,
        agentA: person(ppl, c.agentA), agentB: person(ppl, c.agentB),
        opened: rel(openedAt), openedAt, decidedAt,
        owner: d ? person(ppl, d.ownerAgent) : undefined, reason: d?.reason, instructionsA: d?.instructionsA, instructionsB: d?.instructionsB,
        durationText: decidedAt !== undefined && !open ? ((decidedAt - openedAt) / 1000).toFixed(1) + 's' : undefined,
        steps,
      };
    });
}

function statusLabel(s: string): string {
  if (s === 'resolving') return 'Coordinator resolving';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ---------------- agents ---------------- */

/** Workers used to report the raw hostname while the daemon lowercases it (and drops `.local`), so compare loosely. */
export function sameMachine(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const norm = (s: string) => s.toLowerCase().replace(/\.local$/, '').replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+/, '');
  return norm(a) === norm(b);
}

/**
 * Who the chat composer addresses before the user picks anyone: the assistant on the paired laptop,
 * else the first online agent on that laptop, else nobody. Never an agent on a teammate's laptop:
 * the database is shared, so "the first agent online" is often someone else's.
 */
export function defaultRecipient(agents: readonly Pick<AgentCard, 'id' | 'machine' | 'offline'>[], machine: string | undefined, assistantUp: boolean): string {
  if (assistantUp) return 'insync';
  return agents.find((a) => !a.offline && sameMachine(a.machine, machine))?.id ?? '';
}

export interface AgentCard {
  id: string;
  person: Person;
  ownerDev: string;
  machine: string;
  model: string;
  status: string; // Working | Paused | Done | Idle
  task: string;
  attempt: number;
  plan?: string;
  claims: string[];
  useful: number;
  wasted: number;
  total: number;
  budget: number;
  usePct: number;
  wastePct: number;
  waitingOn?: string; // conflict number the agent is paused on
  note?: string; // latest instruction it received
  messages: OperatorMsg[]; // operator messages sent to it this run, oldest first (issue #11)
  offline: boolean; // no heartbeat for OFFLINE_AFTER_MS: its laptop dropped off (issue #19)
  lastSeen: number; // ms timestamp of the last heartbeat
  lastEdit?: { file: string; ago: number }; // newest file_edit this run (issue #19 / #24)
}

/** Workers heartbeat every 15 s; three missed beats and the laptop counts as offline. */
export const OFFLINE_AFTER_MS = 45_000;

/** Operator messages are instruction rows from send_instruction, marked by this prefix. */
export const OPERATOR_PREFIX = 'Operator: ';
export const isOperator = (i: R.Instruction) => i.conflictId === undefined && i.text.startsWith(OPERATOR_PREFIX);
export interface OperatorMsg { id: string; text: string; acked: boolean; at: number }

const STATUS_LABEL: Record<string, string> = { idle: 'Idle', working: 'Working', paused: 'Paused', done: 'Done' };

export function agentCards(t: Tables, run: R.Run | undefined, now: number): AgentCard[] {
  const ppl = people(t.agents);
  const w = runWindow(run, now);
  const runUsage = run ? t.usage.filter((u) => u.runId === run.id) : [];
  return t.agents
    .filter((a) => !SYSTEM_IDS.has(a.id))
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((a) => {
      const task = a.currentTaskId !== undefined ? t.tasks.find((x) => x.id === a.currentTaskId) : undefined;
      const plan = t.plans.filter((p) => p.agentId === a.id && p.active).sort((p, q) => Number(q.id - p.id))[0];
      const claims = t.claims.filter((c) => c.agentId === a.id && ms(c.expiresAt) > now).map((c) => symbolName(c.symbolId, t.symbols));
      const mine = runUsage.filter((u) => u.agentId === a.id);
      const wasted = sum(mine.filter((u) => u.wasted).map(tokensOf));
      const useful = sum(mine.filter((u) => !u.wasted).map(tokensOf));
      const budget = Number(a.tokenBudget);
      const pending = t.conflicts.find((c) => (c.status === 'open' || c.status === 'resolving') && (c.agentA === a.id || c.agentB === a.id) && inWin(w, ms(c.createdAt)));
      const lastPush = t.instructions.filter((i) => i.agentId === a.id && inWin(w, ms(i.createdAt))).sort((p, q) => Number(q.id - p.id))[0];
      return {
        id: a.id, person: person(ppl, a.id), ownerDev: a.ownerDev, machine: a.machine, model: a.model,
        status: STATUS_LABEL[a.status] ?? a.status, task: task?.title ?? 'No task yet', attempt: task?.attempt ?? 1,
        plan: plan?.summary, claims, useful, wasted, total: useful + wasted, budget,
        usePct: budget ? Math.min(100, (useful / budget) * 100) : 0,
        wastePct: budget ? Math.min(100, (wasted / budget) * 100) : 0,
        waitingOn: a.status === 'paused' && pending ? String(pending.id) : undefined,
        note: lastPush?.text,
        messages: t.instructions
          .filter((i) => i.agentId === a.id && isOperator(i) && inWin(w, ms(i.createdAt)))
          .sort((p, q) => Number(p.id - q.id))
          .map((i) => ({ id: String(i.id), text: i.text.slice(OPERATOR_PREFIX.length), acked: i.acknowledged, at: ms(i.createdAt) })),
        offline: now - ms(a.lastHeartbeat) > OFFLINE_AFTER_MS,
        lastSeen: ms(a.lastHeartbeat),
        lastEdit: (() => {
          const e = (t.fileEdits ?? []).filter((x) => x.agentId === a.id && inWin(w, ms(x.createdAt))).sort((p, q) => Number(q.id - p.id))[0];
          return e ? { file: e.file.split('/').pop() ?? e.file, ago: Math.max(0, now - ms(e.createdAt)) } : undefined;
        })(),
      };
    });
}

export interface CoordView { status: string; note: string; tokens: number }

export function coordinator(t: Tables, run: R.Run | undefined, now: number): CoordView {
  const w = runWindow(run, now);
  const mine = t.conflicts.filter((c) => inWin(w, ms(c.createdAt)));
  const busy = mine.find((c) => c.status === 'resolving');
  const done = mine.filter((c) => c.status === 'resolved' || c.status === 'dismissed').length;
  const tokens = sum((run ? t.usage.filter((u) => u.runId === run.id) : []).filter((u) => u.purpose === 'coordination').map(tokensOf));
  return {
    status: busy ? 'Working' : 'Idle',
    note: busy ? `Resolving conflict #${busy.id}` : done ? `${done} conflict${done === 1 ? '' : 's'} resolved` : 'Waiting for a rule to fire',
    tokens,
  };
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/* ---------------- activity feed ---------------- */

export type Kind = 'plan' | 'claim' | 'change' | 'edit' | 'conflict' | 'decision' | 'instruction';

export interface FeedEvent {
  key: string;
  kind: Kind;
  at: number;
  time: string;
  actor: Person;
  verb: string;
  sub: string;
  conflictId?: bigint;
}

export function feed(t: Tables, w: Window): FeedEvent[] {
  const ppl = people(t.agents);
  const name = (id: string) => symbolName(id, t.symbols);
  const rel = (x: number) => fmtClock(x - w.start);
  const out: FeedEvent[] = [];

  const plans = t.plans.filter((p) => inWin(w, ms(p.createdAt))).slice().sort((a, b) => Number(a.id - b.id));
  const seenPlan = new Set<string>();
  for (const p of plans) {
    const items = t.planItems.filter((i) => i.planId === p.id);
    const by = (intent: string, word: string) => {
      const xs = items.filter((i) => i.intent === intent).map((i) => name(i.symbolId));
      return xs.length ? `${word} ${xs.join(', ')}` : '';
    };
    const sub = [by('modify', 'modifies'), by('create', 'creates'), by('depend', 'depends on')].filter(Boolean).join(' · ');
    out.push({ key: 'plan' + p.id, kind: 'plan', at: ms(p.createdAt), time: rel(ms(p.createdAt)), actor: person(ppl, p.agentId),
      verb: seenPlan.has(p.agentId) ? 'revised its plan' : 'published a plan', sub: sub || p.summary });
    seenPlan.add(p.agentId);
  }
  for (const c of t.claims) {
    const at = ms(c.claimedAt);
    if (!inWin(w, at)) continue;
    out.push({ key: 'claim' + c.symbolId, kind: 'claim', at, time: rel(at), actor: person(ppl, c.agentId), verb: `claimed ${name(c.symbolId)}`, sub: `held until T+${fmtClock(ms(c.expiresAt) - w.start, false)}` });
  }
  for (const c of t.changes) {
    const at = ms(c.createdAt);
    if (!inWin(w, at)) continue;
    const verb = c.kind === 'created' ? `created ${name(c.symbolId)}` : c.kind === 'removed' ? `removed ${name(c.symbolId)}` : `changed ${name(c.symbolId)} (${c.kind})`;
    out.push({ key: 'change' + c.id, kind: 'change', at, time: rel(at), actor: person(ppl, c.agentId), verb, sub: c.description || c.newSignature || '' });
  }
  for (const c of t.conflicts) {
    const at = ms(c.createdAt);
    if (!inWin(w, at)) continue;
    const k = CONFLICT_KIND[c.kind] ?? { label: c.kind, rule: '' };
    out.push({ key: 'conflict' + c.id, kind: 'conflict', at, time: rel(at), actor: person(ppl, 'coordinator'), verb: `opened a conflict: ${k.label}${k.rule ? ' · ' + k.rule : ''}`, sub: c.details, conflictId: c.id });
  }
  for (const d of t.decisions) {
    const at = ms(d.createdAt);
    if (!inWin(w, at)) continue;
    const c = t.conflicts.find((x) => x.id === d.conflictId);
    out.push({ key: 'decision' + d.id, kind: 'decision', at, time: rel(at), actor: person(ppl, 'coordinator'),
      verb: `decided: ${person(ppl, d.ownerAgent).name} owns ${c ? name(c.symbolId) : 'it'}`, sub: d.reason, conflictId: d.conflictId });
  }
  for (const i of t.instructions) {
    const at = ms(i.createdAt);
    if (!inWin(w, at)) continue;
    if (isOperator(i)) {
      out.push({ key: 'push' + i.id, kind: 'instruction', at, time: rel(at), actor: person(ppl, 'operator'),
        verb: `messaged ${person(ppl, i.agentId).name}${i.acknowledged ? ' · read' : ' · delivered'}`, sub: i.text.slice(OPERATOR_PREFIX.length) });
      continue;
    }
    out.push({ key: 'push' + i.id, kind: 'instruction', at, time: rel(at), actor: person(ppl, 'coordinator'), verb: `pushed to ${person(ppl, i.agentId).name}`, sub: i.text, conflictId: i.conflictId });
  }
  for (const e of t.fileEdits ?? []) {
    const at = ms(e.createdAt);
    if (!inWin(w, at)) continue;
    const file = e.file.split('/').pop() ?? e.file;
    const syms = e.symbolIds.map(name);
    out.push({ key: 'edit' + e.id, kind: 'edit', at, time: rel(at), actor: person(ppl, e.agentId),
      verb: `edited ${file}${syms.length ? ` (${syms.join(', ')})` : ''}`, sub: diffStat(e.diff) });
  }
  // newest first; within the same instant, the cause comes after (below) its effects
  return out.sort((a, b) => b.at - a.at || KIND_ORDER[b.kind] - KIND_ORDER[a.kind] || b.key.localeCompare(a.key));
}

/** Story order for events in the same instant: a plan leads to a claim, a change to a conflict, etc. */
const KIND_ORDER: Record<Kind, number> = { plan: 0, claim: 1, edit: 2, change: 2, conflict: 3, decision: 4, instruction: 5 };

/* ---------------- activity timeline: conflicts fold into threads ---------------- */

export interface Thread { case: CaseView; items: FeedEvent[]; at: number }
export type Entry = { type: 'event'; event: FeedEvent; at: number } | { type: 'thread'; thread: Thread; at: number };

export function timeline(events: FeedEvent[], cs: CaseView[]): Entry[] {
  const threads = new Map<string, Thread>();
  for (const c of cs) threads.set(c.key, { case: c, items: [], at: c.openedAt });
  const entries: Entry[] = [];
  for (const e of events) {
    const th = e.conflictId !== undefined ? threads.get(String(e.conflictId)) : undefined;
    if (th && (e.kind === 'conflict' || e.kind === 'decision' || e.kind === 'instruction')) {
      th.items.push(e);
      th.at = Math.max(th.at, e.at);
    } else entries.push({ type: 'event', event: e, at: e.at });
  }
  for (const th of threads.values()) {
    th.items.sort((a, b) => a.at - b.at || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
    entries.push({ type: 'thread', thread: th, at: th.at });
  }
  return entries.sort((a, b) => b.at - a.at);
}

/* ---------------- code map ---------------- */

export type NodeState = 'conflict' | 'changed' | 'claimed' | 'planned' | 'idle';

export interface MapNode {
  id: string;
  name: string;
  file: string;
  kind: string;
  version: number;
  owner?: Person;
  /** Who is on this symbol: the claim holder, or every agent planning to create it. */
  owners: Person[];
  state: NodeState;
  ghost: boolean;
  col: number;
  row: number;
}
export interface MapEdge { id: string; source: string; target: string; hot: boolean }

/** Symbols as nodes (callers left of their callees), planned creates as dashed ghosts. */
export function codeMap(t: Tables, w: Window, now: number): { nodes: MapNode[]; edges: MapEdge[] } {
  const ppl = people(t.agents);
  const ids = new Set(t.symbols.map((s) => s.id));
  const active = new Set(t.plans.filter((p) => p.active).map((p) => p.id));
  const ghosts = new Map<string, string[]>(); // symbol id -> agents planning to create it
  for (const i of t.planItems) {
    if (i.intent !== 'create' || !active.has(i.planId) || ids.has(i.symbolId)) continue;
    const xs = ghosts.get(i.symbolId) ?? [];
    if (!xs.includes(i.agentId)) xs.push(i.agentId);
    ghosts.set(i.symbolId, xs);
  }

  const hotSyms = new Set(t.conflicts.filter((c) => (c.status === 'open' || c.status === 'resolving') && inWin(w, ms(c.createdAt))).map((c) => c.symbolId));
  const changed = new Set(t.changes.filter((c) => inWin(w, ms(c.createdAt))).map((c) => c.symbolId));
  const claimBy = new Map<string, string>();
  for (const c of t.claims) if (ms(c.expiresAt) > now) claimBy.set(c.symbolId, c.agentId);

  const all = [...ids, ...ghosts.keys()];
  const edges = t.edges.filter((e) => (ids.has(e.callerId) || ghosts.has(e.callerId)) && (ids.has(e.calleeId) || ghosts.has(e.calleeId)));
  const callers = new Map<string, string[]>();
  for (const e of edges) callers.set(e.calleeId, [...(callers.get(e.calleeId) ?? []), e.callerId]);

  // column = longest chain of callers above a symbol
  const col = new Map<string, number>();
  const visiting = new Set<string>();
  const depth = (id: string): number => {
    if (col.has(id)) return col.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const d = Math.max(-1, ...(callers.get(id) ?? []).map(depth)) + 1;
    visiting.delete(id);
    col.set(id, d);
    return d;
  };
  all.forEach(depth);

  const rows = new Map<number, number>();
  const sorted = all.slice().sort((a, b) => (col.get(a)! - col.get(b)!) || symbolFile(a).localeCompare(symbolFile(b)) || a.localeCompare(b));
  const nodes: MapNode[] = sorted.map((id) => {
    const s = t.symbols.find((x) => x.id === id);
    const c = col.get(id)!;
    const r = rows.get(c) ?? 0;
    rows.set(c, r + 1);
    const ghost = !s;
    const ownerIds = claimBy.has(id) ? [claimBy.get(id)!] : ghost ? ghosts.get(id) ?? [] : [];
    const ownerId = ownerIds[0];
    const state: NodeState = hotSyms.has(id) ? 'conflict' : changed.has(id) ? 'changed' : ghost ? 'planned' : claimBy.has(id) ? 'claimed' : 'idle';
    return {
      id, name: s?.name ?? symbolName(id), file: s?.file ?? symbolFile(id), kind: s?.kind ?? 'function', version: s?.version ?? 0,
      owner: ownerId ? person(ppl, ownerId) : undefined, owners: ownerIds.map((x) => person(ppl, x)), state, ghost, col: c, row: r,
    };
  });
  return {
    nodes,
    edges: edges.map((e) => ({ id: String(e.id), source: e.callerId, target: e.calleeId, hot: hotSyms.has(e.calleeId) || hotSyms.has(e.callerId) })),
  };
}

/* ---------------- tokens ---------------- */

export interface TokenStats {
  total: number;
  useful: number;
  wasted: number;
  contract: number;
  cached: number;
  cost: number;
  byPurpose: Record<string, number>;
  series: { at: number; useful: number; wasted: number; contract: number }[]; // cumulative
  savings: { kind: string; label: string; how: string; tokens: number; count: number }[];
  savingsTotal: number;
}

export const SAVING_KIND: Record<string, { label: string; how: string }> = {
  early_stop: { label: 'Early stop', how: 'paused agents stop generating doomed code' },
  reuse: { label: 'Reuse lookup', how: 'reusing a helper instead of writing a duplicate' },
  context_slice: { label: 'Context slices', how: 'signatures of just the touched symbols, not whole files' },
  cache_hit: { label: 'Summary cache', how: 'a file summarized once, reused by every agent' },
  auto_resolve: { label: 'Auto-resolve', how: 'triage settled it without the coordinator model' },
};

export function tokenStats(t: Tables, run: R.Run | undefined): TokenStats {
  const rows = run ? t.usage.filter((u) => u.runId === run.id).slice().sort((a, b) => ms(a.createdAt) - ms(b.createdAt)) : [];
  let useful = 0, wasted = 0, contract = 0;
  const series: TokenStats['series'] = [];
  const byPurpose: Record<string, number> = {};
  for (const u of rows) {
    const n = tokensOf(u);
    if (u.purpose === 'coordination') contract += n; else if (u.wasted) wasted += n; else useful += n;
    byPurpose[u.purpose] = (byPurpose[u.purpose] ?? 0) + n;
    series.push({ at: ms(u.createdAt), useful, wasted, contract });
  }
  const sv = run ? t.savings.filter((s) => s.runId === run.id) : [];
  const savings = Object.keys(SAVING_KIND).filter((k) => k !== 'auto_resolve' || sv.some((s) => s.kind === k)).map((k) => {
    const xs = sv.filter((s) => s.kind === k);
    return { kind: k, ...SAVING_KIND[k], tokens: sum(xs.map((s) => s.tokensAvoidedEst)), count: xs.length };
  });
  return {
    total: useful + wasted + contract, useful, wasted, contract,
    cached: sum(rows.map((u) => u.cacheReadTokens)), cost: sum(rows.map((u) => u.costUsd)),
    byPurpose, series, savings, savingsTotal: sum(savings.map((s) => s.tokens)),
  };
}

/* ---------------- scoreboard: measured with vs without ---------------- */

export interface ModeSummary {
  runs: number;
  running: boolean; // only an unfinished run is available
  total: number;
  wasted: number;
  mergeFix: number;
  coordination: number;
  cost: number;
  conflictsCaught: number;
  mergeFixAgents: number;
}

export function modeSummary(t: Tables, mode: string, now: number): ModeSummary | undefined {
  const all = t.runs.filter((r) => r.mode === mode);
  const finished = all.filter((r) => r.endedAt);
  const use = finished.length ? finished : all.slice().sort((a, b) => Number(b.id - a.id)).slice(0, 1);
  if (!use.length) return undefined;
  const per = use.map((r) => {
    const s = tokenStats(t, r);
    const w = runWindow(r, now);
    const merge = t.usage.filter((u) => u.runId === r.id && u.purpose === 'merge_fix');
    return {
      total: s.total, wasted: s.wasted, mergeFix: sum(merge.map(tokensOf)), coordination: s.contract, cost: s.cost,
      conflictsCaught: t.conflicts.filter((c) => inWin(w, ms(c.createdAt))).length,
      mergeFixAgents: new Set(merge.map((u) => u.agentId)).size,
    };
  });
  const avg = (k: keyof (typeof per)[number]) => sum(per.map((p) => p[k])) / per.length;
  return {
    runs: finished.length, running: !finished.length,
    total: avg('total'), wasted: avg('wasted'), mergeFix: avg('mergeFix'), coordination: avg('coordination'), cost: avg('cost'),
    conflictsCaught: avg('conflictsCaught'), mergeFixAgents: avg('mergeFixAgents'),
  };
}

/* ---------------- live code (issue #24) ---------------- */

export interface EditView { id: string; agent: Person; file: string; symbolIds: string[]; symbols: string[]; diff: string; at: number; time: string; stat: string }

/** "+3 −1" for a unified diff (header lines excluded). */
export function diffStat(diff: string): string {
  let add = 0, del = 0;
  for (const l of diff.split('\n')) {
    if (l.startsWith('+++') || l.startsWith('---')) continue;
    if (l.startsWith('+')) add++;
    else if (l.startsWith('-')) del++;
  }
  return `+${add} −${del}`;
}

/** File edits in the window, newest first; `symbolId` narrows to edits that touched it. */
export function edits(t: Tables, w: Window, symbolId?: string): EditView[] {
  const ppl = people(t.agents);
  return (t.fileEdits ?? [])
    .filter((e) => inWin(w, ms(e.createdAt)) && (!symbolId || e.symbolIds.includes(symbolId)))
    .slice()
    .sort((a, b) => Number(b.id - a.id))
    .map((e) => ({
      id: String(e.id), agent: person(ppl, e.agentId), file: e.file, symbolIds: [...e.symbolIds], symbols: e.symbolIds.map((s) => symbolName(s, t.symbols)),
      diff: e.diff, at: ms(e.createdAt), time: fmtClock(ms(e.createdAt) - w.start), stat: diffStat(e.diff),
    }));
}

/* ---------------- replay (issue #27) ---------------- */

/**
 * The tables as they stood at time `at` (ms) in `run`: rows created later are dropped,
 * conflicts resolved later are open again, and agents' status is rebuilt from what had
 * happened by then (paused on an open Rule 1 conflict, working once active, done at the
 * end). Plans, claims and symbols are kept as stored: reset_demo_state clears them between
 * runs, so for older runs only the history tables (changes, conflicts, decisions, pushes,
 * tokens, edits) replay. Feed every panel the result with now = `at`.
 */
export function replayAt(t: Tables, run: R.Run, at: number): Tables {
  const start = ms(run.startedAt);
  const end = run.endedAt ? ms(run.endedAt) : Infinity;
  const upTo = <T extends { createdAt: TimestampLike }>(rows: Rows<T>) => rows.filter((r) => ms(r.createdAt) <= at && ms(r.createdAt) >= start);
  const conflicts = upTo(t.conflicts).map((c) =>
    c.resolvedAt && ms(c.resolvedAt) <= at ? c : { ...c, status: c.status === 'resolved' || c.status === 'dismissed' ? 'resolving' : c.status, resolvedAt: undefined },
  );
  const usage = t.usage.filter((u) => u.runId === run.id && ms(u.createdAt) <= at);
  const instructions = upTo(t.instructions);
  const active = new Set([...usage.map((u) => u.agentId), ...upTo(t.changes).map((c) => c.agentId), ...upTo(t.fileEdits ?? []).map((e) => e.agentId)]);
  const runTasks = t.tasks.filter((x) => x.runId === run.id);
  const agents = t.agents.map((a) => {
    if (SYSTEM_IDS.has(a.id)) return a;
    const paused = conflicts.some((c) => (c.status === 'open' || c.status === 'resolving') && c.agentB === a.id && c.kind === 'broken_dependency');
    const task = runTasks.filter((x) => x.agentId === a.id).sort((p, q) => Number(q.id - p.id))[0];
    const status = paused ? 'paused' : at >= end && task?.status === 'done' ? 'done' : active.has(a.id) ? 'working' : 'idle';
    return { ...a, status, currentTaskId: task?.id ?? a.currentTaskId, lastHeartbeat: { toMillis: () => BigInt(Math.round(at)) } as unknown as typeof a.lastHeartbeat };
  });
  return {
    ...t,
    agents,
    plans: upTo(t.plans),
    planItems: t.planItems.filter((i) => upTo(t.plans).some((p) => p.id === i.planId)),
    claims: t.claims.filter((c) => ms(c.claimedAt) <= at && ms(c.expiresAt) > at),
    changes: upTo(t.changes),
    conflicts,
    decisions: upTo(t.decisions),
    instructions: instructions.map((i) => ({ ...i, acknowledged: i.acknowledged && at >= end })),
    runs: t.runs.map((r) => (r.id === run.id && r.endedAt && ms(r.endedAt) > at ? { ...r, endedAt: undefined } : r)),
    usage,
    savings: t.savings.filter((s) => s.runId === run.id && ms(s.createdAt) <= at),
    fileEdits: upTo(t.fileEdits ?? []),
  };
}

/** Moments worth jumping to in a run: each conflict opening, ms since the run started. */
export function replayMarks(t: Tables, run: R.Run): { at: number; label: string }[] {
  const start = ms(run.startedAt);
  const end = run.endedAt ? ms(run.endedAt) : Infinity;
  return t.conflicts
    .filter((c) => ms(c.createdAt) >= start && ms(c.createdAt) <= end)
    .sort((a, b) => Number(a.id - b.id))
    .map((c) => ({ at: ms(c.createdAt) - start, label: `#${c.id} ${CONFLICT_KIND[c.kind]?.label ?? c.kind}` }));
}

/* ---------------- workbench (one-screen dashboard) ---------------- */

export type HistoryTone = 'agent' | 'plan' | 'change' | 'conflict' | 'resolved';
export interface HistoryItem { key: string; at: number; time: string; title: string; sub: string; tone: HistoryTone; color?: string }

/** What happened to one symbol in this run, oldest first: plans, claim, changes, conflicts, rulings. */
export function symbolHistory(t: Tables, w: Window, symbolId: string): HistoryItem[] {
  const ppl = people(t.agents);
  const rel = (x: number) => fmtClock(x - w.start);
  const out: HistoryItem[] = [];
  const INTENT: Record<string, string> = { modify: 'plans to change it', create: 'plans to create it', depend: 'depends on it' };
  for (const i of t.planItems) {
    if (i.symbolId !== symbolId) continue;
    const p = t.plans.find((x) => x.id === i.planId);
    if (!p || !inWin(w, ms(p.createdAt))) continue;
    const who = person(ppl, i.agentId);
    out.push({ key: 'plan' + i.id, at: ms(p.createdAt), time: rel(ms(p.createdAt)), title: `Planned by ${who.name}`, sub: INTENT[i.intent] ?? i.intent, tone: 'plan', color: who.color });
  }
  for (const c of t.claims) {
    if (c.symbolId !== symbolId || !inWin(w, ms(c.claimedAt))) continue;
    const who = person(ppl, c.agentId);
    out.push({ key: 'claim', at: ms(c.claimedAt), time: rel(ms(c.claimedAt)), title: `Claimed by ${who.name}`, sub: `held until T+${fmtClock(ms(c.expiresAt) - w.start, false)}`, tone: 'agent', color: who.color });
  }
  for (const c of t.changes) {
    if (c.symbolId !== symbolId || !inWin(w, ms(c.createdAt))) continue;
    const title = c.kind === 'created' ? 'Created' : c.kind === 'removed' ? 'Removed' : `Changed (${c.kind})`;
    out.push({ key: 'change' + c.id, at: ms(c.createdAt), time: rel(ms(c.createdAt)), title, sub: c.description || c.newSignature || `by ${person(ppl, c.agentId).name}`, tone: 'change' });
  }
  for (const c of t.conflicts) {
    if (c.symbolId !== symbolId || !inWin(w, ms(c.createdAt))) continue;
    const k = CONFLICT_KIND[c.kind] ?? { label: c.kind, rule: '' };
    out.push({ key: 'conflict' + c.id, at: ms(c.createdAt), time: rel(ms(c.createdAt)), title: `Conflict #${c.id} opened`,
      sub: `${k.label} between ${person(ppl, c.agentA).name} and ${person(ppl, c.agentB).name}`, tone: 'conflict' });
    const d = t.decisions.find((x) => x.conflictId === c.id);
    const doneAt = d ? ms(d.createdAt) : c.resolvedAt ? ms(c.resolvedAt) : undefined;
    if (doneAt !== undefined && (c.status === 'resolved' || c.status === 'dismissed')) {
      const secs = ((doneAt - ms(c.createdAt)) / 1000).toFixed(1);
      out.push({ key: 'resolved' + c.id, at: doneAt, time: rel(doneAt), title: c.status === 'dismissed' ? `Dismissed in ${secs}s` : `Resolved in ${secs}s`,
        sub: d ? `${person(ppl, d.ownerAgent).name} owns it` : 'no change needed', tone: 'resolved' });
    }
  }
  const order: Record<HistoryTone, number> = { plan: 0, agent: 1, change: 2, conflict: 3, resolved: 4 };
  return out.sort((x, y) => x.at - y.at || order[x.tone] - order[y.tone]);
}

export interface Savings {
  /** Tokens this run has spent so far. */
  current: number;
  /** Tokens the newest finished without-Contract run had spent at the same point, if there is one. */
  base?: number;
  saved?: number;
}

/** Tokens saved so far: the baseline (newest finished without_contract run) at the same elapsed
 *  time minus this run's spend. Measured, never estimated; no baseline means no number. */
export function savingsNow(t: Tables, run: R.Run | undefined, now: number): Savings {
  const w = runWindow(run, now);
  const current = run ? sum(t.usage.filter((u) => u.runId === run.id).map(tokensOf)) : 0;
  const baseRun = t.runs.filter((r) => r.mode === 'without_contract' && r.endedAt && r.id !== run?.id).sort((a, b) => Number(b.id - a.id))[0];
  // nothing to compare until this run has spent something: an idle run would look like a saving
  if (!run || run.mode === 'without_contract' || !baseRun || current === 0) return { current };
  const elapsed = w.end - w.start;
  const start = ms(baseRun.startedAt);
  const base = sum(t.usage.filter((u) => u.runId === baseRun.id && ms(u.createdAt) - start <= elapsed).map(tokensOf));
  return { current, base, saved: Math.max(0, base - current) };
}

export type Stage = 'Plan' | 'Code' | 'Merge';

/** Where the run is: planning until the first code change or edit, coding until it ends. */
export function runStage(t: Tables, run: R.Run | undefined, w: Window): Stage {
  if (run?.endedAt) return 'Merge';
  const coding = t.changes.some((c) => inWin(w, ms(c.createdAt))) || (t.fileEdits ?? []).some((e) => inWin(w, ms(e.createdAt)));
  return coding ? 'Code' : 'Plan';
}

/** The symbol the coordinator is working on: the newest open or resolving conflict's symbol. */
export function coordFocus(t: Tables, w: Window): { symbolId: string; conflict: string; resolving: boolean } | undefined {
  const c = t.conflicts
    .filter((x) => (x.status === 'open' || x.status === 'resolving') && inWin(w, ms(x.createdAt)))
    .sort((a, b) => Number(b.id - a.id))[0];
  return c ? { symbolId: c.symbolId, conflict: String(c.id), resolving: c.status === 'resolving' } : undefined;
}

/** Agents that have been called in this run: given a task in it, did anything in it (a plan,
 *  claim, change, edit, token row), or are working / paused right now. Registered workers that
 *  are just waiting stay out of the side bar until they get work. */
export function calledAgents(t: Tables, run: R.Run | undefined, now: number): Set<string> {
  const out = new Set<string>();
  if (!run) return out;
  const w = runWindow(run, now);
  for (const x of t.tasks) if (x.runId === run.id && x.agentId) out.add(x.agentId);
  for (const u of t.usage) if (u.runId === run.id) out.add(u.agentId);
  for (const p of t.plans) if (inWin(w, ms(p.createdAt))) out.add(p.agentId);
  for (const c of t.claims) if (inWin(w, ms(c.claimedAt))) out.add(c.agentId);
  for (const c of t.changes) if (inWin(w, ms(c.createdAt))) out.add(c.agentId);
  for (const e of t.fileEdits ?? []) if (inWin(w, ms(e.createdAt))) out.add(e.agentId);
  if (w.live) for (const a of t.agents) if (a.status === 'working' || a.status === 'paused') out.add(a.id);
  for (const id of SYSTEM_IDS) out.delete(id);
  return out;
}
