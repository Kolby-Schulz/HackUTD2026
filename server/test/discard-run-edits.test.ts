// discard_run_edits: `npm run reset` drops the diffs of runs it ends before a merge.
import { describe, it, expect, beforeEach } from 'vitest';
import { makeHarness, register, asOperator, mod, all, FEES, type Harness } from './helpers';

const edit = (t: Harness, diff: string) =>
  t.as('worker-a', (ctx) => mod.report_edit(ctx, { agent_id: 'agent-a', file: 'src/billing/fees.ts', diff, symbol_ids: [FEES] }));
const runIds = (t: Harness) => all(t.db.run.iter()).map((r) => r.id).sort();

describe('discard_run_edits', () => {
  let t: Harness;
  beforeEach(() => {
    t = makeHarness();
    register(t, 'agent-a');
  });

  it("deletes only the ended run's edits", () => {
    edit(t, 'before');
    t.advance(1);
    asOperator(t, (ctx) => mod.start_run(ctx, { mode: 'with_contract', seed: 0 }));
    const [run1] = runIds(t);
    t.advance(1);
    edit(t, 'in run 1');
    t.advance(1);
    asOperator(t, (ctx) => mod.end_run(ctx, { run_id: run1 }));
    t.advance(1);
    asOperator(t, (ctx) => mod.start_run(ctx, { mode: 'with_contract', seed: 0 }));
    t.advance(1);
    edit(t, 'in run 2');
    asOperator(t, (ctx) => mod.discard_run_edits(ctx, { run_id: run1 }));
    expect(all(t.db.fileEdit.iter()).map((e) => e.diff).sort()).toEqual(['before', 'in run 2']);
  });

  it('refuses an open or unknown run, and non-operators', () => {
    asOperator(t, (ctx) => mod.start_run(ctx, { mode: 'with_contract', seed: 0 }));
    const [run] = runIds(t);
    edit(t, 'live');
    expect(() => asOperator(t, (ctx) => mod.discard_run_edits(ctx, { run_id: run }))).toThrow(/still open/);
    expect(() => asOperator(t, (ctx) => mod.discard_run_edits(ctx, { run_id: 99n }))).toThrow(/unknown run/);
    asOperator(t, (ctx) => mod.end_run(ctx, { run_id: run }));
    expect(() => t.as('outsider', (ctx) => mod.discard_run_edits(ctx, { run_id: run }))).toThrow(/only an operator/);
    expect(all(t.db.fileEdit.iter())).toHaveLength(1);
  });
});
