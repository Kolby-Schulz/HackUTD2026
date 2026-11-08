// The variants page's link to SpacetimeDB: live rows from the variant tables (through the dashboard's one
// connection, data.ts) and the reducers that change them. Every pick, mix, vote and generation job goes through
// here, so all browsers and the variant agent see the same state.
import { useCallback, useMemo } from 'react';
import { useReducer, useSpacetimeDB, useTable } from 'spacetimedb/react';
import { reducers, tables } from '@bindings/index.ts';
import { ms, OFFLINE_AFTER_MS } from '../model.ts';
import { useNow } from '../data.ts';
import { dbId, slotsJson } from './live.ts';
import type { Recs } from './live.ts';
import type { Combo, NodeId } from './types.ts';

/** Variant agents register as `variant-<host>` (agents/variants). */
export const VARIANT_AGENT_PREFIX = 'variant-';

type Ts = { toDate(): Date };
const iso = (t: Ts) => t.toDate().toISOString();

export interface VariantsStore {
  recs: Recs;
  /** This browser's identity (hex), for "my vote". */
  me?: string;
  ready: boolean;
  connected: boolean;
  error?: string;
  /** Variant agents with a recent heartbeat. */
  agentsOnline: number;
  pick: (screen: string, node: NodeId | null) => Promise<void>;
  saveMix: (combo: Combo, parent: NodeId | null) => Promise<void>;
  deleteMix: (screen: string, id: NodeId) => Promise<void>;
  vote: (screen: string, node: NodeId | null) => Promise<void>;
  queueJob: (screen: string, parent: NodeId | null, brief: string) => Promise<void>;
}

export function useVariantsStore(): VariantsStore {
  const conn = useSpacetimeDB();
  const [variants, r1] = useTable(tables.variant);
  const [mixes, r2] = useTable(tables.variantMix);
  const [picks, r3] = useTable(tables.variantPick);
  const [votes, r4] = useTable(tables.variantVote);
  const [jobs, r5] = useTable(tables.variantJob);
  const [agents] = useTable(tables.agent);
  const now = useNow(5000);

  const recs = useMemo<Recs>(() => ({
    variants: variants.map((v) => ({
      id: v.id, screen: v.screen, parent: v.parent, kind: v.kind, author: v.author, model: v.model, status: v.status,
      tokens: Number(v.tokens), costUsd: v.costUsd, durationMs: Number(v.durationMs), commit: v.commit, createdAt: iso(v.createdAt),
    })),
    mixes: mixes.map((m) => ({
      id: m.id, screen: m.screen, title: m.title, note: m.note, slotsJson: m.slots, author: m.author.toHexString(), createdAt: iso(m.createdAt),
    })),
    picks: picks.map((p) => ({ screen: p.screen, nodeId: p.nodeId, by: p.by.toHexString() })),
    votes: votes.map((v) => ({ screen: v.screen, nodeId: v.nodeId, voter: v.voter.toHexString() })),
    jobs: jobs.map((j) => ({
      id: j.id, screen: j.screen, brief: j.brief, model: j.model, parent: j.parent, status: j.status,
      agentId: j.agentId, variantId: j.variantId, error: j.error, createdAt: iso(j.createdAt),
    })),
  }), [variants, mixes, picks, votes, jobs]);

  const agentsOnline = agents.filter((a) => a.id.startsWith(VARIANT_AGENT_PREFIX) && now - ms(a.lastHeartbeat) < OFFLINE_AFTER_MS).length;

  const pickR = useReducer(reducers.pickVariant);
  const saveR = useReducer(reducers.saveVariantMix);
  const deleteR = useReducer(reducers.deleteVariantMix);
  const voteR = useReducer(reducers.voteVariant);
  const queueR = useReducer(reducers.queueVariantJob);

  const pick = useCallback((screen: string, node: NodeId | null) => pickR({ screen, nodeId: node ? dbId(screen, node) : '' }), [pickR]);
  const saveMix = useCallback(
    (c: Combo, parent: NodeId | null) =>
      saveR({ id: dbId(c.screen, c.id), screen: c.screen, parent: parent ? dbId(c.screen, parent) : undefined, title: c.title, note: c.note ?? '', slotsJson: slotsJson(c.screen, c.picks) }),
    [saveR],
  );
  const deleteMix = useCallback((screen: string, id: NodeId) => deleteR({ id: dbId(screen, id) }), [deleteR]);
  const vote = useCallback((screen: string, node: NodeId | null) => voteR({ screen, nodeId: node ? dbId(screen, node) : '' }), [voteR]);
  const queueJob = useCallback(
    (screen: string, parent: NodeId | null, brief: string) => queueR({ screen, parent: parent ? dbId(screen, parent) : undefined, brief, model: '' }),
    [queueR],
  );

  return {
    recs, me: conn.identity?.toHexString(), ready: r1 && r2 && r3 && r4 && r5, connected: conn.isActive, error: conn.connectionError?.message,
    agentsOnline, pick, saveMix, deleteMix, vote, queueJob,
  };
}
