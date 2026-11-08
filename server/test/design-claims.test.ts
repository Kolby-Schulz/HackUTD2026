// design_claim leases: claim_design, renew/release, contention conflicts, and the expire_claims sweep.
import { describe, it, expect, beforeEach } from 'vitest';
import { makeHarness, register, mod, all, type Harness, type Who } from './helpers';

const BOARD = 'main';

function tick(t: Harness) {
  t.internal((ctx) =>
    mod.expire_claims(ctx, {
      timer: { scheduled_id: 1n, scheduled_at: { tag: 'Interval', value: { micros: 30_000_000n } } as never },
    }),
  );
}

describe('design claims', () => {
  let t: Harness;
  const claim = (who: Who, target: string, over: Partial<Parameters<typeof mod.claim_design>[1]> = {}) =>
    t.as(who, (ctx) =>
      mod.claim_design(ctx, {
        target,
        kind: 'variant',
        scope: 'home',
        intent: 'replace',
        ttl_secs: 60,
        actor: who,
        agent_id: undefined,
        ...over,
      }),
    );

  beforeEach(() => {
    t = makeHarness();
    register(t, 'agent-a');
    register(t, 'agent-b');
  });

  it('creates a lease with the requested ttl and zero contention', () => {
    // Act
    claim('worker-a', 'home/v1');

    // Assert
    const c = t.db.designClaim.target.find('home/v1')!;
    expect([c.kind, c.scope, c.holder, c.intent, c.contention]).toEqual(['variant', 'home', 'worker-a', 'replace', 0]);
    expect(c.expires_at.microsSinceUnixEpoch - t.now()).toBe(60_000_000n);
  });

  it('validates kind, intent and the 5 to 600 s ttl', () => {
    expect(() => claim('worker-a', 'x', { kind: 'frame' })).toThrow(/invalid claim kind/);
    expect(() => claim('worker-a', 'x', { intent: 'steal' })).toThrow(/invalid claim intent/);
    expect(() => claim('worker-a', 'x', { ttl_secs: 4 })).toThrow(/ttl_secs/);
    expect(() => claim('worker-a', 'x', { ttl_secs: 601 })).toThrow(/ttl_secs/);
    expect(() => claim('worker-a', 'x', { ttl_secs: 5 })).not.toThrow();
    expect(() => claim('worker-a', 'y', { ttl_secs: 600 })).not.toThrow();
  });

  it('a board claim needs an actor the caller owns on that board', () => {
    // Arrange
    t.as('worker-a', (ctx) => mod.create_board(ctx, { id: BOARD, name: 'Main' }));
    t.as('worker-a', (ctx) => mod.join_board(ctx, { board_id: BOARD, actor: 'ann', kind: 'human', name: 'a', color: '', agent_id: undefined }));

    // Act + Assert
    expect(() => claim('worker-b', 's1', { kind: 'board', scope: BOARD, actor: 'ann' })).toThrow(/different identity/);
    expect(() => claim('worker-a', 's1', { kind: 'board', scope: BOARD, actor: 'ghost' })).toThrow(/unknown actor/);
    claim('worker-a', 's1', { kind: 'board', scope: BOARD, actor: 'ann' });
    expect(t.db.designClaim.target.find('s1')!.holder).toBe('ann');
  });

  it('the same holder renews; an expired claim is replaced by anyone', () => {
    // Arrange
    claim('worker-a', 'home/v1');
    t.advance(30);

    // Act
    claim('worker-a', 'home/v1', { intent: 'extend' });
    t.advance(61);
    claim('worker-b', 'home/v1');

    // Assert
    const c = t.db.designClaim.target.find('home/v1')!;
    expect([c.holder, c.intent, c.contention]).toEqual(['worker-b', 'replace', 0]);
  });

  it('contention counts, keeps the holder, and opens one claim_contention conflict when both have agent ids', () => {
    // Arrange
    claim('worker-a', 'home/v1', { agent_id: 'agent-a' });

    // Act
    claim('worker-b', 'home/v1', { agent_id: 'agent-b' });
    claim('worker-b', 'home/v1', { agent_id: 'agent-b' });

    // Assert
    const c = t.db.designClaim.target.find('home/v1')!;
    expect([c.holder, c.contention]).toEqual(['worker-a', 2]);
    const cs = all(t.db.conflict.iter());
    expect(cs).toHaveLength(1);
    expect([cs[0].kind, cs[0].symbol_id, cs[0].agent_a, cs[0].agent_b, cs[0].status]).toEqual(['claim_contention', 'home/v1', 'agent-a', 'agent-b', 'open']);
  });

  it('contention without agent ids counts but opens no conflict', () => {
    // Act
    claim('worker-a', 'home/v1');
    claim('worker-b', 'home/v1', { agent_id: 'agent-b' });

    // Assert
    expect(t.db.designClaim.target.find('home/v1')!.contention).toBe(1);
    expect(all(t.db.conflict.iter())).toHaveLength(0);
  });

  it('renew and release need the holder', () => {
    // Arrange
    claim('worker-a', 'home/v1');

    // Act + Assert
    expect(() => t.as('worker-b', (ctx) => mod.renew_design_claim(ctx, { target: 'home/v1', ttl_secs: 60 }))).toThrow(/don't hold/);
    expect(() => t.as('worker-b', (ctx) => mod.release_design_claim(ctx, { target: 'home/v1' }))).toThrow(/don't hold/);
    t.advance(40);
    t.as('worker-a', (ctx) => mod.renew_design_claim(ctx, { target: 'home/v1', ttl_secs: 100 }));
    expect(t.db.designClaim.target.find('home/v1')!.expires_at.microsSinceUnixEpoch - t.now()).toBe(100_000_000n);
    expect(() => t.as('worker-a', (ctx) => mod.renew_design_claim(ctx, { target: 'home/v1', ttl_secs: 1 }))).toThrow(/ttl_secs/);
    t.as('worker-a', (ctx) => mod.release_design_claim(ctx, { target: 'home/v1' }));
    expect(t.db.designClaim.target.find('home/v1')).toBeNull();
  });

  it('renew refuses an expired claim', () => {
    // Arrange
    claim('worker-a', 'home/v1', { ttl_secs: 5 });
    t.advance(6);

    // Act + Assert
    expect(() => t.as('worker-a', (ctx) => mod.renew_design_claim(ctx, { target: 'home/v1', ttl_secs: 60 }))).toThrow(/expired/);
  });

  it('expire_claims deletes expired design claims and keeps live ones', () => {
    // Arrange
    claim('worker-a', 'home/v1', { ttl_secs: 10 });
    claim('worker-a', 'home/v2', { ttl_secs: 100 });
    t.advance(30);

    // Act
    tick(t);

    // Assert
    expect(all(t.db.designClaim.iter()).map((c) => c.target)).toEqual(['home/v2']);
  });
});
