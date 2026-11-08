// expire_claims, the 30 s scheduled housekeeping reducer (spec section 7).
import { describe, it, expect, beforeEach } from 'vitest';
import { makeHarness, register, claim, seedCodeMap, mod, all, FEES, INVOICE, CHECKOUT, type Harness } from './helpers';

function tick(t: Harness) {
  t.internal((ctx) =>
    mod.expire_claims(ctx, {
      timer: { scheduled_id: 1n, scheduled_at: { tag: 'Interval', value: { micros: 30_000_000n } } as never },
    }),
  );
}

function setStatus(t: Harness, id: string, status: string) {
  t.internal((ctx) => {
    const a = ctx.db.agent.id.find(id)!;
    ctx.db.agent.id.update({ ...a, status });
  });
}

describe('expire_claims: claims', () => {
  let t: Harness;
  beforeEach(() => {
    t = makeHarness();
    seedCodeMap(t);
    register(t, 'agent-a');
  });

  it('deletes expired claims and keeps live ones', () => {
    // Arrange
    claim(t, 'agent-a', FEES, 10);
    claim(t, 'agent-a', INVOICE, 100);
    t.advance(30);

    // Act
    tick(t);

    // Assert
    expect(t.db.claim.symbol_id.find(FEES)).toBeNull();
    expect(t.db.claim.symbol_id.find(INVOICE)).not.toBeNull();
  });

  it('treats a claim expiring exactly now as expired', () => {
    // Arrange
    claim(t, 'agent-a', FEES, 30);
    t.advance(30);

    // Act
    tick(t);

    // Assert
    expect(t.db.claim.symbol_id.find(FEES)).toBeNull();
  });

  it('does nothing when there are no claims', () => {
    // Arrange
    t.advance(30);

    // Act
    const act = () => tick(t);

    // Assert
    expect(act).not.toThrow();
    expect(all(t.db.claim.iter())).toHaveLength(0);
  });

  it('removes several expired claims in one tick', () => {
    // Arrange
    for (const s of [FEES, INVOICE, CHECKOUT]) claim(t, 'agent-a', s, 5);
    t.advance(6);

    // Act
    tick(t);

    // Assert
    expect(all(t.db.claim.iter())).toHaveLength(0);
  });
});

describe('expire_claims: stale agents', () => {
  let t: Harness;
  beforeEach(() => {
    t = makeHarness();
    register(t, 'agent-a');
  });

  it.each(['working', 'paused'])('marks a %s agent with no heartbeat for >60 s idle', (s) => {
    // Arrange
    setStatus(t, 'agent-a', s);
    t.advance(61);

    // Act
    tick(t);

    // Assert
    expect(t.db.agent.id.find('agent-a')!.status).toBe('idle');
  });

  it('leaves an agent that heartbeated recently', () => {
    // Arrange
    setStatus(t, 'agent-a', 'working');
    t.advance(50);
    t.as('worker-a', (ctx) => mod.heartbeat(ctx, { agent_id: 'agent-a' }));
    t.advance(50);

    // Act
    tick(t);

    // Assert
    expect(t.db.agent.id.find('agent-a')!.status).toBe('working');
  });

  it("leaves a 'done' agent alone (it finished, it didn't crash)", () => {
    // Arrange
    setStatus(t, 'agent-a', 'done');
    t.advance(600);

    // Act
    tick(t);

    // Assert
    expect(t.db.agent.id.find('agent-a')!.status).toBe('done');
  });

  it('a stale agent at exactly 60 s is not yet idle', () => {
    // Arrange
    setStatus(t, 'agent-a', 'working');
    t.advance(60);

    // Act
    tick(t);

    // Assert
    expect(t.db.agent.id.find('agent-a')!.status).toBe('working');
  });
});
