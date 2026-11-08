// reset_demo_state: per-run working state is cleared between demo runs; history is kept.
import { describe, it, expect, beforeEach } from 'vitest';
import { makeHarness, register, seedCodeMap, plan, claim, reportChange, mod, all, FEES, TOTAL, type Harness } from './helpers';

const reset = (t: Harness) => t.as('outsider', (ctx) => mod.reset_demo_state(ctx, {}));
const startRun = (t: Harness) => t.as('outsider', (ctx) => mod.start_run(ctx, { mode: 'with_contract', seed: 7 }));
const endRun = (t: Harness, id: bigint) => t.as('outsider', (ctx) => mod.end_run(ctx, { run_id: id }));

describe('reset_demo_state', () => {
  let t: Harness;
  beforeEach(() => {
    t = makeHarness();
    seedCodeMap(t);
    for (const id of ['agent-a', 'agent-b', 'coordinator']) register(t, id);
    // A run's worth of state: plans, a claim, an agent-reported signature, a paused agent.
    plan(t, 'agent-b', [{ symbol_id: TOTAL, intent: 'depend' }]);
    plan(t, 'agent-a', [{ symbol_id: FEES, intent: 'modify' }]);
    claim(t, 'agent-a', FEES);
    reportChange(t, 'agent-a', FEES, 'signature', 'adds bps', 'calculateFee(amountCents: number, bps: number): number');
  });

  it('clears the code map, plans, claims and undelivered instructions', () => {
    // Arrange
    expect(all(t.db.instruction.iter()).some((i) => !i.acknowledged)).toBe(true);

    // Act
    reset(t);

    // Assert
    expect(all(t.db.symbol.iter())).toHaveLength(0);
    expect(all(t.db.symbolEdge.iter())).toHaveLength(0);
    expect(all(t.db.plan.iter())).toHaveLength(0);
    expect(all(t.db.planItem.iter())).toHaveLength(0);
    expect(all(t.db.claim.iter())).toHaveLength(0);
    expect(all(t.db.instruction.iter()).every((i) => i.acknowledged)).toBe(true);
  });

  it('dismisses live conflicts, sets agents idle, and keeps history rows', () => {
    // Arrange
    expect(t.db.agent.id.find('agent-b')?.status).toBe('paused');

    // Act
    reset(t);

    // Assert
    const conflicts = all(t.db.conflict.iter());
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].status).toBe('dismissed');
    expect(all(t.db.agent.iter()).map((a) => a.status)).toEqual(['idle', 'idle', 'idle']);
    expect(all(t.db.change.iter())).toHaveLength(1);
  });

  it('is refused while a run is open', () => {
    // Arrange
    startRun(t);

    // Act
    const act = () => reset(t);

    // Assert
    expect(act).toThrow(/still open/);
    expect(all(t.db.symbol.iter()).length).toBeGreaterThan(0);
  });

  it('works once the run has ended', () => {
    // Arrange
    startRun(t);
    endRun(t, all(t.db.run.iter())[0].id);

    // Act
    reset(t);

    // Assert
    expect(all(t.db.symbol.iter())).toHaveLength(0);
  });
});
