// Live tests: the mapper against a running SpacetimeDB (see README.md). One database,
// run in order: each test builds on the code map the previous one left.
import { spawn, type ChildProcess } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, DbConnection, type ContractClient } from '@contract/client';
import { MapSync, RepoMapper } from '../src/index.ts';
import { LIVE_DB, LIVE_WS } from './env';

const FIXTURE = fileURLToPath(new URL('../test/fixtures/repo', import.meta.url));
const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const MAPPER_DIR = fileURLToPath(new URL('..', import.meta.url));
const RUN = Math.random().toString(36).slice(2, 8);
const FEE = 'src/billing/fees.ts#calculateFee';
const LABEL = 'src/billing/fees.ts#feeLabel';
const CHECKOUT = 'src/checkout.ts#checkoutTotal';

const repo = mkdtempSync(join(tmpdir(), 'mapper-live-'));
cpSync(FIXTURE, repo, { recursive: true });
const file = (rel: string) => join(repo, rel);
const edit = (rel: string, from: string, to: string) => {
  const src = readFileSync(file(rel), 'utf8');
  if (!src.includes(from)) throw new Error(`edit: ${from} not in ${rel}`);
  writeFileSync(file(rel), src.replace(from, to));
};

/** An observer connection subscribed to every table (plays the seed script). */
function rawConnect(): Promise<DbConnection> {
  return new Promise((res, rej) => {
    const conn: DbConnection = DbConnection.builder()
      .withUri(LIVE_WS)
      .withDatabaseName(LIVE_DB)
      .onConnect(() => conn.subscriptionBuilder().onApplied(() => res(conn)).subscribeToAllTables())
      .onConnectError((_c, e) => rej(e))
      .build();
  });
}

async function waitFor<T>(check: () => T | undefined | null | false, ms = 15_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = check();
    if (v) return v;
    if (Date.now() - start > ms) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

let admin: DbConnection;
let sync: MapSync;
let mapper: RepoMapper;
const clients: ContractClient[] = [];

const row = (id: string) => admin.db.symbol.id.find(id);
const serverEdges = () => [...admin.db.symbolEdge.iter()].map((e) => `${e.callerId} -> ${e.calleeId}`).sort();
const mapEdges = () => mapper.mapAll().flatMap((m) => m.edges.map((e) => `${e.callerId} -> ${e.calleeId}`)).sort();
/** Re-reads changed files and pushes them plus their importers, like watch mode does. */
async function remap(...rels: string[]) {
  const targets = new Set(rels);
  for (const r of rels) for (const d of mapper.dependents(r)) targets.add(d);
  for (const r of rels) mapper.refresh(r);
  for (const r of rels) for (const d of mapper.dependents(r)) targets.add(d);
  const sent = [];
  for (const t of [...targets].sort()) {
    const u = await sync.push(mapper.mapFile(t));
    if (u) sent.push(u.file);
  }
  return sent;
}

beforeAll(async () => {
  admin = await rawConnect();
  sync = await MapSync.connect({ host: LIVE_WS, dbName: LIVE_DB });
  mapper = new RepoMapper(repo);
});

afterAll(async () => {
  for (const c of clients) await c.disconnect().catch(() => {});
  sync?.close();
  admin?.disconnect();
  rmSync(repo, { recursive: true, force: true });
});

describe('mapper against a live server', () => {
  it('a first full sync writes every symbol and edge', async () => {
    for (const m of mapper.mapAll()) await sync.push(m);
    const want = mapper.mapAll().flatMap((m) => m.symbols);
    await waitFor(() => admin.db.symbol.count() === BigInt(want.length));
    for (const s of want) {
      const r = row(s.id)!;
      expect({ name: r.name, kind: r.kind, signature: r.signature, hash: r.signatureHash, version: r.version }).toEqual({
        name: s.name,
        kind: s.kind,
        signature: s.signature,
        hash: s.signatureHash,
        version: 1,
      });
    }
    expect(row(FEE)!.file).toBe('src/billing/fees.ts');
    await waitFor(() => serverEdges().length === mapEdges().length);
    expect(serverEdges()).toEqual(mapEdges());
  });

  it('a restart (fresh connection, same repo) writes nothing', async () => {
    const again = await MapSync.connect({ host: LIVE_WS, dbName: LIVE_DB });
    try {
      for (const m of new RepoMapper(repo).mapAll()) expect(await again.push(m)).toBeUndefined();
    } finally {
      again.close();
    }
    expect([...admin.db.symbol.iter()].every((s) => s.version === 1)).toBe(true);
  });

  it('a signature change bumps only that symbol; a body-only change sends nothing', async () => {
    edit('src/billing/fees.ts', 'Math.floor', 'Math.round');
    expect(await remap('src/billing/fees.ts')).toEqual([]);

    edit('src/billing/fees.ts', 'rate: number = FEE_RATE,', 'rate: number = FEE_RATE, minimum = 0,');
    expect(await remap('src/billing/fees.ts')).toEqual(['src/billing/fees.ts']);
    await waitFor(() => row(FEE)?.version === 2);
    expect(row(FEE)!.signature).toBe('calculateFee(amount: number, rate: number = FEE_RATE, minimum = 0): number');
    expect(row(LABEL)!.version).toBe(1);
  });

  it('mapper edges drive Rule 1, and remapping keeps the behavior_note the agent reported', async () => {
    const info = (id: string) => ({ id, name: id, ownerDev: 'live', machine: 'ci', model: 'claude-code', tokenBudget: 1000 });
    const a = await connect({ host: LIVE_WS, dbName: LIVE_DB, agent: info(`a-${RUN}`), repoDir: repo });
    const b = await connect({ host: LIVE_WS, dbName: LIVE_DB, agent: info(`b-${RUN}`), repoDir: repo });
    clients.push(a, b);
    await admin.reducers.startRun({ mode: 'with_contract', seed: 7 });
    const runId = (await waitFor(() => [...admin.db.run.iter()].find((r) => r.endedAt === undefined))).id;
    await admin.reducers.createTask({ title: 'checkout', description: 'b task', agentId: b.agentId, runId });
    const task = await waitFor(() => [...admin.db.task.iter()].find((t) => t.agentId === b.agentId));

    // B only plans to modify checkoutTotal. It never mentions calculateFee: the link is the
    // mapper's edge checkoutTotal -> calculateFee (through a barrel + namespace import).
    await b.publishPlan(task.id, 'update checkout totals', [{ symbolId: CHECKOUT, intent: 'modify' }]);
    await a.reportChange(FEE, 'behavior', { description: 'rounds half-up now' });

    const conflict = await waitFor(() =>
      [...admin.db.conflict.iter()].find((c) => c.symbolId === FEE && c.agentB === b.agentId && c.kind === 'broken_dependency'),
    );
    expect(conflict.agentA).toBe(a.agentId);
    await waitFor(() => admin.db.agent.id.find(b.agentId)?.status === 'paused');
    await waitFor(() => row(FEE)?.behaviorNote === 'rounds half-up now');

    // Something else in fees.ts changes (a feeLabel overload); the mapper re-sends the file.
    edit('src/billing/fees.ts', 'feeLabel(amount: number): string;', 'feeLabel(amount: number, cents?: boolean): string;');
    expect(await remap('src/billing/fees.ts')).toEqual(['src/billing/fees.ts']);
    await waitFor(() => row(LABEL)?.version === 2);
    expect(row(FEE)!.behaviorNote).toBe('rounds half-up now');
  });

  it("keeps an agent's reported signature until the change lands in this checkout", async () => {
    const [a] = clients;
    const reported = 'calculateFee(amount: number, rate: number, mode: string): number';
    await a.reportChange(FEE, 'signature', { newSignature: reported, description: 'adds a rounding mode' });
    await waitFor(() => row(FEE)?.signature === reported);
    // The mapper keeps the text it sees in ITS subscription; wait until that has the report.
    // (A push in the few ms before then would still send the old text; see sync.ts.)
    await waitFor(() => sync.serverSymbols('src/billing/fees.ts').find((s) => s.id === FEE)?.signature === reported);

    // Unrelated change in the same file: the reported text must survive the re-send.
    edit('src/billing/fees.ts', 'cents?: boolean): string;', 'cents?: number): string;');
    await remap('src/billing/fees.ts');
    await waitFor(() => row(LABEL)?.version === 3);
    expect(row(FEE)!.signature).toBe(reported);

    // The agent's branch is merged: now the checkout has the new signature, so the mapper's wins.
    edit('src/billing/fees.ts', 'rate: number = FEE_RATE, minimum = 0,', 'rate: number, mode: string,');
    await remap('src/billing/fees.ts');
    await waitFor(() => row(FEE)?.signatureHash === mapper.mapFile('src/billing/fees.ts').symbols[0].signatureHash);
    expect(row(FEE)!.signature).toBe(reported);
    expect(row(FEE)!.behaviorNote).toBe('rounds half-up now');
  });

  it('a deleted file is cleared, with the edges pointing into it', async () => {
    unlinkSync(file('src/util/format.ts'));
    const sent = await remap('src/util/format.ts');
    expect(sent).toEqual(expect.arrayContaining(['src/util/format.ts', 'src/billing/invoice.ts', 'src/checkout.ts']));
    await waitFor(() => ![...admin.db.symbol.iter()].some((s) => s.file === 'src/util/format.ts'));
    await waitFor(() => !serverEdges().some((e) => e.includes('src/util/format.ts#')));
    expect(serverEdges()).toEqual(mapEdges());
  });
});

describe('CLI', () => {
  const env = { ...process.env, SPACETIME_HOST: LIVE_WS, SPACETIME_DB_NAME: LIVE_DB };
  const run = (args: string[]) =>
    new Promise<{ code: number | null; out: string }>((res) => {
      const p = spawn('npx', ['tsx', CLI, ...args], { cwd: MAPPER_DIR, env });
      let out = '';
      p.stdout.on('data', (d) => (out += d));
      p.stderr.on('data', (d) => (out += d));
      p.on('close', (code) => res({ code, out }));
    });

  it('one-shot: clears files the repo no longer has and leaves the rest alone', async () => {
    await sync.push({
      file: 'src/ghost.ts',
      symbols: [{ id: 'src/ghost.ts#boo', name: 'boo', kind: 'function', signature: 'boo()', signatureHash: 'x', behaviorNote: '' }],
      edges: [],
    });
    await waitFor(() => row('src/ghost.ts#boo'));
    const versions = new Map([...admin.db.symbol.iter()].map((s) => [s.id, s.version]));

    const { code, out } = await run(['--repo', repo]);
    expect(code, out).toBe(0);
    expect(out).toContain('src/ghost.ts: removed from the code map');
    await waitFor(() => !row('src/ghost.ts#boo'));
    for (const s of admin.db.symbol.iter()) expect(s.version).toBe(versions.get(s.id));
  });

  it('refuses to map a worker worktree', async () => {
    const { code, out } = await run(['--repo', '/tmp/x/.worktrees/agent-a/demo-repo', '--dry-run']);
    expect(code).toBe(1);
    expect(out).toContain('refusing to map a worker worktree');
  });

  it('--watch picks up a new file and a new call into it', async () => {
    let child: ChildProcess | undefined;
    try {
      child = spawn('npx', ['tsx', CLI, '--repo', repo, '--watch'], { cwd: MAPPER_DIR, env });
      let out = '';
      child.stdout!.on('data', (d) => (out += d));
      child.stderr!.on('data', (d) => (out += d));
      await waitFor(() => out.includes('watching'), 30_000);

      writeFileSync(file('src/util/dates.ts'), 'export function formatDate(d: Date): string {\n  return d.toISOString();\n}\n');
      const created = await waitFor(() => row('src/util/dates.ts#formatDate'));
      expect(created.signature).toBe('formatDate(d: Date): string');

      writeFileSync(
        file('src/checkout.ts'),
        readFileSync(file('src/checkout.ts'), 'utf8')
          .replace("import { LIMITS } from './models';", "import { LIMITS } from './models';\nimport { formatDate } from './util/dates';")
          .replace("throw new Error('too many');", "throw new Error(`too many at ${formatDate(new Date())}`);"),
      );
      await waitFor(() => serverEdges().includes(`${CHECKOUT} -> src/util/dates.ts#formatDate`));
      expect(out).not.toMatch(/failed/);
    } finally {
      child?.kill('SIGTERM');
      await new Promise((r) => (child?.exitCode !== null ? r(null) : child.once('exit', r)));
    }
  });
});
