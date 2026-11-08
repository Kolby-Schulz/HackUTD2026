// Live data: one subscription per table through spacetimedb/react (spec section 13: the
// dashboard never polls). Every panel reads from this one snapshot.
import { useEffect, useState } from 'react';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import { DbConnection, tables } from '@bindings/index.ts';
import type { Tables } from './model.ts';

/** Server address from the root .env (see vite.config.ts). A local server defaults to this
 *  page's host so a second laptop opening http://<demo-laptop>:5173 reaches the same port 3000. */
declare const __SPACETIME_HOST__: string;
declare const __SPACETIME_DB_NAME__: string;
export const SPACETIME_HOST = __SPACETIME_HOST__ || `ws://${location.hostname || 'localhost'}:3000`;
export const SPACETIME_DB_NAME = __SPACETIME_DB_NAME__;

// One saved identity per server: a token from the local server is rejected by maincloud (401).
const TOKEN_KEY = `contract.dashboard.token:${SPACETIME_HOST}/${SPACETIME_DB_NAME}`;

function savedToken(): string | undefined {
  try { return localStorage.getItem(TOKEN_KEY) ?? undefined; } catch { return undefined; }
}

export const connectionBuilder = DbConnection.builder()
  .withUri(SPACETIME_HOST)
  .withDatabaseName(SPACETIME_DB_NAME)
  .withToken(savedToken())
  .onConnect((_conn, _identity, token) => {
    try { localStorage.setItem(TOKEN_KEY, token); } catch { /* private window: a new identity each time is fine */ }
  })
  .onConnectError((_ctx, err) => console.warn('SpacetimeDB connect error', err));

export interface Live extends Tables { ready: boolean; connected: boolean; error?: string; now: number }

export function useLive(): Live {
  const conn = useSpacetimeDB();
  const [agents, r1] = useTable(tables.agent);
  const [tasks, r2] = useTable(tables.task);
  const [symbols, r3] = useTable(tables.symbol);
  const [edges, r4] = useTable(tables.symbolEdge);
  const [plans, r5] = useTable(tables.plan);
  const [planItems, r6] = useTable(tables.planItem);
  const [claims, r7] = useTable(tables.claim);
  const [changes, r8] = useTable(tables.change);
  const [conflicts, r9] = useTable(tables.conflict);
  const [decisions, r10] = useTable(tables.decision);
  const [instructions, r11] = useTable(tables.instruction);
  const [runs, r12] = useTable(tables.run);
  const [usage, r13] = useTable(tables.tokenUsage);
  const [savings, r14] = useTable(tables.tokenSaving);
  const [fileEdits, r15] = useTable(tables.fileEdit);
  const now = useNow(1000);
  return {
    agents, tasks, symbols, edges, plans, planItems, claims, changes, conflicts, decisions, instructions, runs, usage, savings, fileEdits,
    ready: r1 && r2 && r3 && r4 && r5 && r6 && r7 && r8 && r9 && r10 && r11 && r12 && r13 && r14 && r15,
    connected: conn.isActive, error: conn.connectionError?.message, now,
  };
}

/** The local clock, for the T+ timer and claim expiry. It reads nothing from the server. */
export function useNow(stepMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), stepMs);
    return () => clearInterval(id);
  }, [stepMs]);
  return now;
}
