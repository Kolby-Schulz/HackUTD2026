// resolve_conflict, dismiss_conflict, acknowledge_instruction (spec section 7).
import { describe, it, expect, beforeEach } from 'vitest';
import {
  makeHarness,
  register,
  seedCodeMap,
  plan,
  reportChange,
  mod,
  all,
  FEES,
  CHECKOUT,
  type Harness,
  type Who,
  asOperator,
} from './helpers';

const status = (t: Harness, id: string) => t.db.agent.id.find(id)!.status;
const instructionsFor = (t: Harness, id: string) => all(t.db.instruction.agent_id.filter(id));

/** A, B, C and the coordinator registered; A changed FEES and B (depends on it) is paused. */
function withOpenConflict(t: Harness) {
  seedCodeMap(t);
  for (const id of ['agent-a', 'agent-b', 'agent-c', 'coordinator']) register(t, id);
  plan(t, 'agent-a', [{ symbol_id: FEES, intent: 'modify' }]);
  plan(t, 'agent-b', [{ symbol_id: FEES, intent: 'depend' }]);
  reportChange(t, 'agent-a', FEES, 'behavior', 'rounds half-up');
  return all(t.db.conflict.iter())[0];
}

function resolve(t: Harness, conflict_id: bigint, who: Who = 'coordinator', owner_agent = 'agent-a') {
  t.as(who, (ctx) =>
    mod.resolve_conflict(ctx, {
      conflict_id,
      owner_agent,
      instructions_a: 'Keep the half-up rounding in calculateFee.',
      instructions_b: 'Do not round again in checkout; use calculateFee as is.',
      reason: 'A owns the fee rules.',
    }),
  );
}

function dismiss(t: Harness, conflict_id: bigint, who: Who = 'coordinator') {
  t.as(who, (ctx) => mod.dismiss_conflict(ctx, { conflict_id, reason: 'B only reads the result' }));
}

describe('resolve_conflict', () => {
  let t: Harness;
  let conflictId: bigint;
  beforeEach(() => {
    t = makeHarness();
    conflictId = withOpenConflict(t).id;
  });

  it('inserts a decision, one instruction per agent, resolves and unpauses', () => {
    // Arrange
    expect(status(t, 'agent-b')).toBe('paused');
    t.advance(3);

    // Act
    resolve(t, conflictId);

    // Assert
    const [d] = all(t.db.decision.iter());
    expect(d).toMatchObject({ conflict_id: conflictId, owner_agent: 'agent-a', reason: 'A owns the fee rules.' });
    const c = t.db.conflict.id.find(conflictId)!;
    expect(c.status).toBe('resolved');
    expect(c.resolved_at!.microsSinceUnixEpoch).toBe(t.now());
    expect(instructionsFor(t, 'agent-a').map((i) => i.text)).toEqual(['Keep the half-up rounding in calculateFee.']);
    expect(instructionsFor(t, 'agent-b').map((i) => i.text)).toEqual([
      `${FEES} was changed by agent-a. Pause and wait for the coordinator.`,
      'Do not round again in checkout; use calculateFee as is.',
    ]);
    expect(instructionsFor(t, 'agent-b').every((i) => i.conflict_id === conflictId)).toBe(true);
    expect(status(t, 'agent-b')).toBe('working');
  });

  it.each<Who>(['worker-a', 'worker-b', 'outsider'])('rejects a caller that is not the coordinator (%s)', (who) => {
    // Arrange
    const before = all(t.db.instruction.iter()).length;

    // Act
    const act = () => resolve(t, conflictId, who);

    // Assert
    expect(act).toThrow(/only the coordinator/);
    expect(t.db.conflict.id.find(conflictId)!.status).toBe('open');
    expect(all(t.db.instruction.iter())).toHaveLength(before);
    expect(all(t.db.decision.iter())).toHaveLength(0);
  });

  it('rejects when no coordinator is registered at all', () => {
    // Arrange
    const t2 = makeHarness();
    seedCodeMap(t2);
    register(t2, 'agent-a');
    register(t2, 'agent-b');
    plan(t2, 'agent-b', [{ symbol_id: FEES, intent: 'depend' }]);
    reportChange(t2, 'agent-a', FEES);
    const id = all(t2.db.conflict.iter())[0].id;

    // Act
    const act = () => resolve(t2, id);

    // Assert
    expect(act).toThrow(/only the coordinator/);
  });

  it('rejects an agent squatting on the coordinator id from another identity', () => {
    // Arrange: the real coordinator is registered and holds the coordinator lock; worker-c tries to impersonate it.
    t.as('coordinator', (ctx) => mod.claim_service(ctx, { name: 'coordinator', machine: 'laptop-1', holder: 'p1' }));
    const act0 = () =>
      t.as('worker-c', (ctx) =>
        mod.register_agent(ctx, {
          id: 'coordinator',
          name: 'x',
          owner_dev: 'x',
          machine: 'x',
          model: 'x',
          token_budget: 0n,
        }),
      );

    // Act
    const act = () => resolve(t, conflictId, 'worker-c');

    // Assert
    expect(act0).toThrow(/coordinator is already running on laptop-1/);
    expect(act).toThrow(/only the coordinator/);
  });

  it.each(['resolved', 'dismissed'])('rejects a conflict that is already %s', (finalStatus) => {
    // Arrange
    if (finalStatus === 'resolved') resolve(t, conflictId);
    else dismiss(t, conflictId);

    // Act
    const act = () => resolve(t, conflictId);

    // Assert
    expect(act).toThrow(new RegExp(`is ${finalStatus}, not open`));
    expect(all(t.db.decision.iter()).length).toBe(finalStatus === 'resolved' ? 1 : 0);
  });

  it("accepts a conflict in 'resolving' (coordinator marked it while thinking)", () => {
    // Arrange
    t.internal((ctx) => {
      const c = ctx.db.conflict.id.find(conflictId)!;
      ctx.db.conflict.id.update({ ...c, status: 'resolving' });
    });

    // Act
    resolve(t, conflictId);

    // Assert
    expect(t.db.conflict.id.find(conflictId)!.status).toBe('resolved');
  });

  it('rejects an unknown conflict', () => {
    // Arrange
    const unknown = 999n;

    // Act
    const act = () => resolve(t, unknown);

    // Assert
    expect(act).toThrow(/unknown conflict 999/);
  });

  it('rejects an owner_agent that is not part of the conflict', () => {
    // Arrange
    const owner = 'agent-c';

    // Act
    const act = () => resolve(t, conflictId, 'coordinator', owner);

    // Assert
    expect(act).toThrow(/not part of conflict/);
    expect(t.db.conflict.id.find(conflictId)!.status).toBe('open');
  });

  it('accepts either agent of the pair as owner', () => {
    // Arrange
    const owner = 'agent-b';

    // Act
    resolve(t, conflictId, 'coordinator', owner);

    // Assert
    expect(all(t.db.decision.iter())[0].owner_agent).toBe('agent-b');
  });

  it('keeps B paused while another broken_dependency conflict still holds it', () => {
    // Arrange: C also changes something B's plan touches, opening a second conflict for B.
    plan(t, 'agent-b', [
      { symbol_id: FEES, intent: 'depend' },
      { symbol_id: CHECKOUT, intent: 'depend' },
    ]);
    reportChange(t, 'agent-c', CHECKOUT, 'behavior', 'adds receipt');
    const second = all(t.db.conflict.iter()).find((c) => c.symbol_id === CHECKOUT)!;

    // Act
    resolve(t, conflictId);
    const afterFirst = status(t, 'agent-b');
    resolve(t, second.id, 'coordinator', 'agent-c');

    // Assert
    expect(afterFirst).toBe('paused');
    expect(status(t, 'agent-b')).toBe('working');
  });

  it('does not change an agent that was not paused', () => {
    // Arrange
    asOperator(t, (ctx) => mod.start_run(ctx, { mode: 'with_contract', seed: 7 }));
    const runId = all(t.db.run.iter())[0].id;
    asOperator(t, (ctx) => mod.create_task(ctx, { title: 'x', description: 'x', agent_id: 'agent-a', run_id: runId }));
    const taskId = all(t.db.task.iter())[0].id;
    t.as('worker-a', (ctx) => mod.set_task_status(ctx, { task_id: taskId, status: 'in_progress' }));
    t.as('worker-a', (ctx) => mod.set_task_status(ctx, { task_id: taskId, status: 'done' }));

    // Act
    resolve(t, conflictId);

    // Assert
    expect(status(t, 'agent-a')).toBe('done');
  });
});

describe('dismiss_conflict', () => {
  let t: Harness;
  let conflictId: bigint;
  beforeEach(() => {
    t = makeHarness();
    conflictId = withOpenConflict(t).id;
  });

  it('marks it dismissed, tells the paused agent to continue, and unpauses it', () => {
    // Arrange
    t.advance(2);

    // Act
    dismiss(t, conflictId);

    // Assert
    const c = t.db.conflict.id.find(conflictId)!;
    expect(c.status).toBe('dismissed');
    expect(c.resolved_at!.microsSinceUnixEpoch).toBe(t.now());
    expect(instructionsFor(t, 'agent-b').at(-1)!.text).toBe(
      `False alarm on ${FEES}: B only reads the result. Continue your task.`,
    );
    expect(status(t, 'agent-b')).toBe('working');
    expect(all(t.db.decision.iter())).toHaveLength(0);
  });

  it('rejects a non-coordinator', () => {
    // Arrange
    const who: Who = 'worker-b';

    // Act
    const act = () => dismiss(t, conflictId, who);

    // Assert
    expect(act).toThrow(/only the coordinator/);
    expect(status(t, 'agent-b')).toBe('paused');
  });

  it('rejects a conflict that is no longer open', () => {
    // Arrange
    dismiss(t, conflictId);

    // Act
    const act = () => dismiss(t, conflictId);

    // Assert
    expect(act).toThrow(/is dismissed, not open/);
  });

  it('sends no instruction when nobody is paused (claim contention)', () => {
    // Arrange
    t.as('worker-a', (ctx) => mod.claim_symbol(ctx, { agent_id: 'agent-a', symbol_id: CHECKOUT, ttl_secs: 60 }));
    t.as('worker-c', (ctx) => mod.claim_symbol(ctx, { agent_id: 'agent-c', symbol_id: CHECKOUT, ttl_secs: 60 }));
    const contention = all(t.db.conflict.iter()).find((c) => c.kind === 'claim_contention')!;
    const before = all(t.db.instruction.iter()).length;

    // Act
    dismiss(t, contention.id);

    // Assert
    expect(all(t.db.instruction.iter())).toHaveLength(before);
  });
});

describe('acknowledge_instruction', () => {
  let t: Harness;
  let instrId: bigint;
  const ack = (who: Who, instruction_id = instrId) =>
    t.as(who, (ctx) => mod.acknowledge_instruction(ctx, { instruction_id }));

  beforeEach(() => {
    t = makeHarness();
    withOpenConflict(t);
    instrId = instructionsFor(t, 'agent-b')[0].id;
  });

  it("marks the agent's own instruction read", () => {
    // Arrange
    expect(t.db.instruction.id.find(instrId)!.acknowledged).toBe(false);

    // Act
    ack('worker-b');

    // Assert
    expect(t.db.instruction.id.find(instrId)!.acknowledged).toBe(true);
  });

  it('is idempotent', () => {
    // Arrange
    ack('worker-b');

    // Act
    const act = () => ack('worker-b');

    // Assert
    expect(act).not.toThrow();
    expect(t.db.instruction.id.find(instrId)!.acknowledged).toBe(true);
  });

  it.each<Who>(['worker-a', 'coordinator', 'outsider'])("rejects acking another agent's instruction (%s)", (who) => {
    // Arrange
    const id = instrId;

    // Act
    const act = () => ack(who, id);

    // Assert
    expect(act).toThrow(/different identity/);
    expect(t.db.instruction.id.find(instrId)!.acknowledged).toBe(false);
  });

  it('rejects an unknown instruction', () => {
    // Arrange
    const unknown = 12345n;

    // Act
    const act = () => ack('worker-b', unknown);

    // Assert
    expect(act).toThrow(/unknown instruction 12345/);
  });
});

describe('mark_conflict_resolving', () => {
  let t: Harness;
  let conflictId: bigint;
  beforeEach(() => {
    t = makeHarness();
    conflictId = withOpenConflict(t).id;
  });
  const mark = (who: Who = 'coordinator', conflict_id = conflictId) =>
    t.as(who, (ctx) => mod.mark_conflict_resolving(ctx, { conflict_id }));

  it("moves an open conflict to 'resolving' and leaves B paused", () => {
    // Act
    mark();

    // Assert
    expect(t.db.conflict.id.find(conflictId)!.status).toBe('resolving');
    expect(status(t, 'agent-b')).toBe('paused');
  });

  it('then resolve_conflict still works', () => {
    // Arrange
    mark();

    // Act
    resolve(t, conflictId);

    // Assert
    expect(t.db.conflict.id.find(conflictId)!.status).toBe('resolved');
    expect(status(t, 'agent-b')).toBe('working');
  });

  it.each<Who>(['worker-a', 'worker-b', 'outsider'])('rejects a caller that is not the coordinator (%s)', (who) => {
    // Act
    const act = () => mark(who);

    // Assert
    expect(act).toThrow(/only the coordinator/);
    expect(t.db.conflict.id.find(conflictId)!.status).toBe('open');
  });

  it('rejects a conflict that is not open (so two coordinators never both take it)', () => {
    // Arrange
    mark();

    // Act
    const act = () => mark();

    // Assert
    expect(act).toThrow(/is resolving, not open/);
  });

  it('rejects an unknown conflict', () => {
    // Act
    const act = () => mark('coordinator', 999n);

    // Assert
    expect(act).toThrow(/unknown conflict 999/);
  });
});
