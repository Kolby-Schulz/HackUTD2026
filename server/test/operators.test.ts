// Operator gating (#62): run bookkeeping and the reset are refused from a connection that is
// not known to the database (no agent, machine or pairing row), and upsert_symbols is taken
// only from the holder of the mapper service lock. The database name is public, so this is
// what keeps a stranger from wiping or hijacking a run.
import { describe, it, expect, beforeEach } from 'vitest';
import { makeHarness, register, asOperator, asMapper, mod, all, sym, FEES, MACHINE, type Harness, type Who, type Ctx } from './helpers';

const REFUSED = /only an operator can do this/;

function startRun(t: Harness) {
  asOperator(t, (ctx) => mod.start_run(ctx, { mode: 'with_contract', seed: 7 }));
  return all(t.db.run.iter()).at(-1)!;
}

/** Every gated call, as `who`, against a database with one ended run and one task. */
function gated(t: Harness, who: Who, runId: bigint, taskId: bigint): Record<string, () => void> {
  const as = (body: (ctx: Ctx) => void) => () => t.as(who, body);
  return {
    start_run: as((ctx) => mod.start_run(ctx, { mode: 'without_contract', seed: 1 })),
    end_run: as((ctx) => mod.end_run(ctx, { run_id: runId })),
    create_task: as((ctx) => mod.create_task(ctx, { title: 'x', description: 'x', agent_id: 'agent-a', run_id: runId })),
    mark_attempt_wasted: as((ctx) => mod.mark_attempt_wasted(ctx, { task_id: taskId, attempt: 1 })),
    reset_demo_state: as((ctx) => mod.reset_demo_state(ctx, {})),
  };
}

describe('operator-only reducers', () => {
  let t: Harness;
  let runId: bigint;
  let taskId: bigint;
  beforeEach(() => {
    t = makeHarness();
    runId = startRun(t).id;
    asOperator(t, (ctx) => mod.create_task(ctx, { title: 'Late fees', description: 'd', agent_id: 'agent-a', run_id: runId }));
    taskId = all(t.db.task.iter())[0].id;
  });

  it.each(['start_run', 'end_run', 'create_task', 'mark_attempt_wasted', 'reset_demo_state'])(
    '%s is refused from an identity with no agent, machine or pairing row',
    (name) => {
      // Arrange
      const call = gated(t, 'outsider', runId, taskId)[name]!;

      // Act + Assert
      expect(call).toThrow(REFUSED);
      expect(all(t.db.run.iter())).toHaveLength(1);
      expect(t.db.run.id.find(runId)!.ended_at).toBeUndefined();
      expect(all(t.db.task.iter())).toHaveLength(1);
      expect(t.db.task.id.find(taskId)!.attempt).toBe(1);
    },
  );

  it('a registered agent counts as an operator', () => {
    // Arrange
    register(t, 'agent-b');

    // Act
    const act = gated(t, 'worker-b', runId, taskId);
    act.create_task();
    act.mark_attempt_wasted();
    act.end_run();
    act.reset_demo_state();
    act.start_run();

    // Assert
    expect(all(t.db.task.iter())).toHaveLength(2);
    expect(t.db.task.id.find(taskId)!.attempt).toBe(2);
    expect(t.db.run.id.find(runId)!.ended_at).toBeDefined();
    expect(all(t.db.run.iter())).toHaveLength(2);
  });

  it("a laptop's control daemon (machine row) counts as an operator", () => {
    // Arrange: asOperator registered MACHINE as 'daemon' in beforeEach.
    expect(t.db.machine.id.find(MACHINE)!.identity).toBeDefined();

    // Act
    const act = gated(t, 'daemon', runId, taskId);
    act.create_task();
    act.end_run();

    // Assert
    expect(all(t.db.task.iter())).toHaveLength(2);
    expect(t.db.run.id.find(runId)!.ended_at).toBeDefined();
  });

  it('a dashboard paired with a machine counts as an operator, and loses it when unpaired', () => {
    // Arrange: the daemon pairs the dashboard's identity (as resolve_machine_pairing does).
    const before = gated(t, 'dashboard', runId, taskId);
    expect(before.create_task).toThrow(REFUSED);
    let dashboard!: Ctx['sender'];
    t.as('dashboard', (ctx) => void (dashboard = ctx.sender));
    t.as('daemon', (ctx) => mod.grant_machine_access(ctx, { machine_id: MACHINE, identity: dashboard, label: 'browser' }));

    // Act
    before.create_task();
    t.as('daemon', (ctx) => mod.revoke_machine_access(ctx, { machine_id: MACHINE, identity: dashboard }));

    // Assert
    expect(all(t.db.task.iter())).toHaveLength(2);
    expect(before.create_task).toThrow(REFUSED);
    expect(before.end_run).toThrow(REFUSED);
    expect(all(t.db.task.iter())).toHaveLength(2);
  });
});

describe('upsert_symbols is the mapper lock holder only', () => {
  let t: Harness;
  const upsert = (who: Who) => () =>
    t.as(who, (ctx) => mod.upsert_symbols(ctx, { file: 'src/billing/fees.ts', symbols: [sym(FEES)], edges: [] }));

  beforeEach(() => {
    t = makeHarness();
  });

  it('is refused from a stranger, a registered agent and an operator machine', () => {
    // Arrange
    register(t, 'agent-a');
    asOperator(t, (ctx) => mod.start_run(ctx, { mode: 'with_contract', seed: 1 }));

    // Act + Assert
    for (const who of ['outsider', 'worker-a', 'daemon'] as const) {
      expect(upsert(who)).toThrow(/only the mapper can write the code map/);
    }
    expect(all(t.db.symbol.iter())).toHaveLength(0);
  });

  it('is accepted from the holder of the mapper service lock, until another mapper takes it over', () => {
    // Arrange
    asMapper(t, (ctx) => mod.upsert_symbols(ctx, { file: 'src/billing/fees.ts', symbols: [sym(FEES)], edges: [] }));
    expect(all(t.db.symbol.iter())).toHaveLength(1);

    // Act: the lock goes stale (30 s) and a mapper on another laptop claims it.
    t.advance(31);
    t.as('worker-c', (ctx) => mod.claim_service(ctx, { name: 'mapper', machine: 'other-laptop', holder: 'm2' }));

    // Assert
    expect(upsert('mapper')).toThrow(/only the mapper can write the code map/);
    expect(upsert('worker-c')).not.toThrow();
  });
});
