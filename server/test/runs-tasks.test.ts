// start_run, end_run, create_task, set_task_status (spec section 7).
import { describe, it, expect, beforeEach } from 'vitest';
import { makeHarness, register, mod, all, type Harness, asOperator } from './helpers';

function startRun(t: Harness, mode = 'with_contract', seed = 7) {
  asOperator(t, (ctx) => mod.start_run(ctx, { mode, seed }));
  return all(t.db.run.iter()).at(-1)!;
}

function createTask(t: Harness, runId: bigint, agent_id = 'agent-a') {
  asOperator(t, (ctx) =>
    mod.create_task(ctx, { title: 'Late fees', description: 'Add late fees', agent_id, run_id: runId }),
  );
  return all(t.db.task.iter()).at(-1)!;
}

describe('start_run / end_run', () => {
  let t: Harness;
  beforeEach(() => {
    t = makeHarness();
  });

  it.each(['with_contract', 'without_contract'])('opens a %s run', (mode) => {
    // Arrange
    const seed = 7;

    // Act
    const run = startRun(t, mode, seed);

    // Assert
    expect(run).toMatchObject({ mode, seed, ended_at: undefined });
    expect(run.started_at.microsSinceUnixEpoch).toBe(t.now());
  });

  it('rejects an unknown mode', () => {
    // Arrange
    const mode = 'turbo';

    // Act
    const act = () => startRun(t, mode);

    // Assert
    expect(act).toThrow(/invalid run mode 'turbo'/);
    expect(all(t.db.run.iter())).toHaveLength(0);
  });

  it('rejects a second run while one is open', () => {
    // Arrange
    startRun(t);

    // Act
    const act = () => startRun(t, 'without_contract');

    // Assert
    expect(act).toThrow(/is already open/);
    expect(all(t.db.run.iter())).toHaveLength(1);
  });

  it('closes a run, after which a new run can start', () => {
    // Arrange
    const run = startRun(t);
    t.advance(90);

    // Act
    asOperator(t, (ctx) => mod.end_run(ctx, { run_id: run.id }));
    const next = startRun(t, 'without_contract');

    // Assert
    expect(t.db.run.id.find(run.id)!.ended_at!.microsSinceUnixEpoch).toBe(t.now());
    expect(next.id).not.toBe(run.id);
  });

  it('rejects ending an unknown or already-ended run', () => {
    // Arrange
    const run = startRun(t);
    asOperator(t, (ctx) => mod.end_run(ctx, { run_id: run.id }));

    // Act
    const endTwice = () => asOperator(t, (ctx) => mod.end_run(ctx, { run_id: run.id }));
    const endUnknown = () => asOperator(t, (ctx) => mod.end_run(ctx, { run_id: 999n }));

    // Assert
    expect(endTwice).toThrow(/already ended/);
    expect(endUnknown).toThrow(/unknown run 999/);
  });
});

describe('create_task', () => {
  let t: Harness;
  beforeEach(() => {
    t = makeHarness();
  });

  it('creates a todo task on attempt 1', () => {
    // Arrange
    const run = startRun(t);

    // Act
    const task = createTask(t, run.id);

    // Assert
    expect(task).toMatchObject({
      title: 'Late fees',
      description: 'Add late fees',
      agent_id: 'agent-a',
      status: 'todo',
      attempt: 1,
      run_id: run.id,
    });
  });

  it('rejects a task for an unknown run', () => {
    // Arrange
    const runId = 42n;

    // Act
    const act = () => createTask(t, runId);

    // Assert
    expect(act).toThrow(/unknown run 42/);
    expect(all(t.db.task.iter())).toHaveLength(0);
  });
});

describe('set_task_status', () => {
  let t: Harness;
  let taskId: bigint;
  const setStatus = (status: string, task_id = taskId) =>
    t.as('outsider', (ctx) => mod.set_task_status(ctx, { task_id, status }));

  beforeEach(() => {
    t = makeHarness();
    register(t, 'agent-a');
    taskId = createTask(t, startRun(t).id).id;
  });

  // Every allowed path from the transition table.
  it.each([
    [['in_progress']],
    [['discarded']],
    [['in_progress', 'paused']],
    [['in_progress', 'done']],
    [['in_progress', 'discarded']],
    [['in_progress', 'paused', 'in_progress', 'done']],
    [['in_progress', 'paused', 'done']],
    [['in_progress', 'paused', 'discarded']],
  ])('allows %j', (path) => {
    // Arrange
    const steps = path as string[];

    // Act
    for (const s of steps) setStatus(s);

    // Assert
    expect(t.db.task.id.find(taskId)!.status).toBe(steps.at(-1));
  });

  it.each([
    ['todo', 'done'],
    ['todo', 'paused'],
    ['done', 'in_progress'],
    ['discarded', 'in_progress'],
    ['done', 'todo'],
  ])('rejects %s -> %s', (from, to) => {
    // Arrange
    if (from !== 'todo') {
      if (from === 'done') setStatus('in_progress');
      setStatus(from);
    }

    // Act
    const act = () => setStatus(to);

    // Assert
    expect(act).toThrow(/invalid status change/);
    expect(t.db.task.id.find(taskId)!.status).toBe(from);
  });

  it('rejects an unknown status value', () => {
    // Arrange
    const status = 'blocked';

    // Act
    const act = () => setStatus(status);

    // Assert
    expect(act).toThrow(/invalid task status 'blocked'/);
  });

  it('rejects an unknown task', () => {
    // Arrange
    const unknown = 999n;

    // Act
    const act = () => setStatus('in_progress', unknown);

    // Assert
    expect(act).toThrow(/unknown task 999/);
  });

  it('is a no-op when the status is unchanged', () => {
    // Arrange
    setStatus('in_progress');

    // Act
    const act = () => setStatus('in_progress');

    // Assert
    expect(act).not.toThrow();
    expect(t.db.task.id.find(taskId)!.status).toBe('in_progress');
  });

  it('keeps the agent row in step: working on in_progress, done on done', () => {
    // Arrange
    const agent = () => t.db.agent.id.find('agent-a')!;

    // Act
    setStatus('in_progress');
    const whileWorking = { ...agent() };
    setStatus('done');

    // Assert
    expect(whileWorking.status).toBe('working');
    expect(whileWorking.current_task_id).toBe(taskId);
    expect(agent().status).toBe('done');
    expect(agent().current_task_id).toBeUndefined();
  });

  it('sets the agent idle when its task is discarded', () => {
    // Arrange
    setStatus('in_progress');

    // Act
    setStatus('discarded');

    // Assert
    expect(t.db.agent.id.find('agent-a')).toMatchObject({ status: 'idle', current_task_id: undefined });
  });

  it('works for a task whose agent has not registered yet', () => {
    // Arrange
    const orphan = createTask(t, all(t.db.run.iter())[0].id, 'agent-z').id;

    // Act
    const act = () => setStatus('in_progress', orphan);

    // Assert
    expect(act).not.toThrow();
    expect(t.db.task.id.find(orphan)!.status).toBe('in_progress');
  });
});
