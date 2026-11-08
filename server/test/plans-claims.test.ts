// publish_plan, claim_symbol, release_claim and Rule 3 (spec sections 7 and 8).
import { describe, it, expect, beforeEach } from 'vitest';
import {
  makeHarness,
  register,
  seedCodeMap,
  plan,
  claim,
  mod,
  all,
  FEES,
  INVOICE,
  CHECKOUT,
  type Harness,
} from './helpers';

const NEW_HELPER = 'src/utils/date.ts#formatDate';
const conflicts = (t: Harness) => all(t.db.conflict.iter());

describe('publish_plan', () => {
  let t: Harness;
  beforeEach(() => {
    t = makeHarness();
    seedCodeMap(t);
    register(t, 'agent-a');
    register(t, 'agent-b');
  });

  it('inserts an active plan with one plan_item per item', () => {
    // Arrange
    const items = [
      { symbol_id: FEES, intent: 'modify' },
      { symbol_id: INVOICE, intent: 'modify' },
      { symbol_id: NEW_HELPER, intent: 'create' },
    ];

    // Act
    plan(t, 'agent-a', items, 3n, 'late fees');

    // Assert
    const plans = all(t.db.plan.iter());
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ agent_id: 'agent-a', task_id: 3n, summary: 'late fees', active: true });
    const rows = all(t.db.planItem.plan_id.filter(plans[0].id));
    expect(rows.map((r) => [r.symbol_id, r.intent, r.agent_id])).toEqual(
      items.map((i) => [i.symbol_id, i.intent, 'agent-a']),
    );
  });

  it("deactivates only the agent's previous plan", () => {
    // Arrange
    plan(t, 'agent-a', [{ symbol_id: FEES, intent: 'modify' }]);
    plan(t, 'agent-b', [{ symbol_id: CHECKOUT, intent: 'modify' }]);

    // Act
    plan(t, 'agent-a', [{ symbol_id: INVOICE, intent: 'modify' }], 1n, 'v2');

    // Assert
    const byAgent = (id: string) => all(t.db.plan.agent_id.filter(id));
    expect(byAgent('agent-a').map((p) => [p.summary, p.active])).toEqual([
      ['plan', false],
      ['v2', true],
    ]);
    expect(byAgent('agent-b').every((p) => p.active)).toBe(true);
  });

  it('accepts an empty plan', () => {
    // Arrange
    const items: { symbol_id: string; intent: string }[] = [];

    // Act
    plan(t, 'agent-a', items);

    // Assert
    expect(all(t.db.plan.iter())).toHaveLength(1);
    expect(all(t.db.planItem.iter())).toHaveLength(0);
  });

  it.each(['modify', 'depend'])('rejects %s on an unknown symbol and keeps the old plan active', (intent) => {
    // Arrange
    plan(t, 'agent-a', [{ symbol_id: FEES, intent: 'modify' }]);

    // Act
    const act = () => plan(t, 'agent-a', [{ symbol_id: 'src/nope.ts#ghost', intent }]);

    // Assert
    expect(act).toThrow(/unknown symbol 'src\/nope.ts#ghost'/);
    expect(all(t.db.plan.iter()).map((p) => p.active)).toEqual([true]);
    expect(all(t.db.planItem.iter())).toHaveLength(1);
  });

  it('rejects an unknown intent', () => {
    // Arrange
    const items = [{ symbol_id: FEES, intent: 'delete' }];

    // Act
    const act = () => plan(t, 'agent-a', items);

    // Assert
    expect(act).toThrow(/invalid plan intent 'delete'/);
    expect(all(t.db.plan.iter())).toHaveLength(0);
  });

  it("rejects a plan published for another identity's agent", () => {
    // Arrange
    const items = [{ symbol_id: FEES, intent: 'modify', signature: undefined }];

    // Act
    const act = () =>
      t.as('worker-b', (ctx) => mod.publish_plan(ctx, { agent_id: 'agent-a', task_id: 1n, summary: 'x', items }));

    // Assert
    expect(act).toThrow(/different identity/);
    expect(all(t.db.plan.iter())).toHaveLength(0);
  });

  describe('Rule 3 inside publish_plan', () => {
    it("opens claim_contention when planning to modify another agent's claimed symbol, but still publishes", () => {
      // Arrange
      claim(t, 'agent-a', FEES);

      // Act
      plan(t, 'agent-b', [{ symbol_id: FEES, intent: 'modify' }]);

      // Assert
      expect(all(t.db.plan.agent_id.filter('agent-b'))[0].active).toBe(true);
      expect(conflicts(t)).toHaveLength(1);
      expect(conflicts(t)[0]).toMatchObject({
        kind: 'claim_contention',
        symbol_id: FEES,
        agent_a: 'agent-a',
        agent_b: 'agent-b',
        status: 'open',
      });
    });

    it.each(['depend', 'create'])('does not fire for %s intents', (intent) => {
      // Arrange
      claim(t, 'agent-a', FEES);

      // Act
      plan(t, 'agent-b', [{ symbol_id: FEES, intent }]);

      // Assert (a 'create' of an existing symbol is Rule 2's business, not Rule 3's)
      expect(conflicts(t).filter((c) => c.kind === 'claim_contention')).toHaveLength(0);
    });

    it("does not fire on the agent's own claim", () => {
      // Arrange
      claim(t, 'agent-a', FEES);

      // Act
      plan(t, 'agent-a', [{ symbol_id: FEES, intent: 'modify' }]);

      // Assert
      expect(conflicts(t)).toHaveLength(0);
    });

    it('does not fire on an expired claim', () => {
      // Arrange
      claim(t, 'agent-a', FEES, 10);
      t.advance(11);

      // Act
      plan(t, 'agent-b', [{ symbol_id: FEES, intent: 'modify' }]);

      // Assert
      expect(conflicts(t)).toHaveLength(0);
    });
  });
});

describe('claim_symbol', () => {
  let t: Harness;
  beforeEach(() => {
    t = makeHarness();
    seedCodeMap(t);
    register(t, 'agent-a');
    register(t, 'agent-b');
  });

  it('inserts a claim that expires after ttl_secs', () => {
    // Arrange
    const ttl = 90;

    // Act
    claim(t, 'agent-a', FEES, ttl);

    // Assert
    const c = t.db.claim.symbol_id.find(FEES)!;
    expect(c.agent_id).toBe('agent-a');
    expect(c.claimed_at.microsSinceUnixEpoch).toBe(t.now());
    expect(c.expires_at.microsSinceUnixEpoch - c.claimed_at.microsSinceUnixEpoch).toBe(90_000_000n);
  });

  it('uses a 300 s default when ttl_secs is 0', () => {
    // Arrange
    const ttl = 0;

    // Act
    claim(t, 'agent-a', FEES, ttl);

    // Assert
    const c = t.db.claim.symbol_id.find(FEES)!;
    expect(c.expires_at.microsSinceUnixEpoch - c.claimed_at.microsSinceUnixEpoch).toBe(300_000_000n);
  });

  it('refreshes the expiry when the holder claims again', () => {
    // Arrange
    claim(t, 'agent-a', FEES, 60);
    t.advance(50);

    // Act
    claim(t, 'agent-a', FEES, 60);

    // Assert
    expect(t.db.claim.symbol_id.find(FEES)!.expires_at.microsSinceUnixEpoch).toBe(t.now() + 60_000_000n);
    expect(conflicts(t)).toHaveLength(0);
  });

  it('Rule 3: leaves the claim with its holder and opens claim_contention', () => {
    // Arrange
    claim(t, 'agent-a', FEES);

    // Act
    claim(t, 'agent-b', FEES);

    // Assert
    expect(t.db.claim.symbol_id.find(FEES)!.agent_id).toBe('agent-a');
    expect(conflicts(t)).toEqual([
      expect.objectContaining({ kind: 'claim_contention', symbol_id: FEES, agent_a: 'agent-a', agent_b: 'agent-b' }),
    ]);
  });

  it('dedupes: repeated contention for the same pair opens one conflict', () => {
    // Arrange
    claim(t, 'agent-a', FEES);

    // Act
    claim(t, 'agent-b', FEES);
    claim(t, 'agent-b', FEES);
    plan(t, 'agent-b', [{ symbol_id: FEES, intent: 'modify' }]);

    // Assert
    expect(conflicts(t)).toHaveLength(1);
  });

  it('contention on a different symbol is a separate conflict', () => {
    // Arrange
    claim(t, 'agent-a', FEES);
    claim(t, 'agent-a', INVOICE);

    // Act
    claim(t, 'agent-b', FEES);
    claim(t, 'agent-b', INVOICE);

    // Assert
    expect(conflicts(t).map((c) => c.symbol_id).sort()).toEqual([FEES, INVOICE].sort());
  });

  it('lets another agent take over an expired claim', () => {
    // Arrange
    claim(t, 'agent-a', FEES, 30);
    t.advance(31);

    // Act
    claim(t, 'agent-b', FEES, 30);

    // Assert
    expect(t.db.claim.symbol_id.find(FEES)!.agent_id).toBe('agent-b');
    expect(conflicts(t)).toHaveLength(0);
  });

  it('allows claiming a symbol that does not exist yet (planned create)', () => {
    // Arrange
    const id = NEW_HELPER;

    // Act
    claim(t, 'agent-a', id);

    // Assert
    expect(t.db.claim.symbol_id.find(id)!.agent_id).toBe('agent-a');
  });

  it("rejects claiming for another identity's agent", () => {
    // Arrange
    const args = { agent_id: 'agent-a', symbol_id: FEES, ttl_secs: 60 };

    // Act
    const act = () => t.as('worker-b', (ctx) => mod.claim_symbol(ctx, args));

    // Assert
    expect(act).toThrow(/different identity/);
    expect(t.db.claim.symbol_id.find(FEES)).toBeNull();
  });
});

describe('release_claim', () => {
  let t: Harness;
  const release = (who: 'worker-a' | 'worker-b', agent_id: string, symbol_id = FEES) =>
    t.as(who, (ctx) => mod.release_claim(ctx, { agent_id, symbol_id }));

  beforeEach(() => {
    t = makeHarness();
    seedCodeMap(t);
    register(t, 'agent-a');
    register(t, 'agent-b');
  });

  it('deletes the holder’s claim', () => {
    // Arrange
    claim(t, 'agent-a', FEES);

    // Act
    release('worker-a', 'agent-a');

    // Assert
    expect(t.db.claim.symbol_id.find(FEES)).toBeNull();
  });

  it("rejects releasing someone else's claim", () => {
    // Arrange
    claim(t, 'agent-a', FEES);

    // Act
    const act = () => release('worker-b', 'agent-b');

    // Assert
    expect(act).toThrow(/doesn't hold a claim/);
    expect(t.db.claim.symbol_id.find(FEES)!.agent_id).toBe('agent-a');
  });

  it('rejects releasing a claim that does not exist', () => {
    // Arrange
    const symbol = INVOICE;

    // Act
    const act = () => release('worker-a', 'agent-a', symbol);

    // Assert
    expect(act).toThrow(/doesn't hold a claim/);
  });

  it('after release, another agent can claim without contention', () => {
    // Arrange
    claim(t, 'agent-a', FEES);
    release('worker-a', 'agent-a');

    // Act
    claim(t, 'agent-b', FEES);

    // Assert
    expect(t.db.claim.symbol_id.find(FEES)!.agent_id).toBe('agent-b');
    expect(conflicts(t)).toHaveLength(0);
  });
});
