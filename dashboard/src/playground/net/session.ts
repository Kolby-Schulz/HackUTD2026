// A live board session: connects a DocStore and a presence bus to SpacetimeDB through a BoardTransport.
//
// Ops: every op an owned actor commits goes to the outbox and out through push_ops; every board_op row is folded in
// seq order (rows this client made are already applied and are only acknowledged). The first sync loads the
// snapshot, then the ops after it. A later sync whose snapshot is past what this client applied (ops were compacted
// while it was offline) reloads the snapshot and re-applies this client's unconfirmed ops on top.
// Presence: owned actors' cursors go out as move_cursor events (at most every CURSOR_MS), the rest of their presence
// through set_board_presence (at most every PRESENCE_MS). Other actors' rows and events land in the presence bus.
//
// Owned actors must be fresh for this session (a new id per tab or per agent run): op ids are `${actor}:${n}`, and
// two writers counting one actor's ops would collide.
import { restoreSeqs } from '../core/ids';
import type { ActorId, DocStore, OpEnvelope, Presence, PresenceBus, SavedBoard } from '../core/types';
import { decodeOp, encodeOp, OpTooLargeError } from './opcodec';
import { createOutbox } from './outbox';
import type {
  BoardActorRow, BoardCursorEvent, BoardOpRow, BoardPresenceRow, BoardSnapshotRow, BoardTransport, NetActorKind,
  NetStatus, PushOp, RowChange,
} from './types';

export const CURSOR_MS = 50;
export const PRESENCE_MS = 200;

export interface LocalActor { id: ActorId; kind: NetActorKind; name: string; color: string; agentId?: string }

export type NetError =
  | { kind: 'op-too-large'; opId: string; size: number }
  | { kind: 'push-refused'; count: number; message: string }
  | { kind: 'join-refused'; actor: ActorId; message: string }
  | { kind: 'actor-taken'; actor: ActorId }
  | { kind: 'bad-snapshot'; message: string };

export interface SessionState { status: NetStatus; synced: boolean; pending: number }

export interface Timers {
  setTimeout(f: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
}

export interface BoardSessionOpts {
  boardId: string;
  doc: DocStore;
  presence: PresenceBus & { remove(actor: ActorId): void };
  transport: BoardTransport;
  actors?: readonly LocalActor[];
  onError?: (e: NetError) => void;
  /** Another client's actor joined or changed (show its cursor, name and colour). */
  onRemoteActor?: (row: BoardActorRow) => void;
  timers?: Timers;
}

export interface BoardSession {
  state(): SessionState;
  subscribe(cb: (s: SessionState) => void): () => void;
  /** Start acting as another actor on this connection (an agent the host spawned). */
  join(actor: LocalActor): void;
  /** Stop acting as an actor and remove it from the board. */
  leave(actor: ActorId): Promise<void>;
  dispose(): void;
}

const defaultTimers: Timers = { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Presence fields as set_board_presence takes them. */
export function encodePresence(p: Presence) {
  return {
    selection: p.selection?.length ? JSON.stringify(p.selection) : '',
    status: p.state ?? '',
    tool: p.tool ?? '',
    detail: p.detail ?? '',
    typing: p.typing ?? '',
    viewport: p.viewport ? JSON.stringify(p.viewport) : '',
  };
}

/** A presence row back into a bus update (cursor position comes from board_cursor events, not this row). */
export function decodePresence(r: BoardPresenceRow): Partial<Presence> & { actor: ActorId } {
  const out: Partial<Presence> & { actor: ActorId } = { actor: r.actor };
  out.selection = parseJson<string[]>(r.selection, (v) => Array.isArray(v) && v.every((s) => typeof s === 'string')) ?? [];
  const vp = parseJson<Presence['viewport']>(r.viewport, (v) => typeof v === 'object' && v !== null && ['x', 'y', 'w', 'h', 'z'].every((k) => Number.isFinite((v as Record<string, unknown>)[k])));
  if (vp) out.viewport = vp;
  if (r.status) out.state = r.status as Presence['state'];
  if (r.tool) out.tool = r.tool;
  out.detail = r.detail;
  out.typing = r.typing;
  return out;
}

function parseJson<T>(s: string, ok: (v: unknown) => boolean): T | undefined {
  if (!s) return undefined;
  try { const v: unknown = JSON.parse(s); return ok(v) ? (v as T) : undefined; } catch { return undefined; }
}

function parseSnapshot(row: BoardSnapshotRow): SavedBoard {
  const b = JSON.parse(row.doc) as SavedBoard;
  if (b?.format !== 'contract-board' || !Array.isArray(b.shapes)) throw new Error('not a contract-board snapshot');
  return b;
}

export function connectBoard(o: BoardSessionOpts): BoardSession {
  const { boardId, doc, presence, transport } = o;
  const timers = o.timers ?? defaultTimers;
  const report = (e: NetError) => o.onError?.(e);

  const owned = new Map<ActorId, LocalActor>();
  const joined = new Set<ActorId>();          // owned actors whose board_actor row carries this identity
  const outbox = createOutbox();
  const unconfirmed = new Map<string, OpEnvelope>();   // our envelopes, by op id, until the server has them
  let logCursor = doc.log().length;           // ops before the session are local history, not sent
  let synced = false;
  let firstSync = true;
  let appliedSeq = -1n;
  let buffered: BoardOpRow[] = [];
  let snapshot: BoardSnapshotRow | null = null;
  let disposed = false;
  const stateSubs = new Set<(s: SessionState) => void>();

  const state = (): SessionState => ({ status: transport.status(), synced, pending: outbox.size() });
  const emit = () => { const s = state(); stateSubs.forEach((f) => f(s)); };
  const live = () => !disposed && transport.status() === 'live';
  const mineHex = () => transport.identity()?.toHexString() ?? null;

  // ---- outgoing ops ----
  function capture() {
    const fresh = doc.log(logCursor);
    logCursor += fresh.length;
    const add: PushOp[] = [];
    for (const env of fresh) {
      if (!owned.has(env.actor)) continue;
      try { add.push(encodeOp(env)); unconfirmed.set(env.opId, env); }
      catch (e) { if (e instanceof OpTooLargeError) report({ kind: 'op-too-large', opId: e.opId, size: e.size }); else throw e; }
    }
    if (add.length) { outbox.add(add); scheduleFlush(); emit(); }
  }

  let flushQueued = false;
  let pushing = false;
  let epoch = 0;                              // bumped on every status change: a push left hanging by a dropped
  function scheduleFlush() {                  // connection must not block the next connection's pushes
    if (flushQueued) return;
    flushQueued = true;
    queueMicrotask(() => { flushQueued = false; void flush(); });
  }
  async function flush() {
    if (pushing) return;
    pushing = true;
    const mine = epoch;
    try {
      while (live() && synced && mine === epoch) {
        const batch = outbox.take((op) => joined.has(actorOf(op)));
        if (!batch.length) break;
        try { await transport.pushOps(boardId, batch); }
        catch (e) {
          if (mine !== epoch || !live()) { outbox.retry(batch); break; }
          const dropped = outbox.drop(batch);
          for (const op of dropped) unconfirmed.delete(op.opId);
          report({ kind: 'push-refused', count: dropped.length, message: errText(e) });
          emit();
        }
      }
    } finally { if (mine === epoch) pushing = false; }
  }
  const actorOf = (op: PushOp) => unconfirmed.get(op.opId)?.actor ?? op.opId.slice(0, op.opId.lastIndexOf(':'));

  // ---- incoming ops ----
  function fold(rows: readonly BoardOpRow[]) {
    const sorted = [...rows].filter((r) => r.boardId === boardId && r.seq > appliedSeq).sort((a, b) => (a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0));
    if (!sorted.length) return;
    capture();                    // queue local ops made since the last change event before the cursor moves
    const envs: OpEnvelope[] = [];
    const acked: string[] = [];
    for (const r of sorted) {
      if (unconfirmed.has(r.opId)) { acked.push(r.opId); unconfirmed.delete(r.opId); }
      const env = decodeOp(r);
      if (env) envs.push(env);
      appliedSeq = r.seq;
    }
    doc.applyRemote(envs);        // ops already applied here are skipped by op id
    logCursor = doc.log().length; // remote ops are not ours to send
    if (acked.length) { outbox.ack(acked); emit(); }
  }

  function loadSnapshot(row: BoardSnapshotRow): boolean {
    let saved: SavedBoard;
    try { saved = parseSnapshot(row); } catch (e) { report({ kind: 'bad-snapshot', message: errText(e) }); return false; }
    capture();
    doc.load(saved);
    appliedSeq = row.uptoSeq;
    if (unconfirmed.size) doc.applyRemote([...unconfirmed.values()]);   // keep this client's unconfirmed edits
    logCursor = doc.log().length;
    return true;
  }

  function onSynced() {
    if (disposed) return;
    const snap = snapshot;
    if (snap && (firstSync || snap.uptoSeq > appliedSeq)) loadSnapshot(snap);
    firstSync = false;
    const rows = buffered;
    buffered = [];
    fold(rows);
    synced = true;
    emit();
    scheduleFlush();
  }

  // ---- actors ----
  function joinOne(a: LocalActor) {
    if (!live()) return;
    transport.joinBoard({ boardId, actor: a.id, kind: a.kind, name: a.name, color: a.color, ...(a.agentId ? { agentId: a.agentId } : {}) })
      .catch((e: unknown) => report({ kind: 'join-refused', actor: a.id, message: errText(e) }));
  }
  function onActors(c: RowChange<BoardActorRow>) {
    const me = mineHex();
    let grew = false;
    for (const r of c.added) {
      if (r.boardId !== boardId) continue;
      if (!owned.has(r.actor)) { o.onRemoteActor?.(r); continue; }
      if (me && r.identity.toHexString() !== me) { report({ kind: 'actor-taken', actor: r.actor }); continue; }
      if (r.lastOpSeq > 0n) restoreSeqs({ [r.actor]: Number(r.lastOpSeq) });
      if (!joined.has(r.actor)) { joined.add(r.actor); grew = true; }
    }
    for (const actor of c.removed) joined.delete(actor);
    if (grew) { scheduleFlush(); for (const id of joined) sendPresence(id, true); }
  }

  // ---- presence out ----
  const lastCursor = new Map<ActorId, string>();
  const lastPresence = new Map<ActorId, string>();
  const cursorTimer = new Map<ActorId, unknown>();
  const presenceTimer = new Map<ActorId, unknown>();

  function sendCursor(id: ActorId) {
    cursorTimer.delete(id);
    const p = presence.get(id);
    if (!p || p.x === undefined || p.y === undefined || !live() || !joined.has(id)) return;
    transport.moveCursor({ boardId, actor: id, x: p.x, y: p.y, tx: p.x, ty: p.y, moveMs: 0, down: !!p.down }).catch(() => { /* next move resends */ });
  }
  function sendPresence(id: ActorId, force = false) {
    presenceTimer.delete(id);
    const p = presence.get(id);
    if (!p || !live() || !joined.has(id)) return;
    const fields = encodePresence(p);
    const key = JSON.stringify(fields);
    if (!force && lastPresence.get(id) === key) return;
    lastPresence.set(id, key);
    transport.setPresence({ boardId, actor: id, ...fields }).catch(() => { lastPresence.delete(id); });
  }
  const throttle = (timers_: Map<ActorId, unknown>, id: ActorId, ms: number, f: (id: ActorId) => void) => {
    if (!timers_.has(id)) timers_.set(id, timers.setTimeout(() => f(id), ms));
  };
  function onLocalPresence(all: ReadonlyMap<ActorId, Presence>) {
    for (const id of owned.keys()) {
      const p = all.get(id);
      if (!p) continue;
      const ck = `${p.x},${p.y},${p.down ? 1 : 0}`;
      if (lastCursor.get(id) !== ck) { lastCursor.set(id, ck); throttle(cursorTimer, id, CURSOR_MS, sendCursor); }
      if (lastPresence.get(id) !== JSON.stringify(encodePresence(p))) throttle(presenceTimer, id, PRESENCE_MS, (a) => sendPresence(a));
    }
  }

  // ---- presence in ----
  const rowActor = new Map<string, ActorId>();   // presence_id -> actor
  function onPresenceRows(c: RowChange<BoardPresenceRow>) {
    for (const pid of c.removed) {
      const actor = rowActor.get(pid);
      rowActor.delete(pid);
      if (actor && !owned.has(actor) && ![...rowActor.values()].includes(actor)) presence.remove(actor);
    }
    for (const r of c.added) {
      if (r.boardId !== boardId || owned.has(r.actor)) continue;
      rowActor.set(r.presenceId, r.actor);
      presence.publish(decodePresence(r));
    }
  }
  function onCursor(e: BoardCursorEvent) {
    if (e.boardId !== boardId || owned.has(e.actor)) return;
    presence.publish({ actor: e.actor, x: e.tx, y: e.ty, down: e.down });
  }

  // ---- connection ----
  function onStatus(s: NetStatus) {
    epoch++;
    pushing = false;
    if (s === 'live') {
      outbox.requeueAll();
      for (const a of owned.values()) joinOne(a);
    } else {
      synced = false;    // the next onSynced folds whatever was missed
    }
    emit();
  }

  for (const a of o.actors ?? []) owned.set(a.id, a);
  const offs = [
    doc.onChange(capture),
    presence.subscribe(onLocalPresence),
    transport.onStatus(onStatus),
    transport.onSynced(onSynced),
    transport.onSnapshot((c) => { for (const r of c.added) if (r.boardId === boardId) snapshot = r; }),
    transport.onOps((c) => { if (synced) fold(c.added); else buffered.push(...c.added); }),
    transport.onActors(onActors),
    transport.onPresence(onPresenceRows),
    transport.onCursor(onCursor),
  ];
  if (live()) for (const a of owned.values()) joinOne(a);

  return {
    state,
    subscribe(cb) { stateSubs.add(cb); return () => { stateSubs.delete(cb); }; },
    join(a) { if (owned.has(a.id)) return; owned.set(a.id, a); joinOne(a); },
    async leave(id) {
      if (!owned.delete(id)) return;
      joined.delete(id);
      for (const m of [cursorTimer, presenceTimer]) { const h = m.get(id); if (h !== undefined) timers.clearTimeout(h); m.delete(id); }
      if (live()) await transport.leaveBoard(boardId, id);
    },
    dispose() {
      disposed = true;
      offs.forEach((f) => f());
      for (const m of [cursorTimer, presenceTimer]) { for (const h of m.values()) timers.clearTimeout(h); m.clear(); }
      stateSubs.clear();
    },
  };
}
