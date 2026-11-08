// End-to-end walk through the planted "changed behavior" conflict (spec sections 3 and 14):
// A changes calculateFee to round half-up; B is mid-way through checkout, which calls it.
import { describe, it, expect } from 'vitest';
import { makeHarness, register, seedCodeMap, plan, claim, reportChange, mod, all, AGENT_OF, FEES, CHECKOUT, INVOICE } from './helpers';

describe('spec section 14: changed behavior, with Contract', () => {
  it('detects, pauses B, coordinator resolves, B resumes with instructions', () => {
    // Arrange: mapper loads the repo, a run with two tasks, agents and coordinator connect.
    const t = makeHarness();
    seedCodeMap(t);
    for (const id of ['agent-a', 'agent-b', 'coordinator']) register(t, id);
    t.as('outsider', (ctx) => mod.start_run(ctx, { mode: 'with_contract', seed: 7 }));
    const runId = all(t.db.run.iter())[0].id;
    for (const [agent_id, title] of [
      ['agent-a', 'Add late fees to invoices'],
      ['agent-b', 'Add a receipt to checkout'],
    ]) {
      t.as('outsider', (ctx) => mod.create_task(ctx, { title, description: title, agent_id, run_id: runId }));
    }
    const [taskA, taskB] = all(t.db.task.iter());
    for (const tk of [taskA, taskB]) {
      t.as(AGENT_OF[tk.agent_id], (ctx) => mod.set_task_status(ctx, { task_id: tk.id, status: 'in_progress' }));
    }
    plan(t, 'agent-a', [
      { symbol_id: FEES, intent: 'modify' },
      { symbol_id: INVOICE, intent: 'modify' },
    ], taskA.id, 'half-up fees + late fees');
    claim(t, 'agent-a', FEES);
    plan(t, 'agent-b', [{ symbol_id: CHECKOUT, intent: 'modify' }], taskB.id, 'receipt in checkout');

    // Act 1: A reports the behavior change.
    reportChange(t, 'agent-a', FEES, 'behavior', 'calculateFee now rounds half-up to the cent');

    // Assert 1: B is paused with a conflict and a pause instruction; A keeps working.
    const [conflict] = all(t.db.conflict.iter());
    expect(conflict).toMatchObject({ kind: 'broken_dependency', agent_a: 'agent-a', agent_b: 'agent-b', status: 'open' });
    expect(t.db.agent.id.find('agent-b')!.status).toBe('paused');
    expect(t.db.agent.id.find('agent-a')!.status).toBe('working');

    // Act 2: B's MCP tool tries to claim calculateFee to "fix" rounding itself.
    claim(t, 'agent-b', FEES);

    // Assert 2: Rule 3 keeps the claim with A.
    expect(t.db.claim.symbol_id.find(FEES)!.agent_id).toBe('agent-a');
    expect(all(t.db.conflict.iter()).map((c) => c.kind).sort()).toEqual(['broken_dependency', 'claim_contention']);

    // Act 3: coordinator decides A owns calculateFee; B must not round again.
    t.as('coordinator', (ctx) =>
      mod.resolve_conflict(ctx, {
        conflict_id: conflict.id,
        owner_agent: 'agent-a',
        instructions_a: 'Keep half-up rounding in calculateFee.',
        instructions_b: 'Do not round again in checkout; calculateFee already rounds half-up.',
        reason: 'A owns fee rounding; double rounding causes the 1-cent mismatch.',
      }),
    );
    const bInstr = all(t.db.instruction.agent_id.filter('agent-b'));
    for (const i of bInstr) t.as('worker-b', (ctx) => mod.acknowledge_instruction(ctx, { instruction_id: i.id }));

    // Assert 3: B is working again, has read both instructions, decision recorded.
    expect(t.db.agent.id.find('agent-b')!.status).toBe('working');
    expect(bInstr.map((i) => i.text)).toEqual([
      `${FEES} was changed by agent-a. Pause and wait for the coordinator.`,
      'Do not round again in checkout; calculateFee already rounds half-up.',
    ]);
    expect(all(t.db.instruction.agent_id.filter('agent-b')).every((i) => i.acknowledged)).toBe(true);
    expect(all(t.db.decision.iter())).toHaveLength(1);
    expect(t.db.symbol.id.find(FEES)).toMatchObject({
      behavior_note: 'calculateFee now rounds half-up to the cent',
      version: 2,
    });

    // Act 4: both finish; tokens logged; run ends.
    for (const [who, agent_id, tk] of [
      ['worker-a', 'agent-a', taskA],
      ['worker-b', 'agent-b', taskB],
    ] as const) {
      t.as(who, (ctx) =>
        mod.log_tokens(ctx, {
          run_id: runId,
          agent_id,
          task_id: tk.id,
          attempt: 1,
          purpose: 'code',
          prompt_tokens: 40_000,
          completion_tokens: 2_000,
          cache_read_tokens: 30_000,
          cost_usd: 0.05,
        }),
      );
      t.as(AGENT_OF[tk.agent_id], (ctx) => mod.set_task_status(ctx, { task_id: tk.id, status: 'done' }));
    }
    t.as('worker-a', (ctx) => mod.release_claim(ctx, { agent_id: 'agent-a', symbol_id: FEES }));
    t.as('outsider', (ctx) => mod.end_run(ctx, { run_id: runId }));

    // Assert 4
    expect(all(t.db.task.iter()).every((tk) => tk.status === 'done')).toBe(true);
    expect(all(t.db.tokenUsage.run_id.filter(runId))).toHaveLength(2);
    expect(all(t.db.claim.iter())).toHaveLength(0);
    expect(t.db.run.id.find(runId)!.ended_at).toBeDefined();
  });
});
