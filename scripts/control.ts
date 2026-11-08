// scripts/control.ts: run the demo's commands from the dashboard. Owner: dashboard + demo.
//   npm run control -- [--port 5199]
//
// The dashboard can't start processes and reducers have no process access (spec section 18),
// so this small local HTTP server does it for the dashboard's Control tab. It starts the same
// commands the README lists (coordinator, session start/merge, workers, judge, reset), keeps the
// last lines of each one's output, and can stop them. Each laptop runs its own; it only controls
// processes on this machine.
//
// Any repo: `npm run control -- --repo <owner/name | git URL | path>` (or CONTRACT_TARGET, or
// the dashboard's Repository field) picks the repository. Every process it starts gets it as
// CONTRACT_TARGET, which the worker, session, mapper, judge and reset scripts all honor
// (packages/client/src/target.ts). A git URL is cloned once into .contract/repos/<name>.
//
// Safety: it listens on 127.0.0.1 only, answers only pages served from localhost, and needs a
// custom header on every POST (so a random website can't trigger it). Arguments are passed as
// argv, never through a shell.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { hostname } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createLLM } from '@contract/llm';
import { cloneDirFor, missingTools, resolveTarget, type DbConnection, type MissingTool } from '@contract/client';
import { Assistant, type Plan, type Snapshot } from './assistant.ts';
import { adminConnect, REPO, TSX } from './lib.ts';

export const DEFAULT_PORT = 5199;
export const HEADER = 'x-contract-control';
/** Where GET / sends a browser (the dashboard's dev server, Chat tab). */
export const DASHBOARD_URL = process.env.DASHBOARD_URL ?? 'http://localhost:5173/#/chat';
const LOG_LINES = 300;

export type Action =
  | { action: 'coordinator' }
  | { action: 'session-start' }
  | { action: 'session-merge'; integration?: boolean }
  | { action: 'worker'; id: string; prompt?: string }
  | { action: 'judge' }
  | { action: 'reset' };

export interface Command {
  key: string;
  label: string;
  args: string[];
  /** Runs until stopped (coordinator, workers, judge) rather than finishing on its own. */
  long: boolean;
  /** Program to run instead of tsx (the clone step runs git). */
  bin?: string;
}

const GH_SHORT = /^[\w.-]+\/[\w.-]+$/;
const GIT_URL = /^(https:\/\/|git@|ssh:\/\/)[\w.@:/~-]+$/;

/**
 * Turns what someone typed in the Repository field into a CONTRACT_TARGET value:
 * '' = the built-in demo-repo; "owner/name", "github.com/owner/name" or a GitHub page URL
 * -> https://github.com/owner/name.git; other https/ssh git URLs as they are; else a local
 * path (relative to the monorepo), which must exist.
 */
export function normalizeRepo(input: string, root = REPO): string {
  let s = input.trim().replace(/\/+$/, '');
  if (!s || s === 'demo-repo') return '';
  if (s.startsWith('-')) throw new Error('repository can\'t start with "-"');
  s = s.replace(/^(https?:\/\/)?(www\.)?github\.com\//, '');
  if (GH_SHORT.test(s) && !existsSync(resolve(root, s))) {
    const [owner, name] = s.split('/');
    return `https://github.com/${owner}/${name.replace(/\.git$/, '')}.git`;
  }
  if (GIT_URL.test(s)) return s;
  const dir = resolve(root, s);
  if (!existsSync(dir)) throw new Error(`no such folder: ${dir} (for GitHub use owner/name or the repo's URL)`);
  return dir;
}

/**
 * Gets a git URL target onto this laptop: clones it into .contract/repos/ the first time, and
 * pulls it later (the mapper maps that checkout, so it should match what's on GitHub).
 * Undefined for the demo and local paths.
 */
export function cloneCommand(repo: string, root = REPO): Command | undefined {
  if (!GIT_URL.test(repo)) return undefined;
  const dir = cloneDirFor(root, repo);
  if (existsSync(join(dir, '.git'))) return { key: 'clone', label: 'Update repository', bin: 'git', args: ['-C', dir, 'pull', '--ff-only'], long: false };
  return { key: 'clone', label: 'Clone repository', bin: 'git', args: ['clone', repo, dir], long: false };
}

const LANGS: [RegExp, string][] = [
  [/\.(ts|tsx|mts|cts)$/, 'TypeScript'], [/\.(js|jsx|mjs|cjs)$/, 'JavaScript'], [/\.py$/, 'Python'], [/\.go$/, 'Go'],
  [/\.java$/, 'Java'], [/\.rs$/, 'Rust'], [/\.rb$/, 'Ruby'], [/\.php$/, 'PHP'], [/\.cs$/, 'C#'],
  [/\.(c|h|cc|cpp|cxx|hpp|hh)$/, 'C/C++'],
];

/** Languages in a checkout, by tracked file count (git ls-files: fast, skips ignored files). */
export function detectLanguages(dir: string): string[] {
  let files: string[] = [];
  try {
    files = execFileSync('git', ['ls-files'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }).split('\n');
  } catch {
    return [];
  }
  const counts = new Map<string, number>();
  for (const f of files) {
    const lang = LANGS.find(([re]) => re.test(f))?.[1];
    if (lang) counts.set(lang, (counts.get(lang) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]).map(([l]) => l);
}

/** What the UI shows about the target once it's on disk. */
export interface RepoInfo {
  /** Merge checks by name ([] = merges aren't checked). */
  checks: string[];
  /** Dependency installs by tool name ("npm", "pip"; [] = none). */
  install: string[];
  /** Source languages by file count, most first. */
  languages: string[];
  /** Tools the installs and checks need that this laptop lacks (shown as a warning). */
  missing: MissingTool[];
  /** Where the checkout lives on this laptop. */
  dir: string;
}


const AGENT_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const MAX_PROMPT = 4000;

/** Validates a request body and turns it into the command to run (tsx + script + args). */
export function toCommand(body: unknown): Command {
  if (!body || typeof body !== 'object') throw new Error('expected a JSON object');
  const b = body as Record<string, unknown>;
  switch (b.action) {
    case 'coordinator':
      return { key: 'coordinator', label: 'Coordinator', args: ['agents/coordinator/src/index.ts'], long: true };
    case 'session-start':
      return { key: 'session-start', label: 'Start session', args: ['scripts/session.ts', 'start'], long: false };
    case 'session-merge':
      return { key: 'session-merge', label: 'Merge session', args: ['scripts/session.ts', 'merge', ...(b.integration === true ? ['--integration'] : [])], long: false };
    case 'judge':
      return { key: 'judge', label: 'Judge agent', args: ['scripts/judge.ts'], long: true };
    case 'reset':
      return { key: 'reset', label: 'Reset', args: ['scripts/reset.ts'], long: false };
    case 'worker': {
      const id = typeof b.id === 'string' ? b.id.trim() : '';
      if (!AGENT_ID.test(id)) throw new Error('agent id: lowercase letters, digits and dashes, up to 32 characters');
      const prompt = typeof b.prompt === 'string' ? b.prompt.trim() : '';
      if (prompt.length > MAX_PROMPT) throw new Error(`prompt is longer than ${MAX_PROMPT} characters`);
      return {
        key: `worker:${id}`,
        label: `Worker ${id}`,
        args: ['agents/worker/src/index.ts', '--id', id, ...(prompt ? ['--prompt', prompt] : ['--wait'])],
        long: true,
      };
    }
    default:
      throw new Error(`unknown action ${JSON.stringify(b.action)}`);
  }
}

/** Only pages served from this machine may call the control server. */
export function allowedOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  try {
    const { hostname: h, protocol } = new URL(origin);
    return (protocol === 'http:' || protocol === 'https:') && (h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h.endsWith('.localhost'));
  } catch {
    return false;
  }
}

export interface Proc {
  key: string;
  label: string;
  long: boolean;
  status: 'running' | 'exited' | 'stopped';
  code: number | null;
  startedAt: number;
  endedAt?: number;
  log: string[];
  child?: ChildProcess;
  /** Resolves with the exit code once the process ends. */
  exited?: Promise<number | null>;
}

/** The processes this control server started, newest state per key. */
export class Registry {
  procs = new Map<string, Proc>();
  /** CONTRACT_TARGET for every process started from here ('' = the built-in demo-repo). */
  repo = '';
  /** The repo the last successful session start from here mapped (undefined = none yet). */
  sessionRepo?: string;
  info?: RepoInfo;
  /** Where repo + sessionRepo are saved so a restart keeps them (unset in tests). */
  stateFile?: string;
  constructor(private spawnFn: typeof spawn = spawn, private bin = TSX, private cwd = REPO) {}

  /** Loads the saved repo choice; returns the saved repo, if any. */
  load(): string | undefined {
    if (!this.stateFile || !existsSync(this.stateFile)) return undefined;
    try {
      const st = JSON.parse(readFileSync(this.stateFile, 'utf8')) as { repo?: string; sessionRepo?: string };
      this.sessionRepo = st.sessionRepo;
      return st.repo;
    } catch {
      return undefined;
    }
  }

  private save() {
    if (!this.stateFile) return;
    try {
      mkdirSync(dirname(this.stateFile), { recursive: true });
      writeFileSync(this.stateFile, JSON.stringify({ repo: this.repo, sessionRepo: this.sessionRepo }, null, 2));
    } catch { /* best effort */ }
  }

  /** Re-reads the target's checks once it's on disk. */
  refreshInfo() {
    try {
      const t = resolveTarget(this.cwd, this.repo, { clone: false });
      this.info = {
        checks: t.checks.map((c) => c.name),
        install: t.install.map((c) => c.name),
        languages: detectLanguages(t.dir),
        missing: missingTools(t),
        dir: t.dir,
      };
    } catch {
      this.info = undefined;
    }
  }

  /**
   * True when the open run maps a different repo than the target. The run table doesn't record
   * its repo, so with no session started from this laptop the open run is assumed to be the demo
   * (so a second laptop on the demo never ends the first laptop's run).
   */
  needsSession() {
    return (this.sessionRepo ?? '') !== this.repo;
  }


  running() {
    return [...this.procs.values()].filter((p) => p.status === 'running');
  }

  /** Switches the target repo. Refused while anything runs, so one run never mixes repos. */
  setRepo(input: string): { repo: string; clone?: Proc } {
    const repo = normalizeRepo(input, this.cwd);
    const busy = this.running();
    if (repo !== this.repo && busy.length) throw new Error(`stop ${busy.map((p) => p.label).join(', ')} before switching repositories`);
    this.repo = repo;
    this.save();
    this.refreshInfo();
    const clone = cloneCommand(repo, this.cwd);
    return { repo, clone: clone && this.start(clone, (p) => { if (p.code === 0) this.refreshInfo(); }) };
  }

  /** Short name for the UI: the demo, owner/name for GitHub, else the folder name. */
  repoLabel() {
    if (!this.repo) return 'demo-repo';
    const gh = /github\.com[/:]([\w.-]+\/[\w.-]+?)(\.git)?$/.exec(this.repo);
    return gh ? gh[1] : this.repo.split(/[\\/]/).filter(Boolean).pop() ?? this.repo;
  }

  start(cmd: Command, onExit?: (p: Proc) => void): Proc {
    const prev = this.procs.get(cmd.key);
    if (prev?.status === 'running') throw new Error(`${cmd.label} is already running`);
    if (cmd.key !== 'clone' && this.procs.get('clone')?.status === 'running') throw new Error('still cloning the repository; try again when it finishes');
    if (cmd.key !== 'clone' && this.procs.get('clone')?.status === 'exited' && this.procs.get('clone')?.code !== 0) {
      throw new Error(`couldn't get the repository: ${this.procs.get('clone')?.log.at(-1) ?? 'git failed'}. Fix it and set the repository again`);
    }
    if (cmd.key === 'session-start') {
      const repo = this.repo;
      const inner = onExit;
      onExit = (p) => { if (p.code === 0) { this.sessionRepo = repo; this.save(); } inner?.(p); };
    }
    const child = this.spawnFn(cmd.bin ?? this.bin, cmd.args, {
      cwd: this.cwd,
      // Always set, so a CONTRACT_TARGET in .env can't override the dashboard's choice (dotenv
      // never overwrites a variable that exists).
      env: { ...process.env, CONTRACT_TARGET: this.repo, FORCE_COLOR: '0' },
      detached: true, // own process group, so stop() also ends the Claude Code runs it started
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const p: Proc = { key: cmd.key, label: cmd.label, long: cmd.long, status: 'running', code: null, startedAt: Date.now(), log: [], child };
    this.procs.set(cmd.key, p);
    const add = (chunk: Buffer) => {
      for (const line of chunk.toString().split(/\r?\n/)) if (line.trim()) p.log.push(line);
      if (p.log.length > LOG_LINES) p.log.splice(0, p.log.length - LOG_LINES);
    };
    child.stdout?.on('data', add);
    child.stderr?.on('data', add);
    p.exited = new Promise((resolveExit) => {
      const done = (code: number | null) => {
        if (p.endedAt) return;
        if (p.status === 'running') p.status = 'exited';
        p.code = code;
        p.endedAt = Date.now();
        p.child = undefined;
        resolveExit(code);
        onExit?.(p);
      };
      child.on('error', (e) => { p.log.push(`[control] ${e.message}`); done(null); });
      child.on('exit', (code) => done(code));
    });
    return p;
  }

  stop(key: string) {
    const p = this.procs.get(key);
    if (!p || p.status !== 'running' || !p.child?.pid) throw new Error(`${key} is not running`);
    p.status = 'stopped';
    try { process.kill(-p.child.pid, 'SIGTERM'); } catch { p.child.kill('SIGTERM'); }
  }

  stopAll() {
    for (const p of this.procs.values()) if (p.status === 'running') try { this.stop(p.key); } catch { /* already gone */ }
  }

  /** Clears a finished process from the list. */
  forget(key: string) {
    if (this.procs.get(key)?.status === 'running') throw new Error(`${key} is still running; stop it first`);
    this.procs.delete(key);
  }

  view(tail = 40) {
    return [...this.procs.values()].map(({ child: _c, exited: _e, log, ...p }) => ({ ...p, log: log.slice(-tail) }));
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > 64_000) req.destroy(); });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { reject(new Error('body is not JSON')); } });
    req.on('error', reject);
  });
}

export function controlServer(reg = new Registry(), assistant?: Assistant) {
  return createServer(async (req, res) => {
    const origin = req.headers.origin;
    // Requests from a page need a localhost origin; curl from this machine (no Origin) is fine.
    if (origin !== undefined && !allowedOrigin(origin)) return send(res, 403, { error: 'origin not allowed' });
    if (origin) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'origin');
      res.setHeader('access-control-allow-headers', `content-type, ${HEADER}`);
      res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
      // Chrome's private network access preflight (page on a LAN address calling 127.0.0.1)
      res.setHeader('access-control-allow-private-network', 'true');
    }
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    try {
      // Opening the control server in a browser goes to the dashboard's Chat tab, where it's used.
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(302, { location: DASHBOARD_URL });
        return res.end();
      }
      if (req.method === 'GET' && url.pathname === '/status') {
        return send(res, 200, {
          machine: hostname().replace(/\.local$/, ''),
          repo: reg.repo,
          repoLabel: reg.repoLabel(),
          repoInfo: reg.info,
          needsSession: reg.needsSession(),
          processes: reg.view(Number(url.searchParams.get('tail') ?? 40)),
        });
      }
      if (req.method === 'GET' && url.pathname === '/chat') {
        if (!assistant) return send(res, 404, { error: 'chat is off' });
        return send(res, 200, assistant.view(Number(url.searchParams.get('after') ?? 0)));
      }
      if (req.method === 'POST') {
        if (req.headers[HEADER] !== '1') return send(res, 403, { error: `missing ${HEADER} header` });
        const body = (await readJson(req)) as Record<string, unknown>;
        if (url.pathname === '/run') {
          const cmd = toCommand(body);
          const p = reg.start(cmd);
          console.log(`[control] started ${p.label}: tsx ${cmd.args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`);
          return send(res, 200, { ok: true, key: p.key });
        }
        if (url.pathname === '/chat' && assistant) {
          const text = typeof body.text === 'string' ? body.text.trim() : '';
          if (!text) return send(res, 400, { error: 'message is empty' });
          if (text.length > 4000) return send(res, 400, { error: 'message is longer than 4000 characters' });
          if (assistant.busy) return send(res, 409, { error: 'still working on your last message' });
          void assistant.chat(text); // answers arrive through GET /chat
          return send(res, 202, { ok: true });
        }
        if (url.pathname === '/repo' && typeof body.repo === 'string') {
          const { repo, clone } = reg.setRepo(body.repo);
          console.log(`[control] repository: ${repo || 'demo-repo'}${clone ? ' (cloning)' : ''}`);
          return send(res, 200, { ok: true, repo, label: reg.repoLabel(), cloning: Boolean(clone) });
        }
        if (url.pathname === '/stop' && typeof body.key === 'string') {
          reg.stop(body.key);
          console.log(`[control] stopped ${body.key}`);
          return send(res, 200, { ok: true });
        }
        if (url.pathname === '/forget' && typeof body.key === 'string') {
          reg.forget(body.key);
          return send(res, 200, { ok: true });
        }
      }
      return send(res, 404, { error: 'not found' });
    } catch (e) {
      return send(res, 400, { error: e instanceof Error ? e.message : String(e) });
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === join(REPO, 'scripts', 'control.ts')) {
  const { values } = parseArgs({ options: { port: { type: 'string' }, repo: { type: 'string' } } });
  const port = Number(values.port ?? process.env.CONTROL_PORT ?? DEFAULT_PORT);
  const reg = new Registry();
  reg.stateFile = join(REPO, '.contract', 'control.json');
  const saved = reg.load();
  const { repo, clone } = reg.setRepo(values.repo ?? process.env.CONTRACT_TARGET ?? saved ?? '');
  console.log(`[control] repository: ${repo || 'demo-repo (built-in)'}${clone ? ' (cloning…)' : ''}`);
  const server = controlServer(reg, new Assistant(liveDeps(reg)));
  server.listen(port, '127.0.0.1', () => {
    console.log(`[control] listening on http://127.0.0.1:${port}; open the dashboard's Control tab`);
  });
  server.on('error', (e) => { console.error(`[control] ${e.message}`); process.exit(1); });
  const quit = () => { reg.stopAll(); setTimeout(() => process.exit(0), 300); };
  process.on('SIGINT', quit);
  process.on('SIGTERM', quit);
}

/** The chat's real dependencies: one SpacetimeDB connection (opened on first use) and the model. */
function liveDeps(reg: Registry) {
  let conn: Promise<DbConnection> | undefined;
  const db = () => {
    conn ??= adminConnect(['SELECT * FROM run', 'SELECT * FROM agent', 'SELECT * FROM task']).catch((e) => {
      conn = undefined; // retry on the next message
      throw e;
    });
    return conn;
  };
  const llm = createLLM();
  return {
    reg,
    decide: (prompt: string, schema: Record<string, unknown>, opts: Parameters<typeof llm.decide>[2]) => llm.decide<Plan>(prompt, schema, opts),
    sendInstruction: async (agentId: string, text: string) => {
      await (await db()).reducers.sendInstruction({ agentId, text });
    },
    snapshot: async (): Promise<Snapshot> => {
      const c = await db();
      const now = Date.now();
      const fresh = (a: { lastHeartbeat: { microsSinceUnixEpoch: bigint } }) => now - Number(a.lastHeartbeat.microsSinceUnixEpoch / 1000n) < 60_000;
      const run = [...c.db.run.iter()].find((r) => r.endedAt === undefined);
      const tasks = run ? [...c.db.task.iter()].filter((t) => t.runId === run.id) : [];
      const agents = [...c.db.agent.iter()].filter(fresh);
      return {
        openRun: run && { id: String(run.id), mode: String(run.mode) },
        coordinatorOnline: agents.some((a) => a.id === 'coordinator'),
        agents: agents
          .filter((a) => a.id !== 'coordinator' && a.id !== 'mapper')
          .map((a) => ({ id: a.id, status: String(a.status), task: tasks.filter((t) => t.agentId === a.id).pop()?.title })),
      };
    },
  };
}
