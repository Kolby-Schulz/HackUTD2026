import { beforeEach, describe, expect, it } from 'vitest';
import { resetSeqs } from '../core/ids';
import { createDocStore } from '../core/store';
import type { DocStore, Op, Shape } from '../core/types';
import { createPresenceBus } from '../presence/bus';
import type { MemoryPresenceBus } from '../presence/bus';
import { connectBoard, CURSOR_MS } from './session';
import { electHost, RENEW_MS } from './host';
import type { HostTimers } from './host';
import type { BoardSession, LocalActor, NetError, Timers } from './session';
import { MAX_OPS_PER_PUSH, MAX_OP_BODY_BYTES } from './types';
import type {
  BoardActorRow, BoardCursorEvent, BoardOpRow, BoardPresenceRow, BoardSnapshotRow, BoardTransport, NetStatus, RowChange,
} from './types';

// ---- an in-memory server with push_ops' rules (seq stamping, same-body skip, different-body refusal, ownership) ----
type Cb<T> = (v: T) => void;
class FakeServer {
  ops: BoardOpRow[] = [];
  actors = new Map<string, BoardActorRow>();
  presence = new Map<string, BoardPresenceRow>();
  snapshot: BoardSnapshotRow | null = null;
  pushes: number[] = [];
  nextSeq = 1n;
  clients = new Set<FakeClient>();
  agents = new Map<string, string>();                       // agent id -> identity hex
  services = new Map<string, { hex: string; holder: string; at: number }>();
  now = 0;                                                  // seconds, for service staleness

  push(c: FakeClient, boardId: string, ops: readonly { opId: string; tx: string; body: string }[]) {
    if (ops.length > MAX_OPS_PER_PUSH) throw new Error('too many ops');
    const added: BoardOpRow[] = [];
    for (const op of ops) {
      const actor = op.opId.slice(0, op.opId.lastIndexOf(':'));
      if (this.actors.get(actor)?.identity.toHexString() !== c.hex) throw new Error(`not your actor: ${actor}`);
      const old = this.ops.find((r) => r.opId === op.opId);
      if (old) { if (old.body !== op.body) throw new Error('op id reused with a different body'); continue; }
      const row: BoardOpRow = { opId: op.opId, boardId, seq: this.nextSeq++, actor, tx: op.tx, body: op.body };
      this.ops.push(row);
      added.push(row);
    }
    this.pushes.push(ops.length);
    this.broadcast((cl) => cl.emitOps({ added, removed: [] }));
  }
  /** Compaction: replace ops up to `upto` with a snapshot. */
  compact(boardId: string, doc: string) {
    const upto = this.nextSeq - 1n;
    this.snapshot = { boardId, uptoSeq: upto, doc };
    const removed = this.ops.map((r) => r.opId);
    this.ops = [];
    this.broadcast((cl) => { cl.emitSnapshot({ added: [this.snapshot!], removed: [] }); cl.emitOps({ added: [], removed }); });
  }
  broadcast(f: (c: FakeClient) => void) { for (const c of this.clients) if (c.st === 'live') f(c); }
}

class FakeClient implements BoardTransport {
  st: NetStatus = 'offline';
  subs = { status: new Set<Cb<NetStatus>>(), synced: new Set<Cb<void>>(), ops: new Set<Cb<RowChange<BoardOpRow>>>(), snap: new Set<Cb<RowChange<BoardSnapshotRow>>>(), actors: new Set<Cb<RowChange<BoardActorRow>>>(), presence: new Set<Cb<RowChange<BoardPresenceRow>>>(), cursor: new Set<Cb<BoardCursorEvent>>() };
  cursors: BoardCursorEvent[] = [];
  constructor(readonly server: FakeServer, readonly hex: string) { server.clients.add(this); }

  status() { return this.st; }
  identity() { return { toHexString: () => this.hex }; }
  onStatus(cb: Cb<NetStatus>) { return this.add(this.subs.status, cb); }
  onSynced(cb: Cb<void>) { return this.add(this.subs.synced, cb); }
  onOps(cb: Cb<RowChange<BoardOpRow>>) { return this.add(this.subs.ops, cb); }
  onSnapshot(cb: Cb<RowChange<BoardSnapshotRow>>) { return this.add(this.subs.snap, cb); }
  onActors(cb: Cb<RowChange<BoardActorRow>>) { return this.add(this.subs.actors, cb); }
  onPresence(cb: Cb<RowChange<BoardPresenceRow>>) { return this.add(this.subs.presence, cb); }
  onCursor(cb: Cb<BoardCursorEvent>) { return this.add(this.subs.cursor, cb); }

  async registerAgent(a: { id: string }) {
    this.live();
    const prev = this.server.agents.get(a.id);
    if (prev && prev !== this.hex) throw new Error('agent linked to another identity');
    this.server.agents.set(a.id, this.hex);
  }
  async heartbeat() { this.live(); }
  async claimService(name: string, holder: string) {
    this.live();
    const row = this.server.services.get(name);
    const mine = row && row.holder === holder && row.hex === this.hex;
    if (row && !mine && this.server.now - row.at <= 30) throw new Error(`${name} is already running`);
    this.server.services.set(name, { hex: this.hex, holder, at: this.server.now });
  }
  async releaseService(name: string, holder: string) {
    this.live();
    const row = this.server.services.get(name);
    if (row && row.holder === holder && row.hex === this.hex) this.server.services.delete(name);
  }
  async joinBoard(a: { boardId: string; actor: string; kind: string; name: string; color: string }) {
    this.live();
    const prev = this.server.actors.get(a.actor);
    if (prev && prev.identity.toHexString() !== this.hex) throw new Error('actor taken');
    const row: BoardActorRow = { actor: a.actor, boardId: a.boardId, identity: this.identity(), kind: a.kind, name: a.name, color: a.color, lastOpSeq: prev?.lastOpSeq ?? 0n };
    this.server.actors.set(a.actor, row);
    this.server.broadcast((c) => c.subs.actors.forEach((f) => f({ added: [row], removed: [] })));
  }
  async leaveBoard() { this.live(); }
  lose = false;   // the next push is lost on the wire: the server never gets it and the call never settles
  async pushOps(boardId: string, ops: readonly { opId: string; tx: string; body: string }[]) {
    this.live();
    if (this.lose) { this.lose = false; return new Promise<void>(() => {}); }
    this.server.push(this, boardId, ops);
  }
  async setPresence(a: Omit<BoardPresenceRow, 'presenceId'>) {
    this.live();
    const row = { ...a, presenceId: `${this.hex}:${a.actor}` };
    this.server.presence.set(row.presenceId, row);
    this.server.broadcast((c) => c.subs.presence.forEach((f) => f({ added: [row], removed: [] })));
  }
  async moveCursor(e: BoardCursorEvent) { this.live(); this.cursors.push(e); this.server.broadcast((c) => c.subs.cursor.forEach((f) => f(e))); }

  connect() {
    this.st = 'live';
    this.subs.status.forEach((f) => f('live'));
    // initial set, then synced
    if (this.server.snapshot) this.emitSnapshot({ added: [this.server.snapshot], removed: [] });
    this.subs.actors.forEach((f) => f({ added: [...this.server.actors.values()], removed: [] }));
    this.emitOps({ added: [...this.server.ops], removed: [] });
    this.subs.presence.forEach((f) => f({ added: [...this.server.presence.values()], removed: [] }));
    this.subs.synced.forEach((f) => f());
  }
  disconnect() {
    this.st = 'offline';
    this.subs.status.forEach((f) => f('offline'));
    const gone = [...this.server.presence.keys()].filter((k) => k.startsWith(this.hex + ':'));
    for (const k of gone) this.server.presence.delete(k);
    this.server.broadcast((c) => c.subs.presence.forEach((f) => f({ added: [], removed: gone })));
  }
  emitOps(c: RowChange<BoardOpRow>) { this.subs.ops.forEach((f) => f(c)); }
  emitSnapshot(c: RowChange<BoardSnapshotRow>) { this.subs.snap.forEach((f) => f(c)); }
  private live() { if (this.st !== 'live') throw new Error('not connected'); }
  private add<T>(set: Set<T>, cb: T) { set.add(cb); return () => { set.delete(cb); }; }
}

// manual timers so presence throttling is deterministic
class ManualTimers implements Timers {
  t = 0; q: { at: number; f: () => void; id: number }[] = []; n = 0;
  setTimeout(f: () => void, ms: number) { const id = ++this.n; this.q.push({ at: this.t + ms, f, id }); return id; }
  clearTimeout(h: unknown) { this.q = this.q.filter((x) => x.id !== h); }
  advance(ms: number) { this.t += ms; const due = this.q.filter((x) => x.at <= this.t); this.q = this.q.filter((x) => x.at > this.t); due.forEach((x) => x.f()); }
}

const BOARD = 'b1';
const rect = (id: string, by: string, over: Partial<Shape> = {}): Op => ({
  t: 'create', shape: { id, kind: 'rect', name: id, x: 0, y: 0, w: 10, h: 10, fills: [], parent: null, index: 'V', createdBy: by, ...over },
});
const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
const human = (id: string): LocalActor => ({ id, kind: 'human', name: id, color: '#3366ff' });

interface Peer { doc: DocStore; bus: MemoryPresenceBus; client: FakeClient; session: BoardSession; errors: NetError[]; timers: ManualTimers }
function peer(server: FakeServer, hex: string, actors: LocalActor[]): Peer {
  const doc = createDocStore({ boardId: BOARD });
  const bus = createPresenceBus({ schedule: (f) => f() });
  const client = new FakeClient(server, hex);
  const errors: NetError[] = [];
  const timers = new ManualTimers();
  const session = connectBoard({ boardId: BOARD, doc, presence: bus, transport: client, actors, onError: (e) => errors.push(e), timers });
  return { doc, bus, client, session, errors, timers };
}
const ids = (d: DocStore) => [...d.getState().shapes.keys()].sort();

let server: FakeServer;
beforeEach(() => { resetSeqs(); server = new FakeServer(); });

describe('ops', () => {
  it('an edit on one client reaches the other through the server, once', async () => {
    const a = peer(server, 'aa', [human('human-a')]);
    const b = peer(server, 'bb', [human('human-b')]);
    a.client.connect(); b.client.connect(); await settle();
    a.doc.dispatch('human-a', 'Draw', [rect('r1', 'human-a')]);
    await settle();
    expect(ids(b.doc)).toEqual(['r1']);
    expect(server.ops.map((r) => r.opId)).toEqual(['human-a:1']);
    expect(a.session.state().pending).toBe(0);
  });

  it('edits made offline are sent after reconnect, and a resend of a confirmed op is skipped', async () => {
    const a = peer(server, 'aa', [human('human-a')]);
    const b = peer(server, 'bb', [human('human-b')]);
    a.client.connect(); b.client.connect(); await settle();
    a.doc.dispatch('human-a', 'Draw', [rect('r1', 'human-a')]);
    await settle();
    a.client.disconnect();
    a.doc.dispatch('human-a', 'Draw', [rect('r2', 'human-a')]);
    a.doc.dispatch('human-a', 'Move', [{ t: 'set', id: 'r1', patch: { x: 40 } }]);
    await settle();
    expect(a.session.state().pending).toBe(2);
    expect(ids(b.doc)).toEqual(['r1']);
    a.client.connect(); await settle();
    expect(ids(b.doc)).toEqual(['r1', 'r2']);
    expect(b.doc.getState().shapes.get('r1')!.x).toBe(40);
    expect(server.ops).toHaveLength(3);
    expect(a.session.state().pending).toBe(0);
    expect(a.errors).toEqual([]);
  });

  it('a push lost with its connection is sent again after reconnect, and does not block later pushes', async () => {
    const a = peer(server, 'aa', [human('human-a')]);
    const b = peer(server, 'bb', [human('human-b')]);
    a.client.connect(); b.client.connect(); await settle();
    a.client.lose = true;
    a.doc.dispatch('human-a', 'Draw', [rect('r1', 'human-a')]);
    await settle();                 // the push for r1 is out and hanging
    expect(server.ops).toHaveLength(0);
    a.client.disconnect();
    a.doc.dispatch('human-a', 'Draw', [rect('r2', 'human-a')]);
    a.client.connect(); await settle();
    expect(ids(b.doc)).toEqual(['r1', 'r2']);
    expect(a.session.state().pending).toBe(0);
  });

  it('remote ops are folded in seq order even when rows arrive out of order', async () => {
    const a = peer(server, 'aa', [human('human-a')]);
    a.client.connect(); await settle();
    const body = (l: number, op: Op) => JSON.stringify({ l, ts: 0, op });
    // two writes to one field from another actor; the later seq has the higher Lamport stamp
    server.actors.set('human-z', { actor: 'human-z', boardId: BOARD, identity: { toHexString: () => 'zz' }, kind: 'human', name: 'z', color: '#000', lastOpSeq: 0n });
    const rows: BoardOpRow[] = [
      { opId: 'human-z:2', boardId: BOARD, seq: 3n, actor: 'human-z', tx: 't2', body: body(3, { t: 'set', id: 'r', patch: { x: 9 } }) },
      { opId: 'human-z:1', boardId: BOARD, seq: 2n, actor: 'human-z', tx: 't1', body: body(1, rect('r', 'human-z')) },
    ];
    a.client.emitOps({ added: rows, removed: [] });
    expect(a.doc.getState().shapes.get('r')!.x).toBe(9);
  });

  it('a local edit made just before remote rows arrive is still sent', async () => {
    const a = peer(server, 'aa', [human('human-a')]);
    a.client.connect(); await settle();
    a.doc.dispatch('human-a', 'Draw', [rect('mine', 'human-a')]);   // its change event is still queued
    a.client.emitOps({ added: [
      { opId: 'human-z:1', boardId: BOARD, seq: 50n, actor: 'human-z', tx: 't', body: JSON.stringify({ l: 1, ts: 0, op: rect('theirs', 'human-z') }) },
    ], removed: [] });
    await settle();
    expect(server.ops.map((r) => r.opId)).toEqual(['human-a:1']);
  });

  it('a malformed row is skipped without stopping the rows after it', async () => {
    const a = peer(server, 'aa', [human('human-a')]);
    a.client.connect(); await settle();
    a.client.emitOps({ added: [
      { opId: 'human-z:1', boardId: BOARD, seq: 1n, actor: 'human-z', tx: 't', body: '{not json' },
      { opId: 'human-z:2', boardId: BOARD, seq: 2n, actor: 'human-z', tx: 't', body: JSON.stringify({ l: 2, ts: 0, op: rect('ok', 'human-z') }) },
    ], removed: [] });
    expect(ids(a.doc)).toEqual(['ok']);
  });

  it('sends at most 100 ops per push_ops call', async () => {
    const a = peer(server, 'aa', [human('human-a')]);
    a.client.connect(); await settle();
    a.doc.dispatch('human-a', 'Paste', Array.from({ length: 250 }, (_, i) => rect(`p${i}`, 'human-a')));
    await settle(); await settle();
    expect(server.pushes).toEqual([100, 100, 50]);
    expect(server.ops).toHaveLength(250);
  });

  it('an op past the body limit is reported and never sent', async () => {
    const a = peer(server, 'aa', [human('human-a')]);
    a.client.connect(); await settle();
    a.doc.dispatch('human-a', 'Draw', [rect('big', 'human-a', { name: 'x'.repeat(MAX_OP_BODY_BYTES) })]);
    await settle();
    expect(server.ops).toHaveLength(0);
    expect(a.errors.map((e) => e.kind)).toEqual(['op-too-large']);
  });

  it('a refused push drops its ops and reports it', async () => {
    const a = peer(server, 'aa', [human('human-a')]);
    a.client.connect(); await settle();
    server.ops.push({ opId: 'human-a:1', boardId: BOARD, seq: server.nextSeq++, actor: 'human-a', tx: 'x', body: '{}' });
    a.doc.dispatch('human-a', 'Draw', [rect('r1', 'human-a')]);   // collides with human-a:1
    await settle();
    expect(a.errors[0]).toMatchObject({ kind: 'push-refused', count: 1 });
    expect(a.session.state().pending).toBe(0);
  });

  it('does not push for an actor another identity holds', async () => {
    server.actors.set('human-a', { actor: 'human-a', boardId: BOARD, identity: { toHexString: () => 'other' }, kind: 'human', name: 'a', color: '#000', lastOpSeq: 0n });
    const a = peer(server, 'aa', [human('human-a')]);
    a.client.connect(); await settle();
    a.doc.dispatch('human-a', 'Draw', [rect('r1', 'human-a')]);
    await settle();
    expect(server.ops).toHaveLength(0);
    expect(a.errors.map((e) => e.kind)).toContain('actor-taken');
  });
});

describe('snapshots', () => {
  it('a late joiner loads the snapshot and then the ops after it', async () => {
    const a = peer(server, 'aa', [human('human-a')]);
    a.client.connect(); await settle();
    a.doc.dispatch('human-a', 'Draw', [rect('r1', 'human-a')]);
    await settle();
    server.compact(BOARD, JSON.stringify(a.doc.snapshot()));
    a.doc.dispatch('human-a', 'Draw', [rect('r2', 'human-a')]);
    await settle();
    const late = peer(server, 'cc', [human('human-c')]);
    late.client.connect(); await settle();
    expect(ids(late.doc)).toEqual(['r1', 'r2']);
  });

  it('a client that missed a compaction while offline reloads the snapshot and keeps its unconfirmed edits', async () => {
    const a = peer(server, 'aa', [human('human-a')]);
    const b = peer(server, 'bb', [human('human-b')]);
    a.client.connect(); b.client.connect(); await settle();
    b.client.disconnect();
    a.doc.dispatch('human-a', 'Draw', [rect('r1', 'human-a')]);
    await settle();
    server.compact(BOARD, JSON.stringify(a.doc.snapshot()));
    b.doc.dispatch('human-b', 'Draw', [rect('mine', 'human-b')]);
    await settle();
    b.client.connect();
    expect(ids(b.doc)).toEqual(['mine', 'r1']);   // before its push echoes back
    await settle();
    expect(ids(b.doc)).toEqual(['mine', 'r1']);
    expect(ids(a.doc)).toEqual(['mine', 'r1']);
  });
});

describe('presence', () => {
  it('local cursor moves go out at most once per CURSOR_MS and land in the other bus', async () => {
    const a = peer(server, 'aa', [human('human-a')]);
    const b = peer(server, 'bb', [human('human-b')]);
    a.client.connect(); b.client.connect(); await settle();
    for (let i = 0; i < 5; i++) a.bus.publish({ actor: 'human-a', x: i, y: i });
    expect(a.client.cursors).toHaveLength(0);
    a.timers.advance(CURSOR_MS);
    expect(a.client.cursors).toHaveLength(1);
    expect(b.bus.get('human-a')).toMatchObject({ x: 4, y: 4 });
  });

  it('presence rows carry agent state and leave when the connection drops', async () => {
    const agent: LocalActor = { id: 'agent-k1', kind: 'agent', name: 'Kit', color: '#f60' };
    const host = peer(server, 'hh', [agent]);
    const b = peer(server, 'bb', [human('human-b')]);
    host.client.connect(); b.client.connect(); await settle();
    host.bus.publish({ actor: 'agent-k1', state: 'drawing', detail: 'reviewing', selection: ['r1'] });
    host.timers.advance(1000);
    expect(b.bus.get('agent-k1')).toMatchObject({ state: 'drawing', detail: 'reviewing', selection: ['r1'] });
    host.client.disconnect();
    expect(b.bus.get('agent-k1')).toBeUndefined();
  });

  it('several agents on one connection keep separate presence rows', async () => {
    const host = peer(server, 'hh', [{ id: 'agent-1', kind: 'agent', name: '1', color: '#f00' }, { id: 'agent-2', kind: 'agent', name: '2', color: '#0f0' }]);
    host.client.connect(); await settle();
    host.bus.publish({ actor: 'agent-1', detail: 'one' });
    host.bus.publish({ actor: 'agent-2', detail: 'two' });
    host.timers.advance(1000);
    expect([...server.presence.keys()].sort()).toEqual(['hh:agent-1', 'hh:agent-2']);
  });

  it('an agent joined later can write ops', async () => {
    const host = peer(server, 'hh', []);
    host.client.connect(); await settle();
    host.session.join({ id: 'agent-9', kind: 'agent', name: '9', color: '#00f' });
    await settle();
    host.doc.dispatch('agent-9', 'Draw', [rect('a9', 'agent-9')]);
    await settle();
    expect(server.ops.map((r) => r.actor)).toEqual(['agent-9']);
  });
});

describe('agent host', () => {
  class Intervals implements HostTimers {
    fns = new Map<number, () => void>(); n = 0;
    setInterval(f: () => void) { const id = ++this.n; this.fns.set(id, f); return id; }
    clearInterval(h: unknown) { this.fns.delete(h as number); }
    tick() { [...this.fns.values()].forEach((f) => f()); }
  }

  it('exactly one tab becomes host, and another takes over once the host is gone', async () => {
    const a = new FakeClient(server, 'aa'); const b = new FakeClient(server, 'bb');
    a.connect(); b.connect();
    const ta = new Intervals(); const tb = new Intervals();
    const roles: Record<string, boolean> = {};
    const ea = electHost(a, 'tab-a', (h) => { roles.a = h; }, ta);
    await settle();
    const eb = electHost(b, 'tab-b', (h) => { roles.b = h; }, tb);
    await settle();
    expect([ea.isHost(), eb.isHost()]).toEqual([true, false]);
    a.disconnect();                     // the host tab drops without releasing
    expect(ea.isHost()).toBe(false);
    server.now += 10; tb.tick(); await settle();
    expect(eb.isHost()).toBe(false);    // the lock is not stale yet
    server.now += 25; tb.tick(); await settle();
    expect(eb.isHost()).toBe(true);
    expect(RENEW_MS).toBeLessThan(30_000);
    ea.dispose(); eb.dispose();
  });

  it('an agent on the host tab registers, joins and its edits reach a viewer', async () => {
    const host = peer(server, 'hh', [human('human-h')]);
    const viewer = peer(server, 'vv', [human('human-v')]);
    host.client.connect(); viewer.client.connect(); await settle();
    host.session.join({ id: 'agent-k1', kind: 'agent', name: 'Kit', color: '#f60', agentId: 'agent-k1' });
    host.doc.dispatch('agent-k1', 'Draw', [rect('k', 'agent-k1')]);
    await settle(); await settle();
    expect(server.agents.get('agent-k1')).toBe('hh');
    expect(server.actors.get('agent-k1')?.kind).toBe('agent');
    expect(ids(viewer.doc)).toEqual(['k']);
  });
});
