// scripts/control.ts: run the demo's commands from the dashboard. Owner: dashboard + demo.
//   npm run control -- [--port 5199]
//
// The dashboard can't start processes and reducers have no process access (spec section 18),
// so this daemon does it for the dashboard's Control tab and chat. It connects out to
// SpacetimeDB as this laptop's `machine` row and runs the commands paired dashboards queue
// (scripts/daemon.ts): the same commands the README lists (coordinator, session start/merge,
// workers, judge, reset). It keeps the last lines of each one's output, and can stop them.
// Each laptop runs its own; it only controls processes on this machine.
//
// Any repo: `npm run control -- --repo <owner/name | git URL | path>` (or CONTRACT_TARGET, or
// the dashboard's Repository field) picks the repository. Every process it starts gets it as
// CONTRACT_TARGET, which the worker, session, mapper, judge and reset scripts all honor
// (packages/client/src/target.ts). A git URL is cloned once into .contract/repos/<owner>/<name>.
//
// Safety: nothing listens on a port. Only dashboards paired with this machine (machine_access,
// which only this daemon writes) can queue commands, every command goes through toCommand's
// allowlist, and arguments are passed as argv, never through a shell.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createLLM } from '@contract/llm';
import { cloneDirFor, DbConnection, missingTools, resolveTarget, type MissingTool } from '@contract/client';
import { Identity } from 'spacetimedb';
import { Assistant, type Plan, type Snapshot } from './assistant.ts';
import { browserCommand, Daemon, Pairer, type MachinePort } from './daemon.ts';
import { machineId, machineTokenKey, REPO, savedToken, saveToken, TSX, TSX_CLI } from './lib.ts';

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

/** git output that means "this laptop can't log in to that repo" (private repo, no credentials). */
const GIT_AUTH_ERROR = /could not read Username|terminal prompts disabled|Authentication failed|Repository not found|Permission denied \(publickey\)|Host key verification failed|returned error: 40[13]/i;

/**
 * When a clone or pull failed because git couldn't authenticate, the line to show the user.
 * Git runs with this laptop's own credentials (nothing goes through the dashboard), so the fix
 * is always on this laptop.
 */
export function gitAccessHint(log: string[], repo: string): string | undefined {
  if (!log.some((l) => GIT_AUTH_ERROR.test(l))) return undefined;
  const fix = repo.startsWith('https://')
    ? 'run `gh auth setup-git` (or set up a git credential helper) on this laptop, or use the SSH URL'
    : 'add an SSH key for this repo to your GitHub account (check with `ssh -T git@github.com`), or use the https URL with `gh auth setup-git`';
  return `[control] this laptop can't access ${repo}: it may be private or misspelled. To fix: ${fix}, then set the repository again.`;
}

/**
 * Environment for every process the daemon starts. Git must fail instead of prompting: no one
 * can type into these processes, so a private repo without credentials would hang forever.
 */
export function childEnv(base: NodeJS.ProcessEnv, repo: string): NodeJS.ProcessEnv {
  return {
    ...base,
    CONTRACT_TARGET: repo,
    FORCE_COLOR: '0',
    GIT_TERMINAL_PROMPT: '0',
    GIT_SSH_COMMAND: base.GIT_SSH_COMMAND ?? 'ssh -o BatchMode=yes',
  };
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
  /** The default bin is node, which needs tsx's entry first (see TSX in lib.ts); a test's stand-in doesn't. */
  private get binArgs(): string[] { return this.bin === TSX ? [TSX_CLI] : []; }

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
    const repo = this.repo;
    if (cmd.key === 'session-start') {
      const inner = onExit;
      onExit = (p) => { if (p.code === 0) { this.sessionRepo = repo; this.save(); } inner?.(p); };
    }
    const child = this.spawnFn(cmd.bin ?? this.bin, cmd.bin ? cmd.args : [...this.binArgs, ...cmd.args], {
      cwd: this.cwd,
      // Always set, so a CONTRACT_TARGET in .env can't override the dashboard's choice (dotenv
      // never overwrites a variable that exists).
      env: childEnv(process.env, this.repo),
      detached: true, // own process group, so stop() also ends the Claude Code runs it started
      windowsHide: true, // on Windows, detached would otherwise open an empty console window per process
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
        // Last line, so "couldn't get the repository: ..." in start() shows the fix.
        const hint = cmd.key === 'clone' && code !== 0 ? gitAccessHint(p.log, repo) : undefined;
        if (hint) p.log.push(hint);
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
    // Windows has no process groups (kill(-pid) throws), so taskkill /T ends the whole tree there.
    if (process.platform === 'win32') {
      try { execFileSync('taskkill', ['/pid', String(p.child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch { p.child.kill(); }
      return;
    }
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

/** This laptop's machine id (shared with the admin scripts in lib.ts, which connect as the same machine). */
export { machineId };

/** Connects as this laptop's daemon (same saved token every run, so pairings survive restarts). */
function connectDaemon(id: string): Promise<DbConnection> {
  const host = process.env.SPACETIME_HOST;
  const dbName = process.env.SPACETIME_DB_NAME;
  if (!host || !dbName) throw new Error('SPACETIME_HOST and SPACETIME_DB_NAME must be set (see .env.example)');
  const tokenKey = machineTokenKey(id);
  const q = (s: string) => s.replace(/'/g, "''");
  return new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error(`no response from ${host} (${dbName}) within 10 s`)), 10_000);
    const conn: DbConnection = DbConnection.builder()
      .withUri(host)
      .withDatabaseName(dbName)
      .withToken(savedToken(tokenKey))
      .onConnect((_ctx, _identity, token) => {
        saveToken(tokenKey, token);
        conn
          .subscriptionBuilder()
          .onApplied(() => (clearTimeout(timer), res(conn)))
          .onError((ctx) => (clearTimeout(timer), rej(new Error(`subscription failed: ${String(ctx.event ?? 'unknown')}`))))
          .subscribe([
            `SELECT * FROM machine WHERE id = '${q(id)}'`,
            `SELECT * FROM machine_access WHERE machine_id = '${q(id)}'`,
            `SELECT * FROM machine_command WHERE machine_id = '${q(id)}'`,
            `SELECT * FROM machine_pair_request WHERE machine_id = '${q(id)}'`,
            `SELECT * FROM machine_process WHERE machine_id = '${q(id)}'`,
            'SELECT * FROM run',
            'SELECT * FROM agent',
            'SELECT * FROM task',
          ]);
      })
      .onConnectError((_ctx, err) => (clearTimeout(timer), rej(err)))
      .onDisconnect(() => {
        console.error('[control] lost the connection to SpacetimeDB; restart npm run control');
        process.exit(1);
      })
      .build();
  });
}

function machinePort(conn: DbConnection, id: string): MachinePort {
  return {
    update: (s) => conn.reducers.updateMachine({ id, ...s }),
    finish: (commandId, ok, error) => conn.reducers.finishMachineCommand({ commandId, ok, error }),
    putProcess: (p) => conn.reducers.putMachineProcess({ machineId: id, ...p }),
    deleteProcess: (procKey) => conn.reducers.deleteMachineProcess({ machineId: id, procKey }),
    postChat: (m) => conn.reducers.postMachineChat({ machineId: id, role: m.role, text: m.text, atMs: m.at }),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === join(REPO, 'scripts', 'control.ts')) {
  const { values } = parseArgs({ options: { repo: { type: 'string' }, machine: { type: 'string' }, pair: { type: 'string', multiple: true }, open: { type: 'boolean' }, 'no-open': { type: 'boolean' } } });
  const id = machineId(values.machine ?? process.env.CONTRACT_MACHINE);
  const reg = new Registry();
  reg.stateFile = join(REPO, '.contract', 'control.json');
  const saved = reg.load();
  const { repo, clone } = reg.setRepo(values.repo ?? process.env.CONTRACT_TARGET ?? saved ?? '');
  console.log(`[control] repository: ${repo || 'demo-repo (built-in)'}${clone ? ' (cloning…)' : ''}`);

  const conn = await connectDaemon(id).catch((e: unknown) => {
    console.error(`[control] ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
  await conn.reducers.registerMachine({ id }).catch((e: unknown) => {
    console.error(`[control] ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
  // --pair <identity>: lets that dashboard (its identity is on the Control tab) command this laptop.
  for (const hex of values.pair ?? []) {
    try {
      await conn.reducers.grantMachineAccess({ machineId: id, identity: Identity.fromString(hex.trim()), label: 'paired from the terminal' });
      console.log(`[control] paired dashboard ${hex.trim().slice(0, 12)}…`);
    } catch (e) {
      console.error(`[control] couldn't pair ${hex}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const assistant = new Assistant(liveDeps(reg, conn));
  const daemon = new Daemon(reg, machinePort(conn, id), assistant);
  const toCmd = (row: { id: bigint; action: string; argsJson: string; status: string; createdAt: { microsSinceUnixEpoch: bigint } }) => ({
    id: row.id, action: row.action, argsJson: row.argsJson, status: row.status, createdAtMs: Number(row.createdAt.microsSinceUnixEpoch / 1000n),
  });
  // One command at a time, in order, so "set repo" then "start session" never race.
  let queue = Promise.resolve();
  const enqueue = (row: Parameters<typeof toCmd>[0]) => { queue = queue.then(() => daemon.handle(toCmd(row))).catch(() => undefined); };
  conn.db.machineCommand.onInsert((_ctx, row) => enqueue(row));
  for (const row of [...conn.db.machineCommand.iter()].sort((a, b) => (a.id < b.id ? -1 : 1))) enqueue(row);

  // Push process/log/chat changes every second; resend the machine row every 10 s as the heartbeat.
  let ticks = 0;
  setInterval(() => {
    if (++ticks % 10 === 0) daemon.touch();
    queue = queue.then(() => daemon.sync()).catch((e: unknown) => console.error(`[control] sync: ${e instanceof Error ? e.message : String(e)}`));
  }, 1000);
  // Rows an earlier daemon left at 'running' (it was killed before it could report) are marked stopped.
  await daemon.adopt([...conn.db.machineProcess.iter()].filter((p) => p.machineId === id).map((p) => ({
    procKey: p.procKey, label: p.label, long: p.long, status: p.status, code: p.code, startedAtMs: p.startedAtMs, endedAtMs: p.endedAtMs, log: p.log,
  })));
  await daemon.sync();
  const paired = [...conn.db.machineAccess.iter()].length;
  console.log(`[control] online as machine "${id}" on ${process.env.SPACETIME_HOST} (${process.env.SPACETIME_DB_NAME}); ${paired} paired dashboard${paired === 1 ? '' : 's'}`);

  // Pairing: a one-time code, shown as a link (one click) and as text (type it on the Control tab).
  const dashboardUrl = process.env.CONTRACT_DASHBOARD_URL || 'http://localhost:5173';
  const pairer = new Pairer();
  const showPairing = (open: boolean) => {
    const shown = pairer.fresh();
    const link = pairer.link(dashboardUrl, id, shown);
    console.log(`[control] pair a browser (works once, for 10 minutes): ${link}`);
    console.log(`[control]   or enter code ${shown} on the dashboard's Control tab. Press Enter here for a new code.`);
    if (!open) return;
    // No browser paired yet (or --open): open the link, so the dashboard comes up already linked to this laptop.
    const [bin, args] = browserCommand(process.platform, link);
    // Report the outcome, not the attempt: a missing opener errors, a failed one exits non-zero.
    // Node can fire both 'error' and 'exit' for a missing opener, so only the first one reports.
    let told = false;
    const tell = (opened: boolean) => {
      if (told) return;
      told = true;
      console.log(opened ? '[control] opened it in your browser.' : '[control]   (couldn\'t open a browser; click the link above)');
    };
    const child = spawn(bin, args, { stdio: 'ignore', detached: true });
    child.on('error', () => tell(false));
    child.on('exit', (code) => tell(code === 0));
    child.unref();
  };
  showPairing(!values['no-open'] && (values.open === true || paired === 0));
  process.stdin.on('data', () => showPairing(false));
  const answer = (row: { id: bigint; identity: Identity; proof: string }) => {
    const ok = pairer.check(row.identity.toHexString(), row.proof);
    conn.reducers.resolveMachinePairing({ requestId: row.id, accept: ok, label: 'paired with a code' })
      .then(() => { if (ok) console.log(`[control] paired a dashboard (${row.identity.toHexString().slice(0, 12)}…). Press Enter for a code for another browser.`); })
      .catch((e: unknown) => console.error(`[control] pairing: ${e instanceof Error ? e.message : String(e)}`));
  };
  conn.db.machinePairRequest.onInsert((_ctx, row) => answer(row));
  for (const row of [...conn.db.machinePairRequest.iter()]) answer(row); // queued while the daemon was off: the code is new, so these fail

  // Report the stopped processes before exiting (the 1 s tick may not run again), else the next
  // daemon finds them at 'running'. The timer is a backstop for a database that doesn't answer.
  const quit = () => {
    setTimeout(() => process.exit(0), 2000).unref();
    daemon.shutdown().catch(() => undefined).finally(() => process.exit(0));
  };
  process.on('SIGINT', quit);
  process.on('SIGTERM', quit);

  // One daemon per machine. A second `npm run control` on this laptop registers as the same
  // machine with the same saved identity, and the server accepts it: both would then answer every
  // pairing (the wrong one rejects the code) and run every command twice. register_machine
  // stamps started_at, so when the row's started_at moves past ours, a newer daemon took over
  // and this one stops.
  let registeredAt = conn.db.machine.id.find(id)?.startedAt.microsSinceUnixEpoch;
  let takenOver = false;
  conn.db.machine.onUpdate((_ctx, _old, row) => {
    if (row.id !== id || takenOver) return;
    const at = row.startedAt.microsSinceUnixEpoch;
    if (registeredAt === undefined || at <= registeredAt) {
      registeredAt ??= at;
      return;
    }
    takenOver = true;
    console.error(`[control] another npm run control just registered as machine "${id}"; stopping this one so only one answers the dashboard. If you meant this one, stop the other and start this again.`);
    setTimeout(() => process.exit(1), 2000).unref();
    daemon.shutdown().catch(() => undefined).finally(() => process.exit(1));
  });
}

/** The chat's real dependencies: one SpacetimeDB connection (opened on first use) and the model. */
function liveDeps(reg: Registry, conn: DbConnection) {
  const db = async () => conn;
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
