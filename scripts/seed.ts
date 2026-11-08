// scripts/seed.ts (spec sections 14, 15). Owner: dashboard + demo.
// npm run seed -- [--mode with_contract|without_contract] [--seed 7]
//
// Opens a run (ending any run left open) and creates the two demo tasks in it, one per
// agent. Prints the run id and task ids; run-demo.ts calls seed() directly.
import { parseArgs } from 'node:util';
import type { DbConnection } from '@contract/client';
import { SCENARIOS } from './scenarios.ts';
import { adminConnect, AGENTS, endOpenRuns, log, MODES, waitFor, type Mode } from './lib.ts';

export interface Seeded {
  runId: bigint;
  /** agent id -> task row id */
  tasks: Record<string, bigint>;
}

export async function seed(conn: DbConnection, mode: Mode, seedValue: number, scenario = 'planted'): Promise<Seeded> {
  const sc = SCENARIOS[scenario]!;
  const ended = await endOpenRuns(conn);
  if (ended.length) log('seed', `ended open run(s) ${ended.join(', ')}`);

  const before = new Set([...conn.db.run.iter()].map((r) => r.id));
  await conn.reducers.startRun({ mode, seed: seedValue });
  const run = await waitFor(() => [...conn.db.run.iter()].find((r) => !before.has(r.id) && r.endedAt === undefined), 'the new run');

  const tasks: Record<string, bigint> = {};
  for (const a of AGENTS) {
    const t = a.id === 'agent-a' ? sc.a : sc.b;
    await conn.reducers.createTask({ title: t.title, description: t.task, agentId: a.id, runId: run.id });
    const row = await waitFor(() => [...conn.db.task.iter()].find((t) => t.runId === run.id && t.agentId === a.id), `${a.id}'s task`);
    tasks[a.id] = row.id;
  }
  return { runId: run.id, tasks };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({
    options: { mode: { type: 'string', default: 'with_contract' }, seed: { type: 'string', default: '7' } },
  });
  const mode = values.mode as Mode;
  if (!MODES.includes(mode)) throw new Error(`--mode must be one of ${MODES.join(', ')}`);
  const conn = await adminConnect(['SELECT * FROM run', 'SELECT * FROM task']);
  const s = await seed(conn, mode, Number(values.seed));
  log('seed', `run ${s.runId} (${mode}, seed ${values.seed}); tasks ${Object.entries(s.tasks).map(([a, t]) => `${a}=${t}`).join(', ')}`);
  conn.disconnect();
  process.exit(0);
}
