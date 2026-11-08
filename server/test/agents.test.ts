// register_agent, heartbeat, init (spec section 7).
import { describe, it, expect, beforeEach } from 'vitest';
import { makeHarness, register, mod, all, T0, type Harness } from './helpers';

const agentArgs = (id: string, overrides: Partial<Record<string, unknown>> = {}) => ({
  id,
  name: 'Agent A',
  owner_dev: 'kolby',
  machine: 'laptop-1',
  model: 'claude-code',
  token_budget: 50_000n,
  ...overrides,
});

describe('register_agent', () => {
  let t: Harness;
  beforeEach(() => {
    t = makeHarness();
  });

  it('inserts a new agent as idle, linked to the caller', () => {
    // Arrange
    const args = agentArgs('agent-a');

    // Act
    t.as('worker-a', (ctx) => mod.register_agent(ctx, args));

    // Assert
    const row = t.db.agent.id.find('agent-a')!;
    expect(row).toMatchObject({
      id: 'agent-a',
      name: 'Agent A',
      owner_dev: 'kolby',
      machine: 'laptop-1',
      model: 'claude-code',
      token_budget: 50_000n,
      status: 'idle',
      current_task_id: undefined,
    });
    expect(row.last_heartbeat.microsSinceUnixEpoch).toBe(T0);
    const other = t.db.agent.id.find('agent-a')!.identity;
    t.as('worker-a', (ctx) => expect(ctx.sender.equals(other)).toBe(true));
  });

  it('updates fields but keeps status when the same identity registers again', () => {
    // Arrange
    t.as('worker-a', (ctx) => mod.register_agent(ctx, agentArgs('agent-a')));
    t.internal((ctx) => {
      const row = ctx.db.agent.id.find('agent-a')!;
      ctx.db.agent.id.update({ ...row, status: 'working', current_task_id: 7n });
    });
    t.advance(5);

    // Act
    t.as('worker-a', (ctx) => mod.register_agent(ctx, agentArgs('agent-a', { model: 'nemotron', token_budget: 9n })));

    // Assert
    const row = t.db.agent.id.find('agent-a')!;
    expect(row.model).toBe('nemotron');
    expect(row.token_budget).toBe(9n);
    expect(row.status).toBe('working');
    expect(row.current_task_id).toBe(7n);
    expect(row.last_heartbeat.microsSinceUnixEpoch).toBe(t.now());
    expect(all(t.db.agent.iter())).toHaveLength(1);
  });

  it('rejects an id already linked to another live identity', () => {
    // Arrange
    t.as('worker-a', (ctx) => mod.register_agent(ctx, agentArgs('agent-a')));
    t.advance(30); // still within the 60 s heartbeat window

    // Act
    const act = () => t.as('worker-b', (ctx) => mod.register_agent(ctx, agentArgs('agent-a', { name: 'thief' })));

    // Assert
    expect(act).toThrow(/already linked to another identity/);
    expect(act).toThrow(/registered from laptop-1, heartbeat 30 s ago/);
    expect(t.db.agent.id.find('agent-a')!.name).toBe('Agent A');
  });

  describe("the 'coordinator' id follows the coordinator service lock", () => {
    const claimLock = (who: 'coordinator' | 'worker-b', machine: string) =>
      t.as(who, (ctx) => mod.claim_service(ctx, { name: 'coordinator', machine, holder: `${machine}:p1` }));
    const registerAs = (who: 'coordinator' | 'worker-b', machine: string) =>
      t.as(who, (ctx) => mod.register_agent(ctx, agentArgs('coordinator', { machine })));

    beforeEach(() => {
      registerAs('coordinator', 'laptop-1');
      claimLock('coordinator', 'laptop-1');
      t.advance(5);
    });

    it('refuses a second laptop while the lock holder is live, naming the machine', () => {
      // Act
      const act = () => registerAs('worker-b', 'laptop-2');

      // Assert
      expect(act).toThrow(/coordinator is already running on laptop-1; stop it there first/);
      expect(t.db.agent.id.find('coordinator')!.machine).toBe('laptop-1');
    });

    it('lets a second laptop take over as soon as the lock is released (no 60 s wait)', () => {
      // Arrange
      t.as('coordinator', (ctx) => mod.release_service(ctx, { name: 'coordinator', holder: 'laptop-1:p1' }));

      // Act
      registerAs('worker-b', 'laptop-2');

      // Assert
      expect(t.db.agent.id.find('coordinator')!.machine).toBe('laptop-2');
      expect(() => t.as('worker-b', (ctx) => mod.heartbeat(ctx, { agent_id: 'coordinator' }))).not.toThrow();
      expect(() => t.as('coordinator', (ctx) => mod.heartbeat(ctx, { agent_id: 'coordinator' }))).toThrow(/different identity/);
    });

    it('lets a second laptop take over once the lock is stale (30 s), before the 60 s heartbeat rule', () => {
      // Arrange
      t.advance(26); // 31 s since the lock heartbeat, 31 s since the agent heartbeat

      // Act
      registerAs('worker-b', 'laptop-2');

      // Assert
      expect(t.db.agent.id.find('coordinator')!.machine).toBe('laptop-2');
    });

    it('lets a second laptop take over a row that has no lock at all', () => {
      // Arrange: a coordinator from before the lock existed, or one whose lock row was removed.
      t.as('coordinator', (ctx) => mod.release_service(ctx, { name: 'coordinator', holder: 'laptop-1:p1' }));
      t.as('coordinator', (ctx) => mod.heartbeat(ctx, { agent_id: 'coordinator' }));

      // Act
      registerAs('worker-b', 'laptop-2');

      // Assert
      expect(t.db.agent.id.find('coordinator')!.machine).toBe('laptop-2');
    });

    it('still lets the lock holder re-register itself', () => {
      // Act
      registerAs('coordinator', 'laptop-1');

      // Assert
      expect(t.db.agent.id.find('coordinator')!.machine).toBe('laptop-1');
    });
  });

  it('lets a new identity take over an id whose old link went stale (>60 s)', () => {
    // Arrange
    t.as('worker-a', (ctx) => mod.register_agent(ctx, agentArgs('agent-a')));
    t.advance(61);

    // Act
    t.as('worker-b', (ctx) => mod.register_agent(ctx, agentArgs('agent-a', { machine: 'laptop-2' })));

    // Assert
    expect(t.db.agent.id.find('agent-a')!.machine).toBe('laptop-2');
    expect(() => t.as('worker-b', (ctx) => mod.heartbeat(ctx, { agent_id: 'agent-a' }))).not.toThrow();
    expect(() => t.as('worker-a', (ctx) => mod.heartbeat(ctx, { agent_id: 'agent-a' }))).toThrow(/different identity/);
  });

  it('rejects an empty id', () => {
    // Arrange
    const args = agentArgs('');

    // Act
    const act = () => t.as('worker-a', (ctx) => mod.register_agent(ctx, args));

    // Assert
    expect(act).toThrow(/id is required/);
    expect(all(t.db.agent.iter())).toHaveLength(0);
  });

  it('is idempotent when the same identity re-registers (worker, MCP server and hook share one token)', () => {
    // Arrange / Act
    t.as('worker-a', (ctx) => mod.register_agent(ctx, agentArgs('agent-a')));
    t.as('worker-a', (ctx) => mod.register_agent(ctx, agentArgs('agent-a')));

    // Assert
    expect(all(t.db.agent.iter())).toHaveLength(1);
  });
});

describe('heartbeat', () => {
  let t: Harness;
  beforeEach(() => {
    t = makeHarness();
    register(t, 'agent-a');
  });

  it('updates last_heartbeat to the reducer timestamp', () => {
    // Arrange
    t.advance(15);

    // Act
    t.as('worker-a', (ctx) => mod.heartbeat(ctx, { agent_id: 'agent-a' }));

    // Assert
    expect(t.db.agent.id.find('agent-a')!.last_heartbeat.microsSinceUnixEpoch).toBe(t.now());
  });

  it('rejects an unknown agent', () => {
    // Arrange
    const agent_id = 'ghost';

    // Act
    const act = () => t.as('worker-a', (ctx) => mod.heartbeat(ctx, { agent_id }));

    // Assert
    expect(act).toThrow(/unknown agent 'ghost'/);
  });

  it('rejects a heartbeat from a different identity and leaves the row alone', () => {
    // Arrange
    t.advance(10);

    // Act
    const act = () => t.as('worker-b', (ctx) => mod.heartbeat(ctx, { agent_id: 'agent-a' }));

    // Assert
    expect(act).toThrow(/linked to a different identity/);
    expect(t.db.agent.id.find('agent-a')!.last_heartbeat.microsSinceUnixEpoch).toBe(T0);
  });
});

describe('init', () => {
  it('schedules expire_claims every 30 s', () => {
    // Arrange
    const t = makeHarness();

    // Act
    t.internal((ctx) => mod.init(ctx, {}));

    // Assert
    const rows = all(t.db.expireClaimsSchedule.iter());
    expect(rows).toHaveLength(1);
    expect(rows[0].scheduled_at).toMatchObject({ tag: 'Interval' });
    expect((rows[0].scheduled_at as { value: { micros: bigint } }).value.micros).toBe(30_000_000n);
  });
});
