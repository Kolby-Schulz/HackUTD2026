// scripts/latency.ts: how long until an edit on one laptop shows up on another. Owner: dashboard + demo.
//
//   npm run latency                      this laptop: each stage of the edit hooks, old path vs sidecar
//   npm run latency -- --echo            laptop B: answer pings until Ctrl-C
//   npm run latency -- --ping [--n 20]   laptop A: round trip through the server to laptop B and back
//
// Both laptops need the same SPACETIME_HOST / SPACETIME_DB_NAME (.env). Pings and pongs are rows
// written with claim_service (names `latency-ping-…` / `latency-pong-…`, released right after),
// so nothing shows on the dashboard and no agent is registered. One way ≈ round trip / 2: the time
// from laptop A's write reaching the server to laptop B's onInsert, which is what B's dashboard
// waits once A's hook has handed the edit over.
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { DbConnection } from '@contract/client';
import { REPO, TSX, TSX_CLI } from './lib.ts';

const { values } = parseArgs({
  options: {
    echo: { type: 'boolean', default: false },
    ping: { type: 'boolean', default: false },
    n: { type: 'string', default: '20' },
    'probe-direct': { type: 'boolean', default: false },
  },
});
const N = Math.max(1, Number(values.n) || 20);
const host = process.env.SPACETIME_HOST;
const dbName = process.env.SPACETIME_DB_NAME;
if (!host || !dbName) {
  console.error('SPACETIME_HOST and SPACETIME_DB_NAME must be set (see .env.example)');
  process.exit(1);
}
console.log = console.error; // keep the SDK's chatter off stdout (the probe prints JSON there)
const out = (s: string) => process.stdout.write(s + '\n');

const now = () => performance.now();
const ms = (n: number) => `${Math.round(n)} ms`;
function stats(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? NaN;
  return { median: at(0.5), p95: at(0.95), min: s[0] ?? NaN, max: s.at(-1) ?? NaN };
}
const fmt = (xs: number[]) => {
  const s = stats(xs);
  return `median ${ms(s.median)}, p95 ${ms(s.p95)} (min ${ms(s.min)}, max ${ms(s.max)}, n=${xs.length})`;
};

/** Connects (a fresh identity unless `token`), subscribes to `queries`, resolves once applied. */
function openConn(queries: string[], token?: string): Promise<{ conn: DbConnection; token: string; connectMs: number; subscribeMs: number }> {
  const t0 = now();
  return new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error(`no response from ${host} (${dbName}) within 15 s`)), 15_000);
    const conn: DbConnection = DbConnection.builder()
      .withUri(host!)
      .withDatabaseName(dbName!)
      .withToken(token)
      .onConnect((_ctx, _id, tok) => {
        const connectMs = now() - t0;
        const t1 = now();
        conn.subscriptionBuilder()
          .onApplied(() => (clearTimeout(timer), ok({ conn, token: tok, connectMs, subscribeMs: now() - t1 })))
          .onError((ctx) => fail(new Error(`subscription failed: ${String(ctx.event ?? 'unknown')}`)))
          .subscribe(queries);
      })
      .onConnectError((_ctx, e) => fail(e))
      .build();
  });
}

/** Resolves with the time at which a service row named `name` is inserted (or rejects after `ms`). */
function insertOf(conn: DbConnection, name: string, timeoutMs = 5000): Promise<number> {
  return new Promise((ok, fail) => {
    const timer = setTimeout(() => (conn.db.service.removeOnInsert(cb), fail(new Error(`no ${name} within ${timeoutMs} ms`))), timeoutMs);
    const cb = (_ctx: unknown, row: { name: string }) => {
      if (row.name !== name) return;
      clearTimeout(timer);
      conn.db.service.removeOnInsert(cb);
      ok(now());
    };
    conn.db.service.onInsert(cb);
  });
}

const machine = hostname().replace(/\.local$/, '');
const holder = `latency-${machine}-${process.pid}`;

// --- child: what a fresh hook process paid before the sidecar -----------------------------
if (values['probe-direct']) {
  let t = now();
  await import('@contract/mapper');
  const importMapperMs = now() - t;
  const { connectMs, subscribeMs, conn } = await openConn(["SELECT * FROM symbol WHERE file = 'latency-probe.ts'"]);
  t = now();
  await conn.reducers.releaseService({ name: `latency-none-${process.pid}`, holder }); // a no-op reducer: one server round trip
  const reducerMs = now() - t;
  conn.disconnect();
  out(JSON.stringify({ importMapperMs, connectMs, subscribeMs, reducerMs }));
  process.exit(0);
}

// --- two laptops -----------------------------------------------------------------------------
if (values.echo) {
  const { conn } = await openConn(['SELECT * FROM service']);
  out(`[latency] echoing pings on ${dbName} as ${holder}; run \`npm run latency -- --ping\` on the other laptop (Ctrl-C to stop)`);
  conn.db.service.onInsert((_ctx, row) => {
    if (!row.name.startsWith('latency-ping-')) return;
    const pong = row.name.replace('latency-ping-', 'latency-pong-');
    conn.reducers.claimService({ name: pong, machine, holder }).then(
      () => {
        out(`[latency] pong ${pong.slice('latency-pong-'.length)}`);
        setTimeout(() => void conn.reducers.releaseService({ name: pong, holder }).catch(() => undefined), 2000);
      },
      (e: unknown) => out(`[latency] pong failed: ${String(e)}`),
    );
  });
  process.on('SIGINT', () => (conn.disconnect(), process.exit(0)));
  await new Promise(() => {});
}

if (values.ping) {
  const { conn } = await openConn(['SELECT * FROM service']);
  const nonce = randomBytes(3).toString('hex');
  const rtt: number[] = [];
  const own: number[] = [];
  out(`[latency] ${N} pings on ${dbName}; the other laptop must run \`npm run latency -- --echo\``);
  for (let i = 0; i < N; i++) {
    const ping = `latency-ping-${nonce}-${i}`;
    const sawOwn = insertOf(conn, ping);
    const sawPong = insertOf(conn, `latency-pong-${nonce}-${i}`);
    const t0 = now();
    await conn.reducers.claimService({ name: ping, machine, holder });
    try {
      own.push((await sawOwn) - t0);
      rtt.push((await sawPong) - t0);
    } catch (e) {
      out(`[latency] ${e instanceof Error ? e.message : String(e)}`);
      if (i === 0) {
        out('[latency] no answer: is `npm run latency -- --echo` running on the other laptop, on the same database?');
        process.exit(1);
      }
    }
    await conn.reducers.releaseService({ name: ping, holder }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 100));
  }
  conn.disconnect();
  out('');
  out(`this laptop -> server -> this laptop (own write seen): ${fmt(own)}`);
  out(`this laptop -> server -> other laptop -> server -> back: ${fmt(rtt)}`);
  out(`one way, laptop A's write to laptop B's onInsert (≈ round trip / 2): median ${ms(stats(rtt).median / 2)}, p95 ${ms(stats(rtt).p95 / 2)}`);
  process.exit(0);
}

// --- one laptop: each stage of the edit hooks ------------------------------------------------
const HOOK = join(REPO, 'agents/worker/src/hook.ts');
const GUARD = join(REPO, 'agents/worker/src/claim-guard.ts');

/** Runs `args` under tsx with `stdin`, resolving with its wall time and stdout. */
function run(args: string[], env: Record<string, string>, stdin = ''): Promise<{ ms: number; stdout: string; code: number | null }> {
  const t0 = now();
  return new Promise((ok) => {
    const child = spawn(TSX, [TSX_CLI, ...args], { cwd: REPO, env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', (b: Buffer) => (stdout += b.toString()));
    child.stderr.resume();
    child.on('exit', (code) => ok({ ms: now() - t0, stdout, code }));
    child.stdin.end(stdin);
  });
}

const median = (xs: number[]) => stats(xs).median;
const RUNS = Math.min(N, 5);
const rows: [string, string][] = [];
const row = (label: string, value: string) => {
  rows.push([label, value]);
  out(`  ${label.padEnd(52)} ${value}`);
};

out(`[latency] ${host} (${dbName}), ${RUNS} runs per hook stage, ${N} for server round trips\n`);

// A throwaway repo with one edited source file, so the hooks have real work to do.
const repoDir = mkdtempSync(join(tmpdir(), 'contract-latency-'));
mkdirSync(join(repoDir, 'src'));
writeFileSync(join(repoDir, 'src/probe.ts'), 'export function probe(n: number): number {\n  return n + 1;\n}\n');
execFileSync('git', ['init', '-q'], { cwd: repoDir });

// Server first: what the connection itself costs once it is open.
const a = await openConn(['SELECT * FROM service']);
const b = await openConn(['SELECT * FROM service']);
const own: number[] = [];
const fanout: number[] = [];
for (let i = 0; i < N; i++) {
  const name = `latency-local-${process.pid}-${i}`;
  const seenA = insertOf(a.conn, name);
  const seenB = insertOf(b.conn, name);
  const t0 = now();
  await a.conn.reducers.claimService({ name, machine, holder });
  own.push((await seenA) - t0);
  fanout.push((await seenB) - t0);
  await a.conn.reducers.releaseService({ name, holder }).catch(() => undefined);
}
b.conn.disconnect();

out('Server (connection already open):');
row('write -> own onInsert', fmt(own));
row('write -> another connection\'s onInsert (= a dashboard)', fmt(fanout));

out('\nBefore: a fresh hook process per edit (still the fallback with no sidecar):');
const tsxStart: number[] = [];
for (let i = 0; i < RUNS; i++) tsxStart.push((await run(['-e', '0'], {})).ms);
row('tsx process start (empty script)', fmt(tsxStart));
const probes: { importMapperMs: number; connectMs: number; subscribeMs: number; reducerMs: number }[] = [];
for (let i = 0; i < RUNS; i++) {
  const r = await run([join(REPO, 'scripts/latency.ts'), '--probe-direct'], { SPACETIME_HOST: host, SPACETIME_DB_NAME: dbName });
  try {
    probes.push(JSON.parse(r.stdout.trim().split('\n').at(-1)!));
  } catch { /* failed run */ }
}
row('import @contract/mapper', fmt(probes.map((p) => p.importMapperMs)));
row('open a WebSocket to the server', fmt(probes.map((p) => p.connectMs)));
row('subscribe', fmt(probes.map((p) => p.subscribeMs)));
row('one reducer call', fmt(probes.map((p) => p.reducerMs)));

const agentId = `latency-${process.pid}`;
const hookEnv = {
  CONTRACT_AGENT_ID: agentId,
  CONTRACT_TOKEN: a.token, // report_edit fails (no such agent) after its server round trip; the timing is what counts
  CONTRACT_REPO_DIR: repoDir,
  CONTRACT_PROTOCOL: 'off',
  SPACETIME_HOST: host,
  SPACETIME_DB_NAME: dbName,
};
const editInput = JSON.stringify({ session_id: `latency-${process.pid}`, cwd: repoDir, tool_name: 'Edit', tool_input: { file_path: join(repoDir, 'src/probe.ts'), old_string: 'return n + 1;' } });
const before = { post: [] as number[], pre: [] as number[] };
for (let i = 0; i < RUNS; i++) before.post.push((await run([HOOK], hookEnv, editInput)).ms);
for (let i = 0; i < RUNS; i++) before.pre.push((await run([GUARD], hookEnv, editInput)).ms);
row('PostToolUse hook (whole process, edit reaches server)', fmt(before.post));
row('PreToolUse claim guard (whole process)', fmt(before.pre));

out('\nAfter: thin hook -> this agent\'s sidecar (one open connection, mapper loaded):');
const { Sidecar } = await import('../agents/worker/src/sidecar.ts');
const { askSidecar } = await import('../agents/worker/src/sidecar-client.ts');
const sidecar = new Sidecar({ agentId, getConn: () => a.conn, log: () => {} });
await sidecar.listen();
try {
  await askSidecar(agentId, '/edit', { filePath: join(repoDir, 'src/probe.ts'), cwd: repoDir, repoDir, sessionKey: 'warm', wait: true }, 15_000); // warm the parser
  const after = { post: [] as number[], pre: [] as number[], work: [] as { mapMs: number; diffMs: number; reduceMs: number; totalMs: number }[] };
  for (let i = 0; i < RUNS; i++) after.post.push((await run([HOOK], hookEnv, editInput)).ms);
  for (let i = 0; i < RUNS; i++) after.pre.push((await run([GUARD], hookEnv, editInput)).ms);
  for (let i = 0; i < N; i++) {
    const r = await askSidecar<{ mapMs: number; diffMs: number; reduceMs: number; totalMs: number }>(agentId, '/edit', { filePath: join(repoDir, 'src/probe.ts'), cwd: repoDir, repoDir, sessionKey: `latency-${i}`, wait: true }, 15_000);
    if (r) after.work.push(r);
  }
  row('PostToolUse hook (whole process, hands off and exits)', fmt(after.post));
  row('PreToolUse claim guard (whole process, cache answer)', fmt(after.pre));
  row('sidecar: parse the file', fmt(after.work.map((w) => w.mapMs)));
  row('sidecar: git diff', fmt(after.work.map((w) => w.diffMs)));
  row('sidecar: reducer calls over the open connection', fmt(after.work.map((w) => w.reduceMs)));
  row('sidecar: total, job taken -> server replied', fmt(after.work.map((w) => w.totalMs)));

  // Visible on another laptop = when the reducer call leaves + fan-out. Before, the hook's last
  // step was that call's round trip (≈ own); after, the call leaves once the sidecar has parsed and diffed.
  const beforeTotal = median(before.post) - median(own) + median(fanout);
  const afterTotal = median(after.post) + median(after.work.map((w) => w.totalMs - w.reduceMs)) + median(fanout);
  out('\nEdit on this laptop -> another laptop\'s dashboard (medians, estimated):');
  row('before (hook process + fresh connection + fan-out)', ms(beforeTotal));
  row('after (thin hook + sidecar + fan-out)', ms(afterTotal));
  out('\nThe hook process start is most of what is left; on two laptops, add `--ping`/`--echo` for the real network leg.');
} finally {
  sidecar.close();
  a.conn.disconnect();
}
process.exit(0);
