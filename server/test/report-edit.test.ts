// report_edit (spec-additions-live-code part A, issue #24).
import { describe, it, expect, beforeEach } from 'vitest';
import { makeHarness, register, mod, all, FEES, type Harness, type Who } from './helpers';

const edit = (t: Harness, who: Who, agent_id: string, n = 1, diff = '+x') =>
  t.as(who, (ctx) => mod.report_edit(ctx, { agent_id, file: 'src/billing/fees.ts', diff: `${diff}${n}`, symbol_ids: [FEES] }));

describe('report_edit', () => {
  let t: Harness;
  beforeEach(() => {
    t = makeHarness();
    register(t, 'agent-a');
    register(t, 'agent-b');
  });

  it('stores the diff and touched symbols', () => {
    edit(t, 'worker-a', 'agent-a');
    expect(all(t.db.fileEdit.iter())).toMatchObject([{ agent_id: 'agent-a', file: 'src/billing/fees.ts', diff: '+x1', symbol_ids: [FEES] }]);
  });

  it('keeps only the newest 50 per agent', () => {
    for (let i = 1; i <= 55; i++) edit(t, 'worker-a', 'agent-a', i);
    edit(t, 'worker-b', 'agent-b');
    const a = all(t.db.fileEdit.agent_id.filter('agent-a')).map((r) => r.diff);
    expect(a).toHaveLength(50);
    expect(a).not.toContain('+x5');
    expect(a).toContain('+x6');
    expect(a).toContain('+x55');
    expect(all(t.db.fileEdit.agent_id.filter('agent-b'))).toHaveLength(1);
  });

  it("rejects another agent's identity and truncates huge diffs", () => {
    expect(() => edit(t, 'worker-b', 'agent-a')).toThrow(/different identity/);
    edit(t, 'worker-a', 'agent-a', 1, 'y'.repeat(30_000));
    expect(all(t.db.fileEdit.iter())[0].diff).toMatch(/diff truncated\)$/);
  });
});
