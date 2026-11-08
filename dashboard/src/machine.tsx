// Laptop daemons: the Control tab and the chat drive a laptop's `npm run control` daemon through
// SpacetimeDB (machine, machine_access, machine_command, machine_process, machine_chat), so they
// work the same from localhost and from the hosted dashboard. Nothing here talks to 127.0.0.1.
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import { tables } from '@bindings/index.ts';
import type * as R from '@bindings/types.ts';
import { SPACETIME_DB_NAME, SPACETIME_HOST, useNow } from './data.ts';
import { pairProof } from './sha256.ts';

/** A daemon that hasn't sent its heartbeat (every 10 s) for this long counts as offline. */
const ONLINE_MS = 30_000;
const PICK_KEY = 'contract.dashboard.machine';
/** How long a pairing link waits for its machine's row before it says why it can't pair. */
const LINK_WAIT_MS = 15_000;

export interface Proc {
  key: string;
  label: string;
  long: boolean;
  status: 'running' | 'exited' | 'stopped';
  code: number | null;
  startedAt: number;
  endedAt?: number;
  log: string[];
}
export interface RepoInfo { checks: string[]; install: string[]; languages: string[]; missing: { tool: string; neededBy: string[]; hint?: string }[]; dir: string }
export interface Status {
  machine: string;
  repo?: string;
  repoLabel?: string;
  repoInfo?: RepoInfo;
  needsSession?: boolean;
  processes: Proc[];
}
export interface ChatMessage { id: number; role: 'user' | 'assistant' | 'event'; text: string; at: number }

export interface MachineState {
  /** Machines this browser is paired with, online first. */
  mine: { id: string; online: boolean }[];
  /** Online machines this browser isn't paired with (shown so you know pairing is the missing step). */
  unpaired: string[];
  /** The machine the Control tab and chat drive, if one is paired and online. */
  current?: string;
  pick: (id: string) => void;
  status?: Status;
  chat: { messages: ChatMessage[]; busy: boolean };
  /** Queues a command for the current machine and resolves once its daemon ran it (throws its error). */
  send: (action: string, args?: object) => Promise<void>;
  /** Pairs this browser with a machine using the code its daemon printed. */
  pair: (machineId: string, code: string) => Promise<void>;
  /** The pairing in progress or just finished (from a #/pair link or the code box). */
  pairing?: Pairing;
}

export interface Pairing { machine: string; state: 'working' | 'done' | 'failed'; error?: string }

/** A #/pair?machine=…&code=… link: read once on load, then removed from the address bar. */
function takePairLink(): { machine: string; code: string } | undefined {
  const m = /^#\/pair\?(.*)$/.exec(location.hash);
  if (!m) return undefined;
  const q = new URLSearchParams(m[1]);
  history.replaceState(null, '', location.pathname + location.search);
  const machine = q.get('machine') ?? '';
  const code = q.get('code') ?? '';
  return machine && code ? { machine, code } : undefined;
}

const Ctx = createContext<MachineState | undefined>(undefined);

export function useMachine(): MachineState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useMachine needs <MachineProvider>');
  return v;
}

function readPick(): string | undefined {
  try { return localStorage.getItem(PICK_KEY) ?? undefined; } catch { return undefined; }
}

const ms = (t: { microsSinceUnixEpoch: bigint }) => Number(t.microsSinceUnixEpoch / 1000n);

export function MachineProvider({ children }: { children: ReactNode }) {
  const conn = useSpacetimeDB();
  const me = conn.identity;
  const [machines] = useTable(tables.machine);
  const [access] = useTable(tables.machineAccess);
  const [procRows] = useTable(tables.machineProcess);
  const [chatRows] = useTable(tables.machineChat);
  useTable(tables.machinePairRequest);
  useTable(tables.machineCommand); // keeps command rows in the client cache, so send() sees the daemon's result
  const now = useNow(5000);
  const [picked, setPicked] = useState(readPick);
  const [pairing, setPairing] = useState<Pairing>();
  const [link] = useState(takePairLink);
  const linkUsed = useRef(false);

  const value = useMemo<MachineState>(() => {
    const online = (m: R.Machine) => now - ms(m.heartbeatAt) < ONLINE_MS;
    const pairedIds = new Set(access.filter((a) => me && a.identity.equals(me)).map((a) => a.machineId));
    const ownIds = new Set(machines.filter((m) => me && m.identity.equals(me)).map((m) => m.id));
    const mine = machines
      .filter((m) => pairedIds.has(m.id) || ownIds.has(m.id))
      .map((m) => ({ id: m.id, online: online(m) }))
      .sort((a, b) => Number(b.online) - Number(a.online) || a.id.localeCompare(b.id));
    const unpaired = machines.filter((m) => online(m) && !pairedIds.has(m.id) && !ownIds.has(m.id)).map((m) => m.id);
    const current = mine.find((m) => m.id === picked && m.online)?.id ?? mine.find((m) => m.online)?.id;
    const row = machines.find((m) => m.id === current);
    let info: RepoInfo | undefined;
    try { info = row?.infoJson ? (JSON.parse(row.infoJson) as RepoInfo) : undefined; } catch { info = undefined; }
    const status: Status | undefined = row && {
      machine: row.id,
      repo: row.repo,
      repoLabel: row.repoLabel,
      repoInfo: info,
      needsSession: row.needsSession,
      processes: procRows.filter((p) => p.machineId === row.id).map((p) => ({
        key: p.procKey, label: p.label, long: p.long, status: p.status as Proc['status'], code: p.code ?? null,
        startedAt: p.startedAtMs, endedAt: p.endedAtMs, log: p.log ? p.log.split('\n') : [],
      })),
    };
    const messages = chatRows
      .filter((m) => m.machineId === current)
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((m) => ({ id: Number(m.id), role: m.role as ChatMessage['role'], text: m.text, at: m.atMs }));

    const send = async (action: string, args: object = {}) => {
      const c = conn.getConnection() as unknown as DaemonConn | null;
      if (!c || !me) throw new Error('not connected to SpacetimeDB');
      if (!current) throw new Error('no paired laptop is online; run npm run control and pair this browser');
      const before = new Set([...c.db.machineCommand.iter()].map((r) => r.id));
      await c.reducers.sendMachineCommand({ machineId: current, action, argsJson: JSON.stringify(args) });
      await waitForResult(c, me, current, before);
    };
    const pick = (id: string) => {
      setPicked(id);
      try { localStorage.setItem(PICK_KEY, id); } catch { /* private window */ }
    };
    const pair = async (machineId: string, code: string) => {
      const c = conn.getConnection() as unknown as DaemonConn | null;
      if (!c || !me) throw new Error('not connected to SpacetimeDB yet');
      setPairing({ machine: machineId, state: 'working' });
      try {
        await c.reducers.requestMachinePairing({ machineId, proof: pairProof(code, me.toHexString()) });
        await waitForPairing(c, me, machineId);
        setPairing({ machine: machineId, state: 'done' });
        pick(machineId);
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        setPairing({ machine: machineId, state: 'failed', error });
        throw e;
      }
    };
    return { mine, unpaired, current, pick, status, chat: { messages, busy: row?.chatBusy ?? false }, send, pair, pairing };
  }, [machines, access, procRows, chatRows, me, now, picked, conn, pairing]);

  // A pairing link: pair as soon as we're connected and the machine's row has arrived.
  const ready = !!me && conn.isActive && !!link && machines.some((m) => m.id === link.machine);
  useEffect(() => {
    if (!ready || !link || linkUsed.current) return;
    linkUsed.current = true;
    value.pair(link.machine, link.code).catch(() => undefined); // shown through `pairing`
  }, [ready, link, value]);
  useEffect(() => {
    if (link && !linkUsed.current) setPairing({ machine: link.machine, state: 'working' });
  }, [link]);
  // A link for a machine this dashboard never sees (another database, or a server without the
  // machine tables) would otherwise say "Pairing…" forever. If the row shows up later, it still pairs.
  const active = conn.isActive;
  useEffect(() => {
    if (!link || ready) return;
    const timer = setTimeout(() => {
      if (linkUsed.current) return;
      setPairing({
        machine: link.machine,
        state: 'failed',
        error: active
          ? `this dashboard can't see a laptop named ${link.machine} on ${SPACETIME_HOST} (database ${SPACETIME_DB_NAME}). The dashboard and npm run control must use the same SPACETIME_HOST and SPACETIME_DB_NAME, and the daemon must still be running`
          : `not connected to SpacetimeDB at ${SPACETIME_HOST} yet`,
      });
    }, LINK_WAIT_MS);
    return () => clearTimeout(timer);
  }, [link, ready, active]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

type CommandRow = R.MachineCommand;
interface DaemonConn {
  db: {
    machineAccess: { iter(): Iterable<R.MachineAccess> };
    machinePairRequest: { iter(): Iterable<R.MachinePairRequest> };
    machineCommand: { iter(): Iterable<CommandRow>; onUpdate(cb: (ctx: unknown, old: CommandRow, row: CommandRow) => void): void; removeOnUpdate(cb: (ctx: unknown, old: CommandRow, row: CommandRow) => void): void };
  };
  reducers: {
    sendMachineCommand(a: { machineId: string; action: string; argsJson: string }): Promise<void>;
    requestMachinePairing(a: { machineId: string; proof: string }): Promise<void>;
  };
}

/** Waits for the daemon to answer our pairing request: our access row appears (paired) or the request vanishes without one (wrong or expired code). */
async function waitForPairing(c: DaemonConn, me: NonNullable<ReturnType<typeof useSpacetimeDB>['identity']>, machineId: string): Promise<void> {
  const paired = () => [...c.db.machineAccess.iter()].some((a) => a.machineId === machineId && a.identity.equals(me));
  const pending = () => [...c.db.machinePairRequest.iter()].some((r) => r.machineId === machineId && r.identity.equals(me));
  const until = Date.now() + 15_000;
  let seenPending = false;
  while (Date.now() < until) {
    if (paired()) return;
    if (pending()) seenPending = true;
    else if (seenPending) {
      await new Promise((r) => setTimeout(r, 300)); // the access row can land a moment after the delete
      if (paired()) return;
      throw new Error('that code didn\'t work: it was wrong, already used, or older than 10 minutes. Press Enter in the daemon\'s terminal for a new one');
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`${machineId} didn't answer; is npm run control still running there?`);
}

/** Waits for the daemon to mark our newest command done or failed (its error becomes ours). */
function waitForResult(c: DaemonConn, me: NonNullable<ReturnType<typeof useSpacetimeDB>['identity']>, machineId: string, before: Set<bigint>): Promise<void> {
  const mineNew = () => [...c.db.machineCommand.iter()].filter((r) => !before.has(r.id) && r.machineId === machineId && r.sender.equals(me)).sort((a, b) => (a.id < b.id ? 1 : -1))[0];
  return new Promise((resolve, reject) => {
    const check = () => {
      const row = mineNew();
      if (!row || row.status === 'pending') return false;
      cleanup();
      if (row.status === 'failed') reject(new Error(row.error || 'failed'));
      else resolve();
      return true;
    };
    const onUpdate = () => void check();
    const timer = setTimeout(() => { cleanup(); reject(new Error(`${machineId} didn't answer within 20 s; is npm run control still running there?`)); }, 20_000);
    const cleanup = () => { clearTimeout(timer); c.db.machineCommand.removeOnUpdate(onUpdate); };
    c.db.machineCommand.onUpdate(onUpdate);
    check();
  });
}

/** Picks which paired laptop to drive when there's more than one. */
export function MachinePicker() {
  const { mine, current, pick } = useMachine();
  if (mine.length < 2) return null;
  return (
    <label className="muted" style={{ fontSize: 12, display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      Laptop
      <select value={current ?? ''} onChange={(e) => pick(e.target.value)}>
        {mine.map((m) => <option key={m.id} value={m.id} disabled={!m.online}>{m.id}{m.online ? '' : ' (offline)'}</option>)}
      </select>
    </label>
  );
}
