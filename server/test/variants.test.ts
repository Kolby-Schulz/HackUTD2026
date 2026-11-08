// Design variants: jobs, variant rows, mixes, picks, votes, reset, and the 'design' token purpose.
import { describe, it, expect, beforeEach } from 'vitest';
import { makeHarness, register, asOperator, mod, all, type Harness, type Who } from './helpers';

const V1 = 'home/v1';

describe('variant jobs', () => {
  let t: Harness;
  const queue = (parent?: string) =>
    t.as('outsider', (ctx) => mod.queue_variant_job(ctx, { screen: 'home', parent, brief: 'bolder hero', model: 'sonnet' }));
  const start = (who: Who, agentId: string, jobId = 1n, variantId = V1) =>
    t.as(who, (ctx) => mod.start_variant_job(ctx, { job_id: jobId, agent_id: agentId, variant_id: variantId }));
  const finish = (who: Who, agentId: string, jobId = 1n) =>
    t.as(who, (ctx) => mod.finish_variant_job(ctx, { job_id: jobId, agent_id: agentId, commit: 'abc123', tokens: 900n, cost_usd: 0.12, duration_ms: 4_000n }));

  beforeEach(() => {
    t = makeHarness();
    register(t, 'agent-a');
    register(t, 'agent-b');
  });

  it('queue_variant_job (any caller) makes a queued job; a malformed parent is refused', () => {
    // Act
    queue();

    // Assert
    const j = t.db.variantJob.id.find(1n)!;
    expect([j.screen, j.status, j.agent_id, j.parent]).toEqual(['home', 'queued', undefined, undefined]);
    expect(() => queue('other/v1')).toThrow(/must be 'home\/<id>'/);
    expect(() => queue('home/../x')).toThrow(/must be 'home\/<id>'/);
  });

  it('a parent that exists only as a code folder in git (no variant row) is accepted', () => {
    // Act
    queue('home/b-calm');

    // Assert
    expect(t.db.variantJob.id.find(1n)!.parent).toBe('home/b-calm');
  });

  it('start_variant_job runs the job and inserts a generating root variant', () => {
    // Arrange
    queue();

    // Act
    start('worker-a', 'agent-a');

    // Assert
    const j = t.db.variantJob.id.find(1n)!;
    expect([j.status, j.agent_id, j.variant_id]).toEqual(['running', 'agent-a', V1]);
    const v = t.db.variant.id.find(V1)!;
    expect([v.kind, v.status, v.author, v.model, v.screen, v.parent]).toEqual(['root', 'generating', 'agent-a', 'sonnet', 'home', undefined]);
  });

  it('start_variant_job refuses a non-queued job, a taken variant id, a bad id and another agent', () => {
    // Arrange
    queue();
    queue();
    start('worker-a', 'agent-a');

    // Act + Assert
    expect(() => start('worker-b', 'agent-b')).toThrow(/not queued/);
    expect(() => start('worker-b', 'agent-b', 2n, V1)).toThrow(/already exists/);
    expect(() => start('worker-b', 'agent-b', 2n, 'other/v2')).toThrow(/must look like home\//);
    expect(() => start('worker-b', 'agent-a', 2n, 'home/v2')).toThrow(/different identity/);
    expect(t.db.variantJob.id.find(2n)!.status).toBe('queued');
  });

  it('a job with a parent makes a child variant', () => {
    // Arrange
    queue();
    start('worker-a', 'agent-a');
    finish('worker-a', 'agent-a');
    queue(V1);

    // Act
    start('worker-b', 'agent-b', 2n, 'home/v2');

    // Assert
    const v = t.db.variant.id.find('home/v2')!;
    expect([v.kind, v.parent]).toEqual(['child', V1]);
  });

  it('finish_variant_job marks the job done and the variant ready with the numbers; only the job agent may', () => {
    // Arrange
    queue();
    start('worker-a', 'agent-a');

    // Act + Assert
    expect(() => finish('worker-b', 'agent-b')).toThrow(/another agent/);
    expect(() => finish('worker-b', 'agent-a')).toThrow(/different identity/);
    finish('worker-a', 'agent-a');
    const v = t.db.variant.id.find(V1)!;
    expect([v.status, v.commit, v.tokens, v.cost_usd, v.duration_ms]).toEqual(['ready', 'abc123', 900n, 0.12, 4_000n]);
    expect(t.db.variantJob.id.find(1n)!.status).toBe('done');
    expect(() => finish('worker-a', 'agent-a')).toThrow(/not running/);
  });

  it('fail_variant_job marks the job and the variant failed; only the job agent may', () => {
    // Arrange
    queue();
    start('worker-a', 'agent-a');

    // Act + Assert
    expect(() => t.as('worker-b', (ctx) => mod.fail_variant_job(ctx, { job_id: 1n, agent_id: 'agent-b', error: 'x' }))).toThrow(/another agent/);
    t.as('worker-a', (ctx) => mod.fail_variant_job(ctx, { job_id: 1n, agent_id: 'agent-a', error: 'build broke' }));
    expect(t.db.variant.id.find(V1)!.status).toBe('failed');
    const j = t.db.variantJob.id.find(1n)!;
    expect([j.status, j.error]).toEqual(['failed', 'build broke']);
  });
});

describe('variant mixes, picks and votes', () => {
  let t: Harness;
  const save = (who: Who, id = 'home/mix1', parent?: string, title = 'Mix', note = '') =>
    t.as(who, (ctx) => mod.save_variant_mix(ctx, { id, screen: 'home', parent, title, note, slots_json: '{"hero":"home/v1"}' }));

  beforeEach(() => {
    t = makeHarness();
  });

  it('save_variant_mix writes the mix and a ready mix variant in one go, and re-saving updates both', () => {
    // Act
    save('worker-a', 'home/mix1', undefined, 'First', 'n');
    save('worker-a', 'home/mix1', undefined, 'Second', 'n2');

    // Assert
    const m = t.db.variantMix.id.find('home/mix1')!;
    expect([m.title, m.note, m.slots, m.screen]).toEqual(['Second', 'n2', '{"hero":"home/v1"}', 'home']);
    const v = t.db.variant.id.find('home/mix1')!;
    expect([v.kind, v.status, v.parent]).toEqual(['mix', 'ready', undefined]);
    expect(v.author).toBe(m.author.toHexString());
    expect(all(t.db.variant.iter())).toHaveLength(1);
  });

  it('save_variant_mix validates input and ownership', () => {
    // Arrange
    save('worker-a');

    // Act + Assert
    expect(() => save('worker-b')).toThrow(/belongs to someone else/);
    expect(() => save('worker-a', 'other/mix')).toThrow(/must look like home\//);
    expect(() => save('worker-a', 'home/m2', 'other/v1')).toThrow(/must be 'home\/<id>'/);
    expect(() => save('worker-a', 'home/m2', undefined, 'x'.repeat(201))).toThrow(/title/);
    expect(() => save('worker-a', 'home/m2', undefined, 'x', 'y'.repeat(2_001))).toThrow(/note/);
    expect(() => save('worker-a', 'home/m2', undefined, 'x'.repeat(200), 'y'.repeat(2_000))).not.toThrow();
    expect(() =>
      t.as('worker-a', (ctx) => mod.save_variant_mix(ctx, { id: 'home/m3', screen: 'home', parent: undefined, title: '', note: '', slots_json: '{nope' })),
    ).toThrow(/not valid JSON/);
  });

  it('delete_variant_mix: author or operator, refused while a variant has it as parent', () => {
    // Arrange
    save('worker-a');
    save('worker-a', 'home/mix2', 'home/mix1');

    // Act + Assert
    expect(() => t.as('worker-b', (ctx) => mod.delete_variant_mix(ctx, { id: 'home/mix1' }))).toThrow(/operator/);
    expect(() => t.as('worker-a', (ctx) => mod.delete_variant_mix(ctx, { id: 'home/mix1' }))).toThrow(/parent of 'home\/mix2'/);
    t.as('worker-a', (ctx) => mod.delete_variant_mix(ctx, { id: 'home/mix2' }));
    asOperator(t, (ctx) => mod.delete_variant_mix(ctx, { id: 'home/mix1' }));
    expect(all(t.db.variantMix.iter())).toHaveLength(0);
    expect(all(t.db.variant.iter())).toHaveLength(0);
    expect(() => t.as('worker-a', (ctx) => mod.delete_variant_mix(ctx, { id: 'home/mix1' }))).toThrow(/unknown mix/);
  });

  it('pick_variant upserts one pick per screen and an empty node_id clears it', () => {
    // Act
    t.as('worker-a', (ctx) => mod.pick_variant(ctx, { screen: 'home', node_id: 'home/v1' }));
    t.as('worker-b', (ctx) => mod.pick_variant(ctx, { screen: 'home', node_id: 'home/v2' }));

    // Assert
    expect(all(t.db.variantPick.iter())).toHaveLength(1);
    expect(t.db.variantPick.screen.find('home')!.node_id).toBe('home/v2');
    t.as('worker-a', (ctx) => mod.pick_variant(ctx, { screen: 'home', node_id: '' }));
    expect(all(t.db.variantPick.iter())).toHaveLength(0);
  });

  it('vote_variant keeps one vote per voter per screen and an empty node_id removes the caller vote', () => {
    // Act
    t.as('worker-a', (ctx) => mod.vote_variant(ctx, { screen: 'home', node_id: 'home/v1' }));
    t.as('worker-a', (ctx) => mod.vote_variant(ctx, { screen: 'home', node_id: 'home/v2' }));
    t.as('worker-b', (ctx) => mod.vote_variant(ctx, { screen: 'home', node_id: 'home/v1' }));

    // Assert
    const votes = all(t.db.variantVote.iter());
    expect(votes).toHaveLength(2);
    const a = votes.find((v) => v.node_id === 'home/v2')!;
    expect(a.id).toBe(`home:${a.voter.toHexString()}`);
    t.as('worker-a', (ctx) => mod.vote_variant(ctx, { screen: 'home', node_id: '' }));
    expect(all(t.db.variantVote.iter()).map((v) => v.node_id)).toEqual(['home/v1']);
  });

  it('reset_variants is operator only and clears one screen', () => {
    // Arrange
    save('worker-a');
    t.as('worker-a', (ctx) => mod.queue_variant_job(ctx, { screen: 'home', parent: undefined, brief: 'b', model: 'm' }));
    t.as('worker-a', (ctx) => mod.queue_variant_job(ctx, { screen: 'cart', parent: undefined, brief: 'b', model: 'm' }));
    t.as('worker-a', (ctx) => mod.pick_variant(ctx, { screen: 'home', node_id: 'home/mix1' }));
    t.as('worker-a', (ctx) => mod.vote_variant(ctx, { screen: 'home', node_id: 'home/mix1' }));
    t.as('worker-a', (ctx) => mod.vote_variant(ctx, { screen: 'cart', node_id: 'cart/v1' }));

    // Act + Assert
    expect(() => t.as('outsider', (ctx) => mod.reset_variants(ctx, { screen: 'home' }))).toThrow(/operator/);
    asOperator(t, (ctx) => mod.reset_variants(ctx, { screen: 'home' }));
    expect(all(t.db.variant.iter())).toHaveLength(0);
    expect(all(t.db.variantMix.iter())).toHaveLength(0);
    expect(all(t.db.variantPick.iter())).toHaveLength(0);
    expect(all(t.db.variantJob.iter()).map((j) => j.screen)).toEqual(['cart']);
    expect(all(t.db.variantVote.iter()).map((v) => v.screen)).toEqual(['cart']);
  });
});

describe("token purpose 'design'", () => {
  let t: Harness;
  beforeEach(() => {
    t = makeHarness();
    register(t, 'agent-a');
    asOperator(t, (ctx) => mod.start_run(ctx, { mode: 'with_contract', seed: 1 }));
  });

  const log = (purpose: string, taskId = 1n) =>
    t.as('worker-a', (ctx) =>
      mod.log_tokens(ctx, { run_id: 1n, agent_id: 'agent-a', task_id: taskId, attempt: 1, purpose, prompt_tokens: 10, completion_tokens: 5, cache_read_tokens: 0, cost_usd: 0.01 }),
    );

  it('log_tokens accepts it', () => {
    expect(() => log('design')).not.toThrow();
    expect(() => log('bogus')).toThrow(/invalid token purpose/);
  });

  it('mark_attempt_wasted skips design rows that share a task id with a variant job', () => {
    // Arrange
    log('design');
    log('code');

    // Act
    asOperator(t, (ctx) => mod.mark_attempt_wasted(ctx, { task_id: 1n, attempt: 1 }));

    // Assert
    expect(all(t.db.tokenUsage.iter()).map((r) => [r.purpose, r.wasted])).toEqual([['design', false], ['code', true]]);
  });
});
