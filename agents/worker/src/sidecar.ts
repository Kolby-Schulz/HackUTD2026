// Per-agent hook sidecar. Owner: agents.
//
// Claude Code runs hook.ts (PostToolUse) and claim-guard.ts (PreToolUse) as a fresh process on
// every edit. Done in that process, each edit paid for loading the mapper (1-3 s) and a new
// WebSocket to SpacetimeDB (1.5-3.5 s), so laptop B saw laptop A's edit seconds late. The
// sidecar lives as long as the agent: one connection (the worker's own, see ContractClient.raw)
// with the mapper loaded, answering the hooks over 127.0.0.1 HTTP. The port and a per-run
// secret go in .contract/sidecar/<agent id>.json (sidecar-client.ts reads it).
//
//   POST /edit   {filePath, cwd, repoDir, sessionKey, wait?}  queue a report; answers at once
//   POST /guard  {input, repoDir, enforce}                     the claim guard's verdict
//   POST /ping   {}                                            liveness (scripts/latency.ts)
//
// Started by the worker (index.ts) and by `npm run watch-agent` (watch.ts). The connection must
// already subscribe to symbol, claim and this agent's conflicts (ContractClient's connect() does);
// the sidecar adds this agent's plans and the agent table, which the guard also reads.
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { dirname } from 'node:path';
import type { DbConnection } from '@contract/client';
import { guardVerdict, guardView, type GuardRequest, type GuardVerdict } from './claim-guard.ts';
import type { EditRequest } from './hook.ts';
import { analyzeFile, pendingTouched, sendReport } from './report.ts';
import { MONOREPO, sidecarFile, type SidecarInfo } from './sidecar-client.ts';
import { repoFile } from './summary-hook.ts';

export interface SidecarOptions {
  agentId: string;
  /** The current live connection, or undefined while it reconnects. Called on every request. */
  getConn: () => DbConnection | undefined;
  /** Monorepo whose .contract/sidecar/ holds the port file (default: this checkout). */
  repo?: string;
  log?: (m: string) => void;
}

/** One report's timings, from the moment the sidecar took the job. */
export interface EditTimings {
  file: string;
  queueMs: number;
  mapMs: number;
  diffMs: number;
  reduceMs: number;
  totalMs: number;
}

const sql = (s: string) => `'${s.replace(/'/g, "''")}'`;
const since = (t: number) => Math.round(performance.now() - t);
/** How long a request waits for a dropped connection to come back before giving up. */
const CONN_WAIT_MS = 5000;
/** A guard block that only means "your plan/claim isn't here yet" is re-checked after this long. */
const RECHECK_MS = 300;

export class Sidecar {
  private extra = new WeakMap<DbConnection, Promise<void>>();
  private chain: Promise<unknown> = Promise.resolve();
  /** Reports queued but not started, by repoDir + file: a second edit before it starts rides along. */
  private waiting = new Map<string, Promise<EditTimings>>();
  private server?: Server;
  private file?: string;
  private log: (m: string) => void;

  constructor(private o: SidecarOptions) {
    this.log = o.log ?? ((m) => console.error(`[sidecar ${o.agentId}] ${m}`));
  }

  /** The live connection with the sidecar's extra subscription applied (waits out a reconnect). */
  async conn(): Promise<DbConnection> {
    const until = Date.now() + CONN_WAIT_MS;
    let c = this.o.getConn();
    while (!c && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 100));
      c = this.o.getConn();
    }
    if (!c) throw new Error('no SpacetimeDB connection');
    let ready = this.extra.get(c);
    if (!ready) {
      const conn = c;
      ready = new Promise<void>((ok, fail) => {
        conn.subscriptionBuilder()
          .onApplied(() => ok())
          .onError((ctx) => fail(new Error(`sidecar subscription failed: ${String(ctx.event ?? 'unknown error')}`)))
          .subscribe([`SELECT * FROM plan WHERE agent_id = ${sql(this.o.agentId)}`, 'SELECT * FROM agent']);
      });
      ready.catch(() => this.extra.delete(conn));
      this.extra.set(c, ready);
    }
    await ready;
    return c;
  }

  /** Reports one edited file (repo-relative). Reports run one at a time, in order. */
  report(repoDir: string, rel: string, sessionKey: string): Promise<EditTimings> {
    const key = `${repoDir}\0${rel}`;
    const queued = this.waiting.get(key);
    if (queued) return queued;
    const t0 = performance.now();
    const job = this.chain.then(async (): Promise<EditTimings> => {
      this.waiting.delete(key);
      const queueMs = since(t0);
      const conn = await this.conn();
      const a = await analyzeFile(repoDir, rel);
      const reduceMs = await sendReport(conn, this.o.agentId, rel, a, sessionKey, this.log);
      return { file: rel, queueMs, mapMs: a.mapMs, diffMs: a.diffMs, reduceMs, totalMs: since(t0) };
    });
    this.waiting.set(key, job);
    this.chain = job.catch((e: unknown) => this.log(`${rel}: ${e instanceof Error ? e.message : String(e)}`));
    return job;
  }

  /** The claim guard's verdict for a pending edit, from the subscription cache. */
  async guard(req: GuardRequest): Promise<GuardVerdict> {
    const { input, repoDir, enforce } = req;
    const path = input.tool_input?.file_path;
    const rel = path ? repoFile(path, input.cwd, repoDir) : undefined;
    if (!rel) return { code: 0 };
    const { touched, sourceFile } = await pendingTouched(input, repoDir, rel);
    if (!sourceFile && !touched.length) return { code: 0 };
    const o = { agentId: this.o.agentId, rel, touched, sourceFile, enforce };
    let v = guardVerdict(guardView(await this.conn(), this.o.agentId), { ...o, nowMs: Date.now() });
    if (v.retryable) {
      // The agent's own claim_symbol / declare_plan went through its MCP server's connection;
      // give that update a moment to reach ours before telling the model it forgot.
      await new Promise((r) => setTimeout(r, RECHECK_MS));
      v = guardVerdict(guardView(await this.conn(), this.o.agentId), { ...o, nowMs: Date.now() });
    }
    return { code: v.code, message: v.message };
  }

  /** Starts the HTTP server on a free 127.0.0.1 port and writes the port file. */
  async listen(): Promise<number> {
    const secret = randomBytes(16).toString('hex');
    const server = createServer((req, res) => {
      const reply = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.method !== 'POST' || req.headers['x-contract-secret'] !== secret) return reply(403, { error: 'forbidden' });
      readBody(req)
        .then(async (body) => {
          switch (req.url) {
            case '/ping':
              return reply(200, { ok: true, agentId: this.o.agentId, pid: process.pid });
            case '/guard':
              return reply(200, await this.guard(body as GuardRequest));
            case '/edit': {
              const e = body as EditRequest;
              const rel = repoFile(e.filePath, e.cwd, e.repoDir);
              if (!rel) return reply(200, { ok: true, skipped: true });
              const job = this.report(e.repoDir, rel, e.sessionKey);
              if (!e.wait) return reply(202, { ok: true, queued: rel });
              return reply(200, { ok: true, ...(await job) });
            }
            default:
              return reply(404, { error: 'not found' });
          }
        })
        .catch((e: unknown) => reply(503, { error: e instanceof Error ? e.message : String(e) }));
    });
    await new Promise<void>((ok, fail) => {
      server.once('error', fail);
      server.listen(0, '127.0.0.1', () => ok());
    });
    server.unref(); // never keeps the worker alive on its own
    this.server = server;
    const port = (server.address() as { port: number }).port;
    const info: SidecarInfo = { port, secret, pid: process.pid, agentId: this.o.agentId };
    this.file = sidecarFile(this.o.agentId, this.o.repo ?? MONOREPO);
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(info) + '\n', { mode: 0o600 });
    // Load the parsers now, so the first edit doesn't pay for it.
    void import('@contract/mapper');
    return port;
  }

  /** Removes the port file (if it is still ours) and stops listening. Safe to call twice. */
  close() {
    if (this.file) {
      try {
        const info = JSON.parse(readFileSync(this.file, 'utf8')) as SidecarInfo;
        if (info.pid === process.pid) rmSync(this.file, { force: true });
      } catch { /* already gone */ }
      this.file = undefined;
    }
    this.server?.close();
    this.server = undefined;
  }
}

/** Creates a sidecar, starts listening, and removes its port file when the process exits. */
export async function startSidecar(o: SidecarOptions): Promise<Sidecar> {
  const s = new Sidecar(o);
  await s.listen();
  process.once('exit', () => s.close());
  return s;
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((ok, fail) => {
    let text = '';
    req.setEncoding('utf8');
    req.on('data', (c: string) => {
      text += c;
      if (text.length > 4 << 20) req.destroy(new Error('request too large'));
    });
    req.on('end', () => {
      try {
        ok(text ? JSON.parse(text) : {});
      } catch (e) {
        fail(e);
      }
    });
    req.on('error', fail);
  });
}
