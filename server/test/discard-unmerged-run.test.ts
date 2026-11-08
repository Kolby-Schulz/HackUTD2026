// discard_unmerged_run: `npm run reset` takes back what a run it ends before a merge produced.
import { describe, it, expect, beforeEach } from 'vitest';
import { makeHarness, register, asOperator, mod, all, FEES, type Harness } from './helpers';

const edit = (t: Harness, diff: string) =>
  t.as('worker-a', (ctx) => mod.report_edit(ctx, { agent_id: 'agent-a', file: 'src/billing/fees.ts', diff, symbol_ids: [FEES] }));

/** A conflict with its decision, push and the change that caused it, all stamped now. */
function conflictRows(t: Harness, details: string) {
  t.internal((ctx) => {
    const at = ctx.timestamp;
    ctx.db.change.insert({ id: 0n, agent_id: 'agent-a', symbol_id: FEES, kind: 'signature', old_signature: undefined, new_signature: undefined, description: details, created_at: at });
    const c = ctx.db.conflict.insert({ id: 0n, kind: 'signature', symbol_id: FEES, agent_a: 'agent-a', agent_b: 'agent-b', details, status: 'resolved', created_at: at, resolved_at: at });
    ctx.db.decision.insert({ id: 0n, conflict_id: c.id, owner_agent: 'agent-a', instructions_a: '', instructions_b: '', reason: details, created_at: at });
    ctx.db.instruction.insert({ id: 0n, agent_id: 'agent-b', conflict_id: c.id, text: details, acknowledged: true, created_at: at });
  });
}
const runIds = (t: Harness) => all(t.db.run.iter()).map((r) => r.id).sort();
const texts = (t: Harness) => ({
  edits: all(t.db.fileEdit.iter()).map((e) => e.diff).sort(),
  changes: all(t.db.change.iter()).map((c) => c.description).sort(),
  conflicts: all(t.db.conflict.iter()).map((c) => c.details).sort(),
  decisions: all(t.db.decision.iter()).map((d) => d.reason).sort(),
  instructions: all(t.db.instruction.iter()).map((i) => i.text).sort(),
});

describe('discard_unmerged_run', () => {
  let t: Harness;
  beforeEach(() => {
    t = makeHarness();
    register(t, 'agent-a');
  });

  it("deletes only the ended run's edits, changes and conflicts", () => {
    edit(t, 'before');
    conflictRows(t, 'before');
    t.advance(1);
    asOperator(t, (ctx) => mod.start_run(ctx, { mode: 'with_contract', seed: 0 }));
    const [run1] = runIds(t);
    t.advance(1);
    edit(t, 'run 1');
    conflictRows(t, 'run 1');
    t.advance(1);
    asOperator(t, (ctx) => mod.end_run(ctx, { run_id: run1 }));
    t.advance(1);
    asOperator(t, (ctx) => mod.start_run(ctx, { mode: 'with_contract', seed: 0 }));
    t.advance(1);
    edit(t, 'run 2');
    conflictRows(t, 'run 2');
    asOperator(t, (ctx) => mod.discard_unmerged_run(ctx, { run_id: run1 }));
    const kept = ['before', 'run 2'];
    expect(texts(t)).toEqual({ edits: kept, changes: kept, conflicts: kept, decisions: kept, instructions: kept });
  });

  it('refuses an open or unknown run, and non-operators', () => {
    asOperator(t, (ctx) => mod.start_run(ctx, { mode: 'with_contract', seed: 0 }));
    const [run] = runIds(t);
    edit(t, 'live');
    expect(() => asOperator(t, (ctx) => mod.discard_unmerged_run(ctx, { run_id: run }))).toThrow(/still open/);
    expect(() => asOperator(t, (ctx) => mod.discard_unmerged_run(ctx, { run_id: 99n }))).toThrow(/unknown run/);
    asOperator(t, (ctx) => mod.end_run(ctx, { run_id: run }));
    expect(() => t.as('outsider', (ctx) => mod.discard_unmerged_run(ctx, { run_id: run }))).toThrow(/only an operator/);
    expect(all(t.db.fileEdit.iter())).toHaveLength(1);
  });
});
