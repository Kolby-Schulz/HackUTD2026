// Pure lineage model: one graph per screen holding code variants and mixes, slot resolution,
// the sidebar tree and mix creation. No React, no DOM; unit-tested in model.test.ts.
import type { Combo, NodeId, SlotId } from './types.ts';

/** A code variant as the graph sees it (the registry builds these from src/designs/). */
export interface CodeInfo {
  id: NodeId;
  title: string;
  note?: string;
  extends?: NodeId;
  /** Slots this variant fills itself. */
  own: SlotId[];
  path?: string;
  /** An agent-generated variant whose code is not in this build: what to show instead of the design. */
  pending?: string;
  /** Generation status, for agent-generated variants. */
  status?: 'generating' | 'ready' | 'failed';
}

export interface GNode {
  id: NodeId;
  kind: 'code' | 'combo';
  title: string;
  note?: string;
  /** Code: [extends] or []. Mix: source nodes, most slots first. */
  parents: NodeId[];
  own: SlotId[];
  picks?: Record<SlotId, NodeId>;
  createdAt?: string;
  path?: string;
  pending?: string;
  status?: 'generating' | 'ready' | 'failed';
}

export interface Graph {
  screen: string;
  slots: SlotId[];
  nodes: Map<NodeId, GNode>;
}

export function buildGraph(screen: string, slots: SlotId[], code: CodeInfo[], combos: Combo[]): Graph {
  const nodes = new Map<NodeId, GNode>();
  for (const c of [...code].sort((a, b) => a.id.localeCompare(b.id))) {
    nodes.set(c.id, { id: c.id, kind: 'code', title: c.title, note: c.note, parents: c.extends ? [c.extends] : [], own: c.own, path: c.path, pending: c.pending, status: c.status });
  }
  const mine = combos.filter((c) => c.screen === screen).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const m of mine) {
    if (nodes.has(m.id)) continue; // a code folder wins over a mix with the same id
    nodes.set(m.id, { id: m.id, kind: 'combo', title: m.title, note: m.note, parents: m.parents, own: [], picks: m.picks, createdAt: m.createdAt });
  }
  return { screen, slots, nodes };
}

/** A copy of the graph with one extra (unsaved) node, for previewing a draft mix. */
export function withNode(g: Graph, node: GNode): Graph {
  const nodes = new Map(g.nodes);
  nodes.set(node.id, node);
  return { ...g, nodes };
}

/** The code variant whose component renders `slot` for node `id`, or null if none (or a cycle). */
export function resolveSlot(g: Graph, id: NodeId, slot: SlotId, seen = new Set<NodeId>()): NodeId | null {
  const n = g.nodes.get(id);
  if (!n || seen.has(id)) return null;
  seen.add(id);
  if (n.kind === 'code') {
    if (n.own.includes(slot)) return id;
    return n.parents[0] ? resolveSlot(g, n.parents[0], slot, seen) : null;
  }
  const src = n.picks?.[slot] ?? n.parents[0];
  return src ? resolveSlot(g, src, slot, seen) : null;
}

export interface Resolved {
  sources: Record<SlotId, NodeId | null>;
  missing: SlotId[];
}

export function resolveAll(g: Graph, id: NodeId): Resolved {
  const sources: Record<SlotId, NodeId | null> = {};
  const missing: SlotId[] = [];
  for (const s of g.slots) {
    const src = resolveSlot(g, id, s);
    sources[s] = src;
    if (!src) missing.push(s);
  }
  return { sources, missing };
}

/** Distinct values of `picks`, the node giving the most slots first (ties: first slot order). */
export function parentsOf(slots: SlotId[], picks: Record<SlotId, NodeId>): NodeId[] {
  const count = new Map<NodeId, { n: number; first: number }>();
  slots.forEach((s, i) => {
    const p = picks[s];
    if (!p) return;
    const c = count.get(p);
    if (c) c.n++;
    else count.set(p, { n: 1, first: i });
  });
  return [...count.entries()].sort((a, b) => b[1].n - a[1].n || a[1].first - b[1].first).map(([id]) => id);
}

/** If every slot is picked from the same node, that node; otherwise null. */
export function singleSource(slots: SlotId[], picks: Record<SlotId, NodeId>): NodeId | null {
  const ps = parentsOf(slots, picks);
  return ps.length === 1 && slots.every((s) => picks[s] === ps[0]) ? ps[0] : null;
}

/** "Bold: nav, cta · Calm: hero, grid, footer" (slot ids, or human labels when given). */
export function comboTitle(g: Graph, picks: Record<SlotId, NodeId>, labels?: Record<SlotId, string>): string {
  const name = (s: SlotId) => labels?.[s] ?? s;
  return parentsOf(g.slots, picks)
    .map((p) => `${g.nodes.get(p)?.title ?? p}: ${g.slots.filter((s) => picks[s] === p).map(name).join(', ')}`)
    .join(' · ');
}

export function makeCombo(g: Graph, picks: Record<SlotId, NodeId>, o: { id: NodeId; title?: string; note?: string; now?: Date; labels?: Record<SlotId, string> }): Combo {
  const full: Record<SlotId, NodeId> = {};
  for (const s of g.slots) if (picks[s]) full[s] = picks[s];
  const combo: Combo = {
    id: o.id,
    screen: g.screen,
    title: o.title?.trim() || comboTitle(g, full, o.labels),
    parents: parentsOf(g.slots, full),
    picks: full,
    createdAt: (o.now ?? new Date()).toISOString(),
  };
  if (o.note?.trim()) combo.note = o.note.trim();
  return combo;
}

export interface TreeRow {
  id: NodeId;
  depth: number;
  /** Parents other than the one this row is nested under (shown as chips). */
  extra: NodeId[];
}

/** Depth-first rows: each node sits under its first parent; roots are nodes with no known parent. */
export function treeRows(g: Graph): TreeRow[] {
  const kids = new Map<NodeId | null, NodeId[]>();
  for (const n of g.nodes.values()) {
    const p = n.parents[0] && g.nodes.has(n.parents[0]) && n.parents[0] !== n.id ? n.parents[0] : null;
    const list = kids.get(p) ?? [];
    list.push(n.id);
    kids.set(p, list);
  }
  const rows: TreeRow[] = [];
  const seen = new Set<NodeId>();
  const walk = (id: NodeId, depth: number) => {
    if (seen.has(id)) return;
    seen.add(id);
    rows.push({ id, depth, extra: g.nodes.get(id)!.parents.slice(1) });
    for (const k of kids.get(id) ?? []) walk(k, depth + 1);
  };
  for (const r of kids.get(null) ?? []) walk(r, 0);
  for (const id of g.nodes.keys()) walk(id, 0); // nodes caught in a parent cycle
  return rows;
}

/** Nodes that list `id` as a parent or pick a slot from it. */
export function childrenOf(g: Graph, id: NodeId): NodeId[] {
  return [...g.nodes.values()]
    .filter((n) => n.id !== id && (n.parents.includes(id) || Object.values(n.picks ?? {}).includes(id)))
    .map((n) => n.id);
}

/** Human-readable problems: unknown parents, unfilled slots, cycles. */
export function problems(g: Graph): string[] {
  const out: string[] = [];
  for (const n of g.nodes.values()) {
    for (const p of n.parents) if (!g.nodes.has(p)) out.push(`${n.id}: parent "${p}" does not exist`);
    for (const [s, p] of Object.entries(n.picks ?? {})) if (!g.nodes.has(p)) out.push(`${n.id}: slot "${s}" comes from missing "${p}"`);
    const { missing } = resolveAll(g, n.id);
    // A generated variant still on its way has no code yet; that is a status, not a problem in the code.
    if (missing.length && !n.pending) out.push(`${n.id}: nothing fills ${missing.map((s) => `"${s}"`).join(', ')}`);
  }
  return out;
}
