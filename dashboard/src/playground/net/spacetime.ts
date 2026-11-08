// The live BoardTransport: a SpacetimeDB connection (generated bindings) subscribed to one board's rows.
// Reconnects on its own (withAutomaticReconnect); the session resends its outbox when the status returns to live.
import { DbConnection } from '@bindings/index.ts';
import type { Identity } from 'spacetimedb';
import type {
  BoardActorRow, BoardCursorEvent, BoardOpRow, BoardPresenceRow, BoardSnapshotRow, BoardTransport, NetStatus, RowChange,
} from './types';

export interface SpacetimeOpts { uri: string; database: string; token?: string; boardId: string; boardName: string; onToken?: (t: string) => void }

type Listener<T> = Set<(v: T) => void>;
const sql = (s: string) => `'${s.replace(/'/g, "''")}'`;

export function connectSpacetime(o: SpacetimeOpts): BoardTransport & { close(): void } {
  let status: NetStatus = 'connecting';
  let me: Identity | null = null;
  let synced = false;   // a listener added after the initial sync gets the current rows and `synced` at once
  const L = {
    status: new Set() as Listener<NetStatus>, synced: new Set() as Listener<void>,
    ops: new Set() as Listener<RowChange<BoardOpRow>>, snap: new Set() as Listener<RowChange<BoardSnapshotRow>>,
    actors: new Set() as Listener<RowChange<BoardActorRow>>, presence: new Set() as Listener<RowChange<BoardPresenceRow>>,
    cursor: new Set() as Listener<BoardCursorEvent>,
  };
  const fire = <T>(set: Listener<T>, v: T) => set.forEach((f) => f(v));
  const setStatus = (s: NetStatus) => { if (status !== s) { status = s; fire(L.status, s); } };
  const one = <R>(r: R): RowChange<R> => ({ added: [r], removed: [] });
  const gone = <R>(key: string): RowChange<R> => ({ added: [], removed: [key] });

  function onLive(conn: DbConnection, identity: Identity, token: string) {
    me = identity;
    o.onToken?.(token);
    conn.reducers.createBoard({ id: o.boardId, name: o.boardName }).catch(() => { /* it exists already */ });
    const b = sql(o.boardId);
    conn.subscriptionBuilder()
      .onApplied(() => {
        // initial rows for each listener, then synced
        fire(L.snap, { added: [...conn.db.boardSnapshot.iter()].filter((r) => r.boardId === o.boardId), removed: [] });
        fire(L.actors, { added: [...conn.db.boardActor.iter()].filter((r) => r.boardId === o.boardId), removed: [] });
        fire(L.ops, { added: [...conn.db.boardOp.iter()].filter((r) => r.boardId === o.boardId), removed: [] });
        fire(L.presence, { added: [...conn.db.boardPresence.iter()].filter((r) => r.boardId === o.boardId), removed: [] });
        synced = true;
        fire(L.synced, undefined);
      })
      .subscribe([
        `SELECT * FROM board_op WHERE board_id = ${b}`,
        `SELECT * FROM board_actor WHERE board_id = ${b}`,
        `SELECT * FROM board_presence WHERE board_id = ${b}`,
        `SELECT * FROM board_snapshot WHERE board_id = ${b}`,
        `SELECT * FROM board_cursor WHERE board_id = ${b}`,
      ]);
    setStatus('live');
  }

  const conn = DbConnection.builder()
    .withUri(o.uri)
    .withDatabaseName(o.database)
    .withToken(o.token)
    .withAutomaticReconnect()
    .onConnect(onLive)
    .onAutomaticReconnect(onLive)
    .onDisconnect(() => { synced = false; setStatus('offline'); })
    .onConnectError(() => setStatus('offline'))
    .build();

  // Row callbacks live on the connection and survive reconnects. Inserts before onApplied are covered by its full read.
  conn.db.boardOp.onInsert((_c, r) => { if (r.boardId === o.boardId) fire(L.ops, one(r)); });
  conn.db.boardSnapshot.onInsert((_c, r) => { if (r.boardId === o.boardId) fire(L.snap, one(r)); });
  conn.db.boardActor.onInsert((_c, r) => { if (r.boardId === o.boardId) fire(L.actors, one(r)); });
  conn.db.boardActor.onUpdate((_c, _old, r) => { if (r.boardId === o.boardId) fire(L.actors, one(r)); });
  conn.db.boardActor.onDelete((_c, r) => { if (r.boardId === o.boardId) fire(L.actors, gone<BoardActorRow>(r.actor)); });
  conn.db.boardPresence.onInsert((_c, r) => { if (r.boardId === o.boardId) fire(L.presence, one(r)); });
  conn.db.boardPresence.onUpdate((_c, _old, r) => { if (r.boardId === o.boardId) fire(L.presence, one(r)); });
  conn.db.boardPresence.onDelete((_c, r) => { if (r.boardId === o.boardId) fire(L.presence, gone<BoardPresenceRow>(r.presenceId)); });
  conn.db.boardCursor.onInsert((_c, e) => { if (e.boardId === o.boardId) fire(L.cursor, e); });

  const sub = <T>(set: Listener<T>, cb: (v: T) => void) => { set.add(cb); return () => { set.delete(cb); }; };
  const mine = <R extends { boardId: string }>(rows: Iterable<R>): RowChange<R> => ({ added: [...rows].filter((r) => r.boardId === o.boardId), removed: [] });
  /** Subscribe, and when the initial sync is already done, hand over the current rows first. */
  const subRows = <R extends { boardId: string }>(set: Listener<RowChange<R>>, cb: (v: RowChange<R>) => void, rows: () => Iterable<R>) => {
    if (synced) cb(mine(rows()));
    return sub(set, cb);
  };
  return {
    status: () => status,
    identity: () => me,
    onStatus: (cb) => sub(L.status, cb),
    onSynced: (cb) => { if (synced) queueMicrotask(() => { if (synced) cb(); }); return sub(L.synced, cb); },
    onOps: (cb) => subRows(L.ops, cb, () => conn.db.boardOp.iter()),
    onSnapshot: (cb) => subRows(L.snap, cb, () => conn.db.boardSnapshot.iter()),
    onActors: (cb) => subRows(L.actors, cb, () => conn.db.boardActor.iter()),
    onPresence: (cb) => subRows(L.presence, cb, () => conn.db.boardPresence.iter()),
    onCursor: (cb) => sub(L.cursor, cb),
    registerAgent: (a) => conn.reducers.registerAgent({ id: a.id, name: a.name, ownerDev: '', machine: 'design-board', model: 'scripted', tokenBudget: 0n }),
    heartbeat: (agentId) => conn.reducers.heartbeat({ agentId }),
    claimService: (name, holder) => conn.reducers.claimService({ name, machine: 'browser', holder }),
    releaseService: (name, holder) => conn.reducers.releaseService({ name, holder }),
    joinBoard: (a) => conn.reducers.joinBoard({ boardId: a.boardId, actor: a.actor, kind: a.kind, name: a.name, color: a.color, agentId: a.agentId }),
    leaveBoard: (boardId, actor) => conn.reducers.leaveBoard({ boardId, actor }),
    pushOps: (boardId, ops) => conn.reducers.pushOps({ boardId, ops: [...ops] }),
    setPresence: (a) => conn.reducers.setBoardPresence(a),
    moveCursor: (a) => conn.reducers.moveCursor(a),
    close: () => conn.disconnect(),
  };
}
