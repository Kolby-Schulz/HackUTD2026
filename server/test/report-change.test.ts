// report_change and Rule 1, broken dependency (spec sections 7 and 8).
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
  INVOICE,
  TOTAL,
  CHECKOUT,
  type Harness,
} from './helpers';

const conflicts = (t: Harness) => all(t.db.conflict.iter());
const instructionsFor = (t: Harness, id: string) => all(t.db.instruction.agent_id.filter(id));
const status = (t: Harness, id: string) => t.db.agent.id.find(id)!.status;

describe('report_change: recording the change', () => {
  let t: Harness;
  beforeEach(() => {
    t = makeHarness();
    seedCodeMap(t);
    register(t, 'agent-a');
  });

  it('inserts a change row with old and new signature', () => {
    // Arrange
    const newSig = 'calculateFee(amountCents: number, lateDays: number): number';

    // Act
    reportChange(t, 'agent-a', FEES, 'signature', 'adds lateDays', newSig);

    // Assert
    const [c] = all(t.db.change.iter());
    expect(c).toMatchObject({
      agent_id: 'agent-a',
      symbol_id: FEES,
      kind: 'signature',
      old_signature: 'calculateFee(amountCents: number): number',
      new_signature: newSig,
      description: 'adds lateDays',
    });
    expect(c.created_at.microsSinceUnixEpoch).toBe(t.now());
  });

  it('a signature change updates the symbol signature and bumps version', () => {
    // Arrange
    const newSig = 'calculateFee(cents: number): number';

    // Act
    reportChange(t, 'agent-a', FEES, 'signature', 'rename', newSig);

    // Assert
    expect(t.db.symbol.id.find(FEES)).toMatchObject({ signature: newSig, version: 2 });
  });

  it('a behavior change sets behavior_note, keeps the signature and bumps version', () => {
    // Arrange
    const before = t.db.symbol.id.find(FEES)!.signature;

    // Act
    reportChange(t, 'agent-a', FEES, 'behavior', 'rounds half-up to the cent');

    // Assert
    expect(t.db.symbol.id.find(FEES)).toMatchObject({
      signature: before,
      behavior_note: 'rounds half-up to the cent',
      version: 2,
    });
  });

  it('a signature report without new_signature keeps the old signature', () => {
    // Arrange
    const before = t.db.symbol.id.find(FEES)!.signature;

    // Act
    reportChange(t, 'agent-a', FEES, 'signature', 'hook saw a hash change');

    // Assert
    expect(t.db.symbol.id.find(FEES)!.signature).toBe(before);
  });

  it("'created' inserts a new symbol parsed from its id and opens no conflicts", () => {
    // Arrange
    const id = 'src/utils/date.ts#formatDate';

    // Act
    reportChange(t, 'agent-a', id, 'created', 'formats Nov 7, 2026', 'formatDate(d: Date): string');

    // Assert
    expect(t.db.symbol.id.find(id)).toMatchObject({
      name: 'formatDate',
      file: 'src/utils/date.ts',
      signature: 'formatDate(d: Date): string',
      version: 1,
    });
    expect(conflicts(t)).toHaveLength(0);
  });

  it("'created' on an existing symbol records the change but leaves the symbol", () => {
    // Arrange
    const before = t.db.symbol.id.find(FEES)!;

    // Act
    reportChange(t, 'agent-a', FEES, 'created', 'again');

    // Assert
    expect(t.db.symbol.id.find(FEES)).toEqual(before);
    expect(all(t.db.change.iter())).toHaveLength(1);
  });

  it('rejects an unknown symbol for non-create kinds', () => {
    // Arrange
    const id = 'src/nope.ts#ghost';

    // Act
    const act = () => reportChange(t, 'agent-a', id, 'behavior');

    // Assert
    expect(act).toThrow(/unknown symbol/);
    expect(all(t.db.change.iter())).toHaveLength(0);
  });

  it('rejects an unknown change kind', () => {
    // Arrange
    const kind = 'modify';

    // Act
    const act = () => reportChange(t, 'agent-a', FEES, kind);

    // Assert
    expect(act).toThrow(/invalid change kind 'modify'/);
  });

  it('accepts a change on a symbol the agent has not claimed (hook case)', () => {
    // Arrange
    expect(t.db.claim.symbol_id.find(FEES)).toBeNull();

    // Act
    const act = () => reportChange(t, 'agent-a', FEES, 'behavior');

    // Assert
    expect(act).not.toThrow();
  });

  it("rejects reporting for another identity's agent", () => {
    // Arrange
    register(t, 'agent-b');

    // Act
    const act = () =>
      t.as('worker-b', (ctx) =>
        mod.report_change(ctx, {
          agent_id: 'agent-a',
          symbol_id: FEES,
          kind: 'behavior',
          new_signature: undefined,
          description: 'x',
        }),
      );

    // Assert
    expect(act).toThrow(/different identity/);
  });
});

describe('report_change: Rule 1 (broken dependency)', () => {
  let t: Harness;
  beforeEach(() => {
    t = makeHarness();
    seedCodeMap(t);
    register(t, 'agent-a');
    register(t, 'agent-b');
    register(t, 'agent-c');
    plan(t, 'agent-a', [{ symbol_id: FEES, intent: 'modify' }]);
  });

  it('pauses an agent whose active plan depends on S and tells it to wait', () => {
    // Arrange
    plan(t, 'agent-b', [{ symbol_id: FEES, intent: 'depend' }]);

    // Act
    reportChange(t, 'agent-a', FEES, 'behavior', 'rounds half-up');

    // Assert
    const [c] = conflicts(t);
    expect(c).toMatchObject({
      kind: 'broken_dependency',
      symbol_id: FEES,
      agent_a: 'agent-a',
      agent_b: 'agent-b',
      status: 'open',
    });
    expect(c.details).toContain('depends on');
    expect(status(t, 'agent-b')).toBe('paused');
    expect(instructionsFor(t, 'agent-b')).toEqual([
      expect.objectContaining({
        conflict_id: c.id,
        text: `${FEES} was changed by agent-a. Pause and wait for the coordinator.`,
        acknowledged: false,
      }),
    ]);
  });

  it.each(['modify', 'create'])('pauses an agent whose plan %ss a caller of S (via symbol_edge)', (intent) => {
    // Arrange
    plan(t, 'agent-b', [{ symbol_id: CHECKOUT, intent }]);

    // Act
    reportChange(t, 'agent-a', FEES);

    // Assert (planning to 'create' an existing symbol also opens a Rule 2 duplicate; ignore it here)
    const broken = conflicts(t).filter((c) => c.kind === 'broken_dependency');
    expect(broken).toEqual([expect.objectContaining({ agent_b: 'agent-b' })]);
    expect(broken[0].details).toContain(`changes ${CHECKOUT}, which calls ${FEES}`);
    expect(status(t, 'agent-b')).toBe('paused');
  });

  it('does not flag an agent that only depends on a caller of S', () => {
    // Arrange
    plan(t, 'agent-b', [{ symbol_id: CHECKOUT, intent: 'depend' }]);

    // Act
    reportChange(t, 'agent-a', FEES);

    // Assert
    expect(conflicts(t)).toHaveLength(0);
    expect(status(t, 'agent-b')).toBe('idle');
  });

  it('never flags the reporting agent itself', () => {
    // Arrange
    plan(t, 'agent-a', [
      { symbol_id: FEES, intent: 'modify' },
      { symbol_id: INVOICE, intent: 'modify' },
      { symbol_id: FEES, intent: 'depend' },
    ]);

    // Act
    reportChange(t, 'agent-a', FEES);

    // Assert
    expect(conflicts(t)).toHaveLength(0);
    expect(status(t, 'agent-a')).toBe('idle');
  });

  it("ignores an agent's inactive (replaced) plan", () => {
    // Arrange
    plan(t, 'agent-b', [{ symbol_id: FEES, intent: 'depend' }]);
    plan(t, 'agent-b', [{ symbol_id: INVOICE, intent: 'depend' }]); // replaces the first plan

    // Act
    reportChange(t, 'agent-a', FEES);

    // Assert
    expect(conflicts(t)).toHaveLength(0);
  });

  it('flags every affected agent, one conflict each', () => {
    // Arrange
    plan(t, 'agent-b', [{ symbol_id: CHECKOUT, intent: 'modify' }]);
    plan(t, 'agent-c', [{ symbol_id: FEES, intent: 'depend' }]);

    // Act
    reportChange(t, 'agent-a', FEES);

    // Assert
    expect(conflicts(t).map((c) => c.agent_b).sort()).toEqual(['agent-b', 'agent-c']);
    expect(status(t, 'agent-b')).toBe('paused');
    expect(status(t, 'agent-c')).toBe('paused');
  });

  it('an agent hit by both paths gets one conflict', () => {
    // Arrange
    plan(t, 'agent-b', [
      { symbol_id: FEES, intent: 'depend' },
      { symbol_id: CHECKOUT, intent: 'modify' },
      { symbol_id: TOTAL, intent: 'modify' },
    ]);

    // Act
    reportChange(t, 'agent-a', FEES);

    // Assert
    expect(conflicts(t)).toHaveLength(1);
    expect(instructionsFor(t, 'agent-b')).toHaveLength(1);
  });

  it('dedupes: a second report for the same pair adds no conflict or instruction', () => {
    // Arrange
    plan(t, 'agent-b', [{ symbol_id: FEES, intent: 'depend' }]);
    reportChange(t, 'agent-a', FEES, 'behavior', 'first');

    // Act
    reportChange(t, 'agent-a', FEES, 'signature', 'second', 'calculateFee(x: number): number');

    // Assert
    expect(conflicts(t)).toHaveLength(1);
    expect(instructionsFor(t, 'agent-b')).toHaveLength(1);
    expect(all(t.db.change.iter())).toHaveLength(2); // both changes are still recorded
  });

  it('a removed symbol also runs Rule 1', () => {
    // Arrange
    plan(t, 'agent-b', [{ symbol_id: FEES, intent: 'depend' }]);

    // Act
    reportChange(t, 'agent-a', FEES, 'removed', 'deleted calculateFee');

    // Assert
    expect(conflicts(t)).toHaveLength(1);
  });

  it('a change with no dependents opens nothing', () => {
    // Arrange
    plan(t, 'agent-b', [{ symbol_id: INVOICE, intent: 'modify' }]); // INVOICE calls FEES, but A changes INVOICE

    // Act
    reportChange(t, 'agent-a', INVOICE);

    // Assert
    expect(conflicts(t)).toHaveLength(0);
  });

  it('a symmetric pair is still one conflict (B reports after A did)', () => {
    // Arrange
    plan(t, 'agent-b', [{ symbol_id: FEES, intent: 'depend' }]);
    plan(t, 'agent-a', [
      { symbol_id: FEES, intent: 'modify' },
      { symbol_id: CHECKOUT, intent: 'depend' },
    ]);
    reportChange(t, 'agent-a', FEES);

    // Act
    t.as('worker-b', (ctx) =>
      mod.report_change(ctx, {
        agent_id: 'agent-b',
        symbol_id: CHECKOUT,
        kind: 'behavior',
        new_signature: undefined,
        description: 'B',
      }),
    );

    // Assert: A depends on CHECKOUT, but the A/B pair already has a live conflict on FEES,
    // which is a different symbol, so a second conflict on CHECKOUT is expected.
    expect(conflicts(t).map((c) => `${c.symbol_id}:${c.agent_a}->${c.agent_b}`).sort()).toEqual(
      [`${CHECKOUT}:agent-b->agent-a`, `${FEES}:agent-a->agent-b`].sort(),
    );
  });
});
