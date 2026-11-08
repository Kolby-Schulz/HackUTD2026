// scripts/daemon.ts: the laptop side of the Control tab and chat. Owner: dashboard + demo.
//
// `npm run control` runs this. It connects OUT to SpacetimeDB (nothing listens on a port),
// registers this laptop as a `machine` row, and runs the commands paired dashboards queue in
// `machine_command` through the same process Registry and allowlist as before (control.ts).
// Process status, log tails and the chat transcript go back into `machine_process` and
// `machine_chat`, so the hosted dashboard sees and drives this laptop like the local one did.
import { createHash, randomInt } from 'node:crypto';
import type { Assistant, ChatMessage } from './assistant.ts';
import { toCommand, type Registry } from './control.ts';

/** A queued command as the daemon sees it (a machine_command row). */
export interface MachineCommand {
  id: bigint;
  action: string;
  argsJson: string;
  status: string;
  createdAtMs: number;
}

export interface ProcessRow {
  procKey: string;
  label: string;
  long: boolean;
  status: string;
  code?: number;
  startedAtMs: number;
  endedAtMs?: number;
  log: string;
}

/** The reducers the daemon calls, so tests can run it without a server. */
export interface MachinePort {
  update(state: { repo: string; repoLabel: string; infoJson: string; needsSession: boolean; chatBusy: boolean }): Promise<void>;
  finish(commandId: bigint, ok: boolean, error: string): Promise<void>;
  putProcess(row: ProcessRow): Promise<void>;
  deleteProcess(procKey: string): Promise<void>;
  postChat(m: ChatMessage): Promise<void>;
}

/** Commands older than this when the daemon first sees them are failed, not run (e.g. queued while it was off). */
export const STALE_COMMAND_MS = 60_000;
const LOG_TAIL = 100;
/** Changes within this window go out in one sync, so a burst of log lines is one reducer call. */
export const COALESCE_MS = 100;
/** The machine row is resent this often even when nothing changed (the dashboard's online check). */
export const HEARTBEAT_MS = 10_000;

export class Daemon {
  private seen = new Set<bigint>();
  private sentProcs = new Map<string, string>();
  private sentChat = 0;
  private lastState = '';
  private timer?: ReturnType<typeof setTimeout>;
  private last: Promise<void> = Promise.resolve();
  private queued?: Promise<void>;
  constructor(private reg: Registry, private port: MachinePort, private assistant?: Assistant, private now = () => Date.now()) {}

  /** Pushes changes as they happen: every registry or chat change schedules a coalesced sync. */
  listen() {
    this.reg.onChange = () => this.schedule();
    if (this.assistant) this.assistant.onChange = () => this.schedule();
  }

  /** Syncs within `delayMs` (default COALESCE_MS); calls inside that window share one sync. */
  schedule(delayMs = COALESCE_MS) {
    if (this.timer) {
      if (delayMs > 0) return;
      clearTimeout(this.timer); // sooner wins
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, delayMs);
    this.timer.unref?.();
  }

  /**
   * One sync at a time. A call while one runs queues exactly one more pass (later calls join it),
   * so the newest state always goes out and a caller waits for at most two passes, never for a
   * stream of log lines. Never throws; failures are logged.
   */
  flush(): Promise<void> {
    if (this.queued) return this.queued;
    const pass = this.last.then(async () => {
      this.queued = undefined; // changes from here on need another pass
      try {
        await this.sync();
      } catch (e) {
        console.error(`[control] sync: ${e instanceof Error ? e.message : String(e)}`);
      }
    });
    this.queued = pass;
    this.last = pass;
    return pass;
  }

  /** Runs one queued command and marks it done or failed. Each id runs at most once. */
  async handle(cmd: MachineCommand): Promise<void> {
    if (cmd.status !== 'pending' || this.seen.has(cmd.id)) return;
    this.seen.add(cmd.id);
    let error = '';
    try {
      if (this.now() - cmd.createdAtMs > STALE_COMMAND_MS) throw new Error('expired: queued while this laptop\'s daemon was off');
      await this.run(cmd.action, parseArgs(cmd.argsJson));
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      console.log(`[control] ${cmd.action} failed: ${error}`);
    }
    await this.port.finish(cmd.id, !error, error);
    await this.flush();
  }

  private async run(action: string, args: Record<string, unknown>) {
    const str = (k: string) => (typeof args[k] === 'string' ? (args[k] as string) : '');
    switch (action) {
      case 'repo': {
        const { repo, clone } = this.reg.setRepo(str('repo'));
        console.log(`[control] repository: ${repo || 'demo-repo'}${clone ? ' (cloning)' : ''}`);
        return;
      }
      case 'stop':
        this.reg.stop(str('key'));
        console.log(`[control] stopped ${str('key')}`);
        return;
      case 'forget':
        this.reg.forget(str('key'));
        this.sentProcs.delete(str('key'));
        await this.port.deleteProcess(str('key'));
        return;
      case 'chat': {
        if (!this.assistant) throw new Error('chat is off on this laptop');
        if (this.assistant.busy) throw new Error('still working on your last message');
        const text = str('text').trim();
        if (!text) throw new Error('message is empty');
        void this.assistant.chat(text).finally(() => this.schedule(0)); // answers arrive through machine_chat
        return;
      }
      default: {
        const cmd = toCommand({ ...args, action }); // same allowlist and argv rules as before
        const p = this.reg.start(cmd);
        console.log(`[control] started ${p.label}: tsx ${cmd.args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`);
      }
    }
  }

  /** Pushes whatever changed since the last call: machine state, processes, new chat lines. */
  async sync(): Promise<void> {
    const state = {
      repo: this.reg.repo,
      repoLabel: this.reg.repoLabel(),
      infoJson: this.reg.info ? JSON.stringify(this.reg.info) : '',
      needsSession: this.reg.needsSession(),
      chatBusy: this.assistant?.busy ?? false,
    };
    const s = JSON.stringify(state);
    if (s !== this.lastState) {
      this.lastState = s;
      await this.port.update(state);
    }
    for (const p of this.reg.view(LOG_TAIL)) {
      const row: ProcessRow = {
        procKey: p.key, label: p.label, long: p.long, status: p.status, code: p.code ?? undefined,
        startedAtMs: p.startedAt, endedAtMs: p.endedAt, log: p.log.join('\n'),
      };
      const key = JSON.stringify(row);
      if (this.sentProcs.get(p.key) === key) continue;
      this.sentProcs.set(p.key, key);
      await this.port.putProcess(row);
    }
    for (const m of this.assistant?.messages ?? []) {
      if (m.id <= this.sentChat) continue;
      this.sentChat = m.id;
      await this.port.postChat(m);
    }
  }

  /** Forces the next sync to resend the machine state (the heartbeat). */
  touch() {
    this.lastState = '';
  }

  /**
   * Called once at start with this machine's machine_process rows. The server keeps them across
   * a restart of the same daemon, so one that was killed (closed terminal, crash, a stop that
   * never got synced) leaves its long processes at 'running' for good: the dashboard then
   * disables Change and offers a Stop that fails with "not running". Rows this daemon doesn't own
   * are marked stopped (finished ones stay as history), so the dashboard can clear them.
   */
  async adopt(rows: ProcessRow[]): Promise<void> {
    for (const r of rows) {
      if (r.status !== 'running' || this.reg.procs.has(r.procKey)) continue;
      const note = '[control] started by an earlier npm run control that has since exited; no longer tracked';
      await this.port.putProcess({ ...r, status: 'stopped', endedAtMs: this.now(), log: r.log ? `${r.log}\n${note}` : note });
    }
  }

  /** Stops every process and pushes their final state, so a restart doesn't find them 'running'. */
  async shutdown(): Promise<void> {
    this.reg.stopAll();
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.flush();
  }
}

function parseArgs(json: string): Record<string, unknown> {
  if (!json) return {};
  const v: unknown = JSON.parse(json);
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('command arguments must be a JSON object');
  return v as Record<string, unknown>;
}

/** Letters and digits that can't be misread (no 0/O, 1/I/L). */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const PAIR_CODE_TTL_MS = 10 * 60_000;
/** Wrong guesses before the code is thrown away (a new one prints on the terminal). */
export const MAX_PAIR_FAILURES = 20;

/** Pairing codes are compared in this form: upper case, no dashes or spaces. */
export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** What a dashboard sends as proof of the code: sha256("<code>:<identity hex>") in hex. */
export function pairProof(code: string, identityHex: string): string {
  return createHash('sha256').update(`${normalizeCode(code)}:${identityHex.toLowerCase()}`).digest('hex');
}

/**
 * The daemon's one-time pairing code. One code is live at a time; it works once, expires after
 * PAIR_CODE_TTL_MS, and is dropped after MAX_PAIR_FAILURES wrong proofs.
 */
export class Pairer {
  code?: string;
  private expiresAt = 0;
  private failures = 0;
  constructor(private now = () => Date.now(), private random = (n: number) => randomInt(n)) {}

  /** Makes a fresh code (shown as XXX-XXX) and returns it. */
  fresh(): string {
    let c = '';
    for (let i = 0; i < 6; i++) c += CODE_ALPHABET[this.random(CODE_ALPHABET.length)];
    this.code = c;
    this.expiresAt = this.now() + PAIR_CODE_TTL_MS;
    this.failures = 0;
    return `${c.slice(0, 3)}-${c.slice(3)}`;
  }

  /** True (and the code is used up) when proof matches the live code for this identity. */
  check(identityHex: string, proof: string): boolean {
    if (!this.code || this.now() > this.expiresAt) {
      this.code = undefined;
      return false;
    }
    if (pairProof(this.code, identityHex) === proof) {
      this.code = undefined;
      return true;
    }
    if (++this.failures >= MAX_PAIR_FAILURES) this.code = undefined;
    return false;
  }

  /** The link that pairs a browser in one click. The code sits after '#', so it never reaches the web server. */
  link(dashboardUrl: string, machineId: string, shown: string): string {
    return `${dashboardUrl.replace(/\/+$/, '')}/#/pair?machine=${encodeURIComponent(machineId)}&code=${shown}`;
  }
}

// One daemon per machine (newest wins), from both sides:
//  - TakeoverGuard: the OLDER daemon watches its `machine` row; register_machine stamps
//    started_at, so when it moves past ours a newer daemon took over and this one stops.
//  - takeOverPidFile: the NEWER daemon stops whatever pid the last daemon in this checkout left in
//    `.contract/control-<machine>.pid`. The database guard only works if the older daemon runs code
//    that has it (on 2026-11-08 a daemon started before the guard shipped outlived the new one and
//    both cloned the repo); the pid file catches that daemon, and one that lost its connection.

/** Decides, from the row's started_at (micros), whether a newer daemon re-registered this machine. */
export class TakeoverGuard {
  private done = false;
  constructor(private registeredAt?: bigint) {}
  /** True exactly once: the first time started_at moves past the value we registered with. */
  check(startedAt: bigint | undefined): boolean {
    if (this.done || startedAt === undefined) return false;
    if (this.registeredAt === undefined || startedAt <= this.registeredAt) {
      this.registeredAt ??= startedAt;
      return false;
    }
    this.done = true;
    return true;
  }
}

/**
 * Records `pid` in `file`, first stopping the daemon the file named if it is still a control
 * daemon (`isDaemon`). Returns the pid it stopped, if any. Pure apart from the file.
 */
export function takeOverPidFile(
  file: string,
  pid: number,
  isDaemon: (pid: number) => boolean,
  stop: (pid: number) => void,
  fs: { readFileSync: (p: string, enc: 'utf8') => string; writeFileSync: (p: string, data: string) => void; existsSync: (p: string) => boolean },
): number | undefined {
  let stopped: number | undefined;
  if (fs.existsSync(file)) {
    const old = Number(fs.readFileSync(file, 'utf8').trim());
    if (Number.isInteger(old) && old > 0 && old !== pid && isDaemon(old)) {
      stop(old);
      stopped = old;
    }
  }
  fs.writeFileSync(file, `${pid}\n`);
  return stopped;
}

/** The argv that opens a URL in the default browser, without a shell (a URL's & would split a cmd line). */
export function browserCommand(platform: string, url: string): [string, string[]] {
  if (platform === 'darwin') return ['open', [url]];
  if (platform === 'win32') return ['rundll32', ['url.dll,FileProtocolHandler', url]];
  return ['xdg-open', [url]];
}
