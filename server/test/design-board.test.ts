// The design board (PR S): boards, actors, the op log, presence, cursors, snapshots, messages
// and the disconnect hook. Contract: vault/Scopes/integration-plan.md plus the board amendments.
import { describe, it, expect, beforeEach } from 'vitest';
import { TestAuth } from 'spacetimedb/server/test-utils';
import { ConnectionId } from 'spacetimedb';
import { makeHarness, register, asOperator, mod, all, type Harness, type Who, type Ctx } from './helpers';

const BOARD = 'main';

function op(actor: string, n: number, body = '{"k":1}', tx = 'tx1') {
  return { op_id: `${actor}:${n}`, tx, body };
}

function join(t: Harness, who: Who, actor: string, kind = 'human', agentId?: string) {
  t.as(who, (ctx) =>
    mod.join_board(ctx, { board_id: BOARD, actor, kind, name: actor, color: '#fff', agent_id: agentId }),
  );
}

function push(t: Harness, who: Who, ops: ReturnType<typeof op>[], boardId = BOARD) {
  t.as(who, (ctx) => mod.push_ops(ctx, { board_id: boardId, ops }));
}

/** Runs body as `who` on a second connection (same identity, different connection id). */
function asConn<T>(t: Harness, who: Who, conn: bigint, body: (ctx: Ctx) => T): T {
  const auth = TestAuth.fromJwtPayload(
    JSON.stringify({ iss: 'https://contract.test', sub: who, aud: ['spacetimedb'] }),
    new ConnectionId(conn),
  );
  return t.h.withReducerTx(auth, body as never);
}

function presence(t: Harness, who: Who, actor: string, extra: Partial<Parameters<typeof mod.set_board_presence>[1]> = {}) {
  t.as(who, (ctx) =>
    mod.set_board_presence(ctx, {
      board_id: BOARD,
      actor,
      selection: '[]',
      status: 'idle',
      tool: '',
      detail: '',
      typing: '',
      viewport: '{}',
      ...extra,
    }),
  );
}

describe('boards and actors', () => {
  let t: Harness;
  beforeEach(() => {
    t = makeHarness();
    t.as('worker-a', (ctx) => mod.create_board(ctx, { id: BOARD, name: 'Main' }));
  });

  it('create_board starts the sequence at 0 and refuses a duplicate id', () => {
    // Assert
    const b = t.db.board.id.find(BOARD)!;
    expect([b.next_seq, b.snapshot_seq]).toEqual([0n, 0n]);
    expect(() => t.as('worker-b', (ctx) => mod.create_board(ctx, { id: BOARD, name: 'x' }))).toThrow(/already exists/);
  });

  it('join_board inserts an actor, keeps last_op_seq on rejoin, and refuses another identity', () => {
    // Arrange
    join(t, 'worker-a', 'ann');
    push(t, 'worker-a', [op('ann', 7)]);

    // Act
    t.as('worker-a', (ctx) =>
      mod.join_board(ctx, { board_id: BOARD, actor: 'ann', kind: 'human', name: 'Ann B', color: '#000', agent_id: undefined }),
    );

    // Assert
    const a = t.db.boardActor.actor.find('ann')!;
    expect([a.name, a.last_op_seq]).toEqual(['Ann B', 7n]);
    expect(() => join(t, 'worker-b', 'ann')).toThrow(/different identity/);
  });

  it('join_board rejects an unknown board, a bad kind, and an agent_id the caller does not own', () => {
    // Arrange
    register(t, 'agent-a');

    // Act + Assert
    expect(() =>
      t.as('worker-a', (ctx) =>
        mod.join_board(ctx, { board_id: 'nope', actor: 'a', kind: 'human', name: 'a', color: '', agent_id: undefined }),
      ),
    ).toThrow(/unknown board/);
    expect(() => join(t, 'worker-a', 'a', 'robot')).toThrow(/invalid actor kind/);
    expect(() => join(t, 'worker-b', 'bot', 'agent', 'agent-a')).toThrow(/different identity/);
    join(t, 'worker-a', 'bot', 'agent', 'agent-a');
    expect(t.db.boardActor.actor.find('bot')!.agent_id).toBe('agent-a');
  });

  it('leave_board drops this connection presence for the actor only', () => {
    // Arrange
    join(t, 'worker-a', 'ann');
    join(t, 'worker-a', 'bot', 'agent');
    presence(t, 'worker-a', 'ann');
    presence(t, 'worker-a', 'bot');

    // Act
    t.as('worker-a', (ctx) => mod.leave_board(ctx, { board_id: BOARD, actor: 'ann' }));

    // Assert
    expect(all(t.db.boardPresence.iter()).map((p) => p.actor)).toEqual(['bot']);
    expect(t.db.boardActor.actor.find('ann')).not.toBeNull();
  });

  it('reset_board is operator only and clears ops, snapshot, presence, actors and messages', () => {
    // Arrange
    join(t, 'worker-a', 'ann');
    push(t, 'worker-a', [op('ann', 1), op('ann', 2)]);
    presence(t, 'worker-a', 'ann');
    t.as('worker-a', (ctx) =>
      mod.post_board_message(ctx, { id: 'm1', board_id: BOARD, thread_id: 't1', kind: 'chat', author: 'ann', to_actor: undefined, body: 'hi', anchor: undefined }),
    );
    asOperator(t, (ctx) => mod.write_board_snapshot(ctx, { board_id: BOARD, upto_seq: 0n, doc: '{}' }));

    // Act + Assert
    expect(() => t.as('outsider', (ctx) => mod.reset_board(ctx, { board_id: BOARD }))).toThrow(/operator/);
    asOperator(t, (ctx) => mod.reset_board(ctx, { board_id: BOARD }));
    expect(all(t.db.boardOp.iter())).toHaveLength(0);
    expect(all(t.db.boardPresence.iter())).toHaveLength(0);
    expect(all(t.db.boardActor.iter())).toHaveLength(0);
    expect(all(t.db.boardMessage.iter())).toHaveLength(0);
    expect(t.db.boardSnapshot.board_id.find(BOARD)).toBeNull();
    const b = t.db.board.id.find(BOARD)!;
    expect([b.next_seq, b.snapshot_seq]).toEqual([0n, 0n]);
  });
});

describe('push_ops', () => {
  let t: Harness;
  beforeEach(() => {
    t = makeHarness();
    t.as('worker-a', (ctx) => mod.create_board(ctx, { id: BOARD, name: 'Main' }));
    join(t, 'worker-a', 'ann');
    join(t, 'worker-b', 'bob');
  });

  it('stamps consecutive seq numbers and advances next_seq', () => {
    // Act
    push(t, 'worker-a', [op('ann', 1), op('ann', 2)]);
    push(t, 'worker-b', [op('bob', 1)]);

    // Assert
    const ops = all(t.db.boardOp.iter()).sort((a, b) => Number(a.seq - b.seq));
    expect(ops.map((o) => [o.op_id, o.seq])).toEqual([['ann:1', 0n], ['ann:2', 1n], ['bob:1', 2n]]);
    expect(t.db.board.id.find(BOARD)!.next_seq).toBe(3n);
  });

  it('sets last_op_seq to the highest accepted op number', () => {
    // Act
    push(t, 'worker-a', [op('ann', 3), op('ann', 12), op('ann', 5)]);

    // Assert
    expect(t.db.boardActor.actor.find('ann')!.last_op_seq).toBe(12n);
    push(t, 'worker-a', [op('ann', 4)]);
    expect(t.db.boardActor.actor.find('ann')!.last_op_seq).toBe(12n);
  });

  it('resending an op with the same body is skipped; a different body throws and rolls back', () => {
    // Arrange
    push(t, 'worker-a', [op('ann', 1, '{"a":1}')]);

    // Act
    push(t, 'worker-a', [op('ann', 1, '{"a":1}'), op('ann', 2)]);

    // Assert
    expect(all(t.db.boardOp.iter())).toHaveLength(2);
    expect(() => push(t, 'worker-a', [op('ann', 3), op('ann', 1, '{"a":2}')])).toThrow(/different body/);
    expect(all(t.db.boardOp.iter())).toHaveLength(2);
    expect(t.db.board.id.find(BOARD)!.next_seq).toBe(2n);
  });

  it('refuses an actor the caller does not own, an unknown board, and an unknown actor', () => {
    expect(() => push(t, 'worker-b', [op('ann', 1)])).toThrow(/different identity/);
    expect(() => push(t, 'worker-a', [op('ann', 1)], 'nope')).toThrow(/unknown board/);
    expect(() => push(t, 'worker-a', [op('ghost', 1)])).toThrow(/unknown actor/);
    expect(all(t.db.boardOp.iter())).toHaveLength(0);
  });

  it('enforces the size limits and the op id format', () => {
    const many = Array.from({ length: 101 }, (_, i) => op('ann', i + 1));
    expect(() => push(t, 'worker-a', many)).toThrow(/too many ops/);
    expect(() => push(t, 'worker-a', Array.from({ length: 100 }, (_, i) => op('ann', i + 1)))).not.toThrow();
    expect(() => push(t, 'worker-a', [op('ann', 500, 'x'.repeat(8_193))])).toThrow(/over 8192 bytes/);
    expect(() => push(t, 'worker-a', [op('ann', 501, 'x'.repeat(8_192))])).not.toThrow();
    expect(() => push(t, 'worker-a', [{ op_id: '', tx: 't', body: '{}' }])).toThrow(/must not be empty/);
    expect(() => push(t, 'worker-a', [{ op_id: 'ann:abc', tx: 't', body: '{}' }])).toThrow(/<actor>:<number>/);
    expect(() => push(t, 'worker-a', [{ op_id: 'ann:99999999999999999999', tx: 't', body: '{}' }])).toThrow(/<actor>:<number>/);
    expect(() => push(t, 'worker-a', [{ op_id: 'ann', tx: 't', body: '{}' }])).toThrow(/<actor>:<number>/);
  });

  it('uses the part before the last colon as the actor', () => {
    // Arrange
    join(t, 'worker-a', 'agent:ui');

    // Act
    push(t, 'worker-a', [op('agent:ui', 1)]);

    // Assert
    expect(t.db.boardOp.op_id.find('agent:ui:1')!.actor).toBe('agent:ui');
  });
});

describe('presence and cursors', () => {
  let t: Harness;
  beforeEach(() => {
    t = makeHarness();
    t.as('worker-a', (ctx) => mod.create_board(ctx, { id: BOARD, name: 'Main' }));
    join(t, 'worker-a', 'ann');
    join(t, 'worker-a', 'bot', 'agent');
  });

  it('keys presence by connection and actor, so one connection can host several actors', () => {
    // Act
    presence(t, 'worker-a', 'ann', { tool: 'select', detail: 'frame 1', typing: 'hello', status: 'working' });
    presence(t, 'worker-a', 'bot');
    presence(t, 'worker-a', 'ann', { status: 'idle', tool: 'select' });

    // Assert
    const rows = all(t.db.boardPresence.iter());
    expect(rows).toHaveLength(2);
    const ann = rows.find((r) => r.actor === 'ann')!;
    expect([ann.status, ann.tool]).toEqual(['idle', 'select']);
    expect(ann.presence_id).toMatch(/:ann$/);
  });

  it('two connections of one identity do not overwrite each other', () => {
    // Act
    presence(t, 'worker-a', 'ann');
    asConn(t, 'worker-a', 99n, (ctx) =>
      mod.set_board_presence(ctx, { board_id: BOARD, actor: 'ann', selection: '[]', status: 'idle', tool: '', detail: '', typing: '', viewport: '{}' }),
    );

    // Assert
    expect(all(t.db.boardPresence.iter())).toHaveLength(2);
  });

  it('refuses presence and cursors for an actor the caller does not own', () => {
    expect(() => presence(t, 'worker-b', 'ann')).toThrow(/different identity/);
    expect(() =>
      t.as('worker-b', (ctx) => mod.move_cursor(ctx, { board_id: BOARD, actor: 'ann', x: 1, y: 2, tx: 3, ty: 4, move_ms: 50, down: false })),
    ).toThrow(/different identity/);
  });

  it('move_cursor accepts the owner and keeps nothing in a table (event table)', () => {
    // Act + Assert
    expect(() =>
      t.as('worker-a', (ctx) => mod.move_cursor(ctx, { board_id: BOARD, actor: 'ann', x: 1, y: 2, tx: 3, ty: 4, move_ms: 50, down: true })),
    ).not.toThrow();
  });
});

describe('write_board_snapshot', () => {
  let t: Harness;
  beforeEach(() => {
    t = makeHarness();
    t.as('worker-a', (ctx) => mod.create_board(ctx, { id: BOARD, name: 'Main' }));
    join(t, 'worker-a', 'ann');
    push(t, 'worker-a', [op('ann', 1), op('ann', 2), op('ann', 3)]);
  });

  it('an operator writes it, deletes ops up to upto_seq and sets snapshot_seq', () => {
    // Act
    asOperator(t, (ctx) => mod.write_board_snapshot(ctx, { board_id: BOARD, upto_seq: 1n, doc: '{"v":1}' }));
    asOperator(t, (ctx) => mod.write_board_snapshot(ctx, { board_id: BOARD, upto_seq: 1n, doc: '{"v":2}' }));

    // Assert
    expect(all(t.db.boardOp.iter()).map((o) => o.seq)).toEqual([2n]);
    expect(t.db.board.id.find(BOARD)!.snapshot_seq).toBe(1n);
    expect(t.db.boardSnapshot.board_id.find(BOARD)!.doc).toBe('{"v":2}');
  });

  it('a system actor owner may write; a human actor owner and strangers may not', () => {
    // Arrange
    join(t, 'worker-b', 'sys', 'system');

    // Act + Assert
    expect(() => t.as('worker-a', (ctx) => mod.write_board_snapshot(ctx, { board_id: BOARD, upto_seq: 0n, doc: '{}' }))).toThrow(/operator or a system actor/);
    expect(() => t.as('outsider', (ctx) => mod.write_board_snapshot(ctx, { board_id: BOARD, upto_seq: 0n, doc: '{}' }))).toThrow(/operator or a system actor/);
    t.as('worker-b', (ctx) => mod.write_board_snapshot(ctx, { board_id: BOARD, upto_seq: 2n, doc: '{}' }));
    expect(all(t.db.boardOp.iter())).toHaveLength(0);
  });

  it('refuses upto_seq at or beyond next_seq', () => {
    expect(() => asOperator(t, (ctx) => mod.write_board_snapshot(ctx, { board_id: BOARD, upto_seq: 3n, doc: '{}' }))).toThrow(/next_seq/);
    expect(all(t.db.boardOp.iter())).toHaveLength(3);
  });
});

describe('board messages', () => {
  let t: Harness;
  const post = (who: Who, id: string, thread: string, author: string, body = 'hi') =>
    t.as(who, (ctx) =>
      mod.post_board_message(ctx, { id, board_id: BOARD, thread_id: thread, kind: 'comment', author, to_actor: 'bob', body, anchor: '{"x":1}' }),
    );
  beforeEach(() => {
    t = makeHarness();
    t.as('worker-a', (ctx) => mod.create_board(ctx, { id: BOARD, name: 'Main' }));
    join(t, 'worker-a', 'ann');
    join(t, 'worker-b', 'bob');
  });

  it('stores a message authored by an owned actor and refuses a duplicate id, a stranger and a bad body', () => {
    // Act
    post('worker-a', 'm1', 't1', 'ann');

    // Assert
    const m = t.db.boardMessage.id.find('m1')!;
    expect([m.author, m.to_actor, m.anchor, m.resolved]).toEqual(['ann', 'bob', '{"x":1}', false]);
    expect(() => post('worker-a', 'm1', 't1', 'ann')).toThrow(/already exists/);
    expect(() => post('worker-b', 'm2', 't1', 'ann')).toThrow(/different identity/);
    expect(() => post('worker-a', 'm3', 't1', 'ann', '')).toThrow(/body must be/);
    expect(() => post('worker-a', 'm4', 't1', 'ann', 'x'.repeat(4_001))).toThrow(/body must be/);
    expect(() => post('worker-a', 'm5', 't1', 'ann', 'x'.repeat(4_000))).not.toThrow();
    expect(() =>
      t.as('worker-a', (ctx) => mod.post_board_message(ctx, { id: 'm6', board_id: BOARD, thread_id: 't', kind: 'tweet', author: 'ann', to_actor: undefined, body: 'x', anchor: undefined })),
    ).toThrow(/invalid message kind/);
  });

  it('resolve_board_thread resolves one thread for a board member only', () => {
    // Arrange
    post('worker-a', 'm1', 't1', 'ann');
    post('worker-b', 'm2', 't1', 'bob');
    post('worker-b', 'm3', 't2', 'bob');

    // Act
    expect(() => t.as('outsider', (ctx) => mod.resolve_board_thread(ctx, { board_id: BOARD, thread_id: 't1' }))).toThrow(/join the board/);
    t.as('worker-b', (ctx) => mod.resolve_board_thread(ctx, { board_id: BOARD, thread_id: 't1' }));

    // Assert
    expect(all(t.db.boardMessage.iter()).map((m) => [m.id, m.resolved])).toEqual(
      expect.arrayContaining([['m1', true], ['m2', true], ['m3', false]]),
    );
  });
});

describe('onDisconnect', () => {
  let t: Harness;
  beforeEach(() => {
    t = makeHarness();
    t.as('worker-a', (ctx) => mod.create_board(ctx, { id: BOARD, name: 'Main' }));
    join(t, 'worker-a', 'ann');
    join(t, 'worker-a', 'bot', 'agent');
    join(t, 'worker-b', 'bob');
  });

  const claimShape = (who: Who, actor: string, target: string) =>
    t.as(who, (ctx) =>
      mod.claim_design(ctx, { target, kind: 'board', scope: BOARD, intent: 'replace', ttl_secs: 60, actor, agent_id: undefined }),
    );

  it('deletes every presence row of the connection, and the identity claims when no presence remains', () => {
    // Arrange (worker-a is connection 1)
    presence(t, 'worker-a', 'ann');
    presence(t, 'worker-a', 'bot');
    presence(t, 'worker-b', 'bob');
    claimShape('worker-a', 'ann', 'shape:1');
    claimShape('worker-b', 'bob', 'shape:2');

    // Act
    t.as('worker-a', (ctx) => mod.onDisconnect(ctx, {}));

    // Assert
    expect(all(t.db.boardPresence.iter()).map((p) => p.actor)).toEqual(['bob']);
    expect(all(t.db.designClaim.iter()).map((c) => c.target)).toEqual(['shape:2']);
  });

  it('keeps the claims while the identity still has presence on another connection', () => {
    // Arrange
    presence(t, 'worker-a', 'ann');
    asConn(t, 'worker-a', 99n, (ctx) =>
      mod.set_board_presence(ctx, { board_id: BOARD, actor: 'ann', selection: '[]', status: 'idle', tool: '', detail: '', typing: '', viewport: '{}' }),
    );
    claimShape('worker-a', 'ann', 'shape:1');

    // Act
    t.as('worker-a', (ctx) => mod.onDisconnect(ctx, {}));

    // Assert
    expect(all(t.db.boardPresence.iter())).toHaveLength(1);
    expect(all(t.db.designClaim.iter())).toHaveLength(1);

    // Act: the last connection goes
    asConn(t, 'worker-a', 99n, (ctx) => mod.onDisconnect(ctx, {}));
    expect(all(t.db.boardPresence.iter())).toHaveLength(0);
    expect(all(t.db.designClaim.iter())).toHaveLength(0);
  });
});
