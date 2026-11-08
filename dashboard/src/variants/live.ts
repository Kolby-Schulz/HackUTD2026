// What the page shows for one screen, from the SpacetimeDB variant tables. Pure: store.ts turns binding rows
// into the plain records below (identities as hex, timestamps as ISO strings), so this is unit-tested without a
// server. Every reference to a design in the database (variant.id, parent, node_id, a mix's slots) is the full
// `<screen>/<node>` id; the page works with the bare node id (the folder name or mix id).
import { isSafeId } from './files.ts';
import { parentsOf } from './model.ts';
import type { CodeInfo } from './model.ts';
import type { Combo, NodeId, SlotId } from './types.ts';

export const dbId = (screen: string, node: NodeId) => `${screen}/${node}`;

/** The node id inside `screen`, or null for an id from another screen or a malformed one. */
export function nodeOf(screen: string, id: string | undefined): NodeId | null {
  const pre = `${screen}/`;
  if (!id?.startsWith(pre)) return null;
  const node = id.slice(pre.length);
  return isSafeId(node) ? node : null;
}

export interface VariantRec {
  id: string; screen: string; parent?: string; kind: string; author: string; model: string; status: string;
  tokens: number; costUsd: number; durationMs: number; commit: string; createdAt: string;
}
export interface MixRec { id: string; screen: string; title: string; note: string; slotsJson: string; author: string; createdAt: string }
export interface PickRec { screen: string; nodeId: string; by: string }
export interface VoteRec { screen: string; nodeId: string; voter: string }
export interface JobRec {
  id: bigint; screen: string; brief: string; model: string; parent?: string; status: string;
  agentId?: string; variantId?: string; error?: string; createdAt: string;
}
export interface Recs { variants: VariantRec[]; mixes: MixRec[]; picks: PickRec[]; votes: VoteRec[]; jobs: JobRec[] }

export type GenStatus = 'generating' | 'ready' | 'failed';
export interface Generated {
  id: NodeId; parent?: NodeId; status: GenStatus; author: string; model: string;
  tokens: number; costUsd: number; durationMs: number; commit: string; brief?: string; error?: string;
}

export interface ScreenState {
  combos: Combo[];
  final?: NodeId;
  votes: Map<NodeId, number>;
  myVote?: NodeId;
  /** This screen's jobs, newest first. */
  jobs: JobRec[];
  /** Agent-generated variants (root or child rows), by node id. */
  generated: Map<NodeId, Generated>;
}

const GEN: readonly string[] = ['generating', 'ready', 'failed'];

function parseSlots(screen: string, json: string, slots: readonly SlotId[]): Record<SlotId, NodeId> {
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { return {}; }
  const out: Record<SlotId, NodeId> = {};
  if (typeof raw !== 'object' || raw === null) return out;
  for (const [s, v] of Object.entries(raw)) {
    const node = typeof v === 'string' ? nodeOf(screen, v) : null;
    if (node && slots.includes(s)) out[s] = node;
  }
  return out;
}

/** A mix's slot map as stored in `variant_mix.slots` (full ids, slot order). */
export function slotsJson(screen: string, picks: Record<SlotId, NodeId>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(picks).map(([s, n]) => [s, dbId(screen, n)])));
}

export function screenState(screen: string, slots: readonly SlotId[], r: Recs, me: string | undefined): ScreenState {
  const combos: Combo[] = [];
  for (const m of r.mixes) {
    const id = m.screen === screen ? nodeOf(screen, m.id) : null;
    if (!id) continue;
    const picks = parseSlots(screen, m.slotsJson, slots);
    const combo: Combo = { id, screen, title: m.title.trim() || id, parents: parentsOf([...slots], picks), picks, createdAt: m.createdAt };
    if (m.note.trim()) combo.note = m.note.trim();
    combos.push(combo);
  }

  const pick = r.picks.find((p) => p.screen === screen);
  const final = nodeOf(screen, pick?.nodeId) ?? undefined;

  const votes = new Map<NodeId, number>();
  let myVote: NodeId | undefined;
  for (const v of r.votes) {
    const node = v.screen === screen ? nodeOf(screen, v.nodeId) : null;
    if (!node) continue;
    votes.set(node, (votes.get(node) ?? 0) + 1);
    if (me && v.voter === me) myVote = node;
  }

  const jobs = r.jobs.filter((j) => j.screen === screen).sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const jobFor = new Map(jobs.filter((j) => j.variantId).map((j) => [j.variantId!, j]));

  const generated = new Map<NodeId, Generated>();
  for (const v of r.variants) {
    const id = v.screen === screen && (v.kind === 'root' || v.kind === 'child') ? nodeOf(screen, v.id) : null;
    if (!id || !GEN.includes(v.status)) continue;
    const job = jobFor.get(v.id);
    generated.set(id, {
      id, parent: nodeOf(screen, v.parent) ?? undefined, status: v.status as GenStatus, author: v.author, model: v.model,
      tokens: v.tokens, costUsd: v.costUsd, durationMs: v.durationMs, commit: v.commit,
      ...(job ? { brief: job.brief } : {}), ...(job?.error ? { error: job.error } : {}),
    });
  }
  return { combos, final, votes, myVote, jobs, generated };
}

const shortTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/** "Generated by variant-mac with nemotron · 12.3k tokens · $0.04 · 41 s" */
export function genNote(g: Generated): string {
  const parts = [`Generated by ${g.author}${g.model ? ` with ${g.model}` : ''}`];
  if (g.tokens) parts.push(`${shortTokens(g.tokens)} tokens`);
  if (g.costUsd) parts.push(`$${g.costUsd.toFixed(2)}`);
  if (g.durationMs) parts.push(`${Math.round(g.durationMs / 1000)} s`);
  return parts.join(' · ');
}

/** What a pane shows for a generated variant whose code is not in this build. */
export function pendingText(g: Generated): string {
  if (g.status === 'generating') return `${g.author} is writing this variant…`;
  if (g.status === 'failed') return `Generation failed${g.error ? `: ${g.error}` : ''}`;
  return `Ready in commit ${g.commit.slice(0, 7)}. This build doesn’t have it yet: pull and reload, or wait for the next deploy.`;
}

/**
 * Graph inputs for generated variants. Code wins: a generated variant whose folder is in this build is the code
 * node with the agent's stats in its note; one that isn't (still generating, failed, or committed after this build)
 * becomes a placeholder node so it still shows in the lineage.
 */
export function withGenerated(code: CodeInfo[], generated: ReadonlyMap<NodeId, Generated>): CodeInfo[] {
  const have = new Set(code.map((c) => c.id));
  const merged = code.map((c) => {
    const g = generated.get(c.id);
    return g ? { ...c, note: c.note ? `${c.note} · ${genNote(g)}` : genNote(g) } : c;
  });
  for (const g of generated.values()) {
    if (have.has(g.id)) continue;
    merged.push({ id: g.id, title: g.brief ? truncate(g.brief, 48) : g.id, note: genNote(g), extends: g.parent, own: [], pending: pendingText(g), status: g.status });
  }
  return merged;
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
