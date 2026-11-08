// Task rows for the two-laptop session flow (worker --prompt / --wait). Owner: agents.
//
// `npm run session -- start` opens a run. A worker started with --prompt creates its own
// task row in that run; one started with --wait picks up the next todo task assigned to its
// agent id (the dashboard's "New task" form creates those).
import { DbConnection } from '@contract/client';

export interface SessionTask {
  id: bigint;
  description: string;
}

interface Opts {
  host: string;
  dbName: string;
  /** The worker's own token, so these rows are written by the same identity. */
  token: string;
  agentId: string;
}

const NO_RUN = 'no open run: start one with `npm run session -- start`';

function open(o: Opts, timeoutMs = 10_000): Promise<DbConnection> {
  return new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error(`no response from ${o.host} (${o.dbName}) within ${timeoutMs} ms`)), timeoutMs);
    const conn: DbConnection = DbConnection.builder()
      .withUri(o.host)
      .withDatabaseName(o.dbName)
      .withToken(o.token)
      .onConnect(() => {
        conn
          .subscriptionBuilder()
          .onApplied(() => (clearTimeout(timer), res(conn)))
          .onError((ctx) => (clearTimeout(timer), rej(new Error(`subscription failed: ${String(ctx.event ?? 'unknown')}`))))
          .subscribe(['SELECT * FROM run', `SELECT * FROM task WHERE agent_id = '${o.agentId.replace(/'/g, "''")}'`]);
      })
      .onConnectError((_ctx, err) => (clearTimeout(timer), rej(err)))
      .build();
  });
}

function openRunId(conn: DbConnection): bigint | undefined {
  return [...conn.db.run.iter()].find((r) => r.endedAt === undefined)?.id;
}

/** Creates a task row for `prompt` in the open run and returns it. */
export async function createPromptTask(o: Opts, prompt: string): Promise<SessionTask> {
  const conn = await open(o);
  try {
    const runId = openRunId(conn);
    if (runId === undefined) throw new Error(NO_RUN);
    const before = new Set([...conn.db.task.iter()].map((t) => t.id));
    const title = prompt.length > 60 ? `${prompt.slice(0, 57)}...` : prompt;
    await conn.reducers.createTask({ title, description: prompt, agentId: o.agentId, runId });
    const row = await until(() => [...conn.db.task.iter()].find((t) => !before.has(t.id) && t.runId === runId), 5_000, 'the new task row');
    return { id: row.id, description: row.description };
  } finally {
    conn.disconnect();
  }
}

/** Waits (no timeout) for a todo task assigned to this agent in the open run. */
export async function waitForTask(o: Opts, log: (msg: string) => void): Promise<SessionTask> {
  const conn = await open(o);
  try {
    let said = '';
    const row = await until(() => {
      const runId = openRunId(conn);
      const msg = runId === undefined ? `waiting: ${NO_RUN}` : `waiting for a task for ${o.agentId} in run ${runId} (dashboard: New task)`;
      if (msg !== said) log((said = msg));
      if (runId === undefined) return undefined;
      return [...conn.db.task.iter()]
        .filter((t) => t.runId === runId && t.status === 'todo')
        .sort((a, b) => (a.id < b.id ? -1 : 1))[0];
    });
    return { id: row.id, description: row.description };
  } finally {
    conn.disconnect();
  }
}

/** Polls the local cache (updated live by the subscription) until check() returns a value. */
async function until<T>(check: () => T | undefined, timeoutMs = Infinity, what = 'a value'): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = check();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}
