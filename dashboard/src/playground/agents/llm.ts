// The LLM AgentDriver seam (AGENT-28). The browser NEVER calls a model and holds no API keys: it talks
// to an optional local Node bridge (which uses packages/llm decide/runWorker) over a tiny JSON protocol.
// Off by default; if the bridge is absent the driver says so and the agent goes idle. Everything the
// bridge returns is untrusted: hand-written guards, fail closed, one atomic batch through board.exec.
//
// PROTOCOL v1 (bridge = base URL, e.g. http://localhost:8787)
//   GET  {bridge}/health        -> 200 {"v":1}
//   POST {bridge}/task          body {v:1, agent:{id,name,role?}, task:{...}, perception:Perception, repair?:string}
//     -> 200 {v:1, say?:string, commands?:Command[], usage?:{prompt_tokens,completion_tokens,cost_usd?,estimated?}}
//     -> or  {v:1, error:string}
//   `repair` is set on the single retry after invalid output and carries the validation message.
import { opId } from '../core/ids';
import type { AgentContext, AgentDriver, Command, Task } from '../core/types';
import { buildPerception } from './perception';
import { usageStore } from './usage';
import type { UsageStore } from './usage';

export const PROTOCOL_VERSION = 1;
export const MAX_COMMANDS = 200, MAX_RESPONSE_BYTES = 256_000, MAX_SAY = 2000;

type Rec = Record<string, unknown>;
const isObj = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length <= max;
const isRef = (v: unknown): boolean => typeof v === 'string' && /^(\$\d{1,3}|[A-Za-z0-9_-]{1,64})$/.test(v);
const isRefs = (v: unknown): boolean => Array.isArray(v) && v.length >= 1 && v.length <= 200 && v.every(isRef);
const isColor = (v: unknown) => typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v);
const isPaint = (v: unknown) => isObj(v) && v.type === 'solid' && isColor(v.color) && (v.opacity === undefined || isNum(v.opacity));
const oneOf = (...o: string[]) => (v: unknown) => typeof v === 'string' && o.includes(v);

/** Allowed shape props and their guards. Unknown keys are rejected (no humanEdited, author, ...). */
const PROP_GUARDS: Record<string, (v: unknown) => boolean> = {
  name: (v) => isStr(v, 80), x: isNum, y: isNum, w: isNum, h: isNum, rotation: isNum,
  hidden: (v) => typeof v === 'boolean', locked: (v) => typeof v === 'boolean', opacity: isNum,
  fills: (v) => Array.isArray(v) && v.length <= 8 && v.every(isPaint),
  strokes: (v) => Array.isArray(v) && v.length <= 8 && v.every((s) => isObj(s) && isColor(s.color) && isNum(s.width)),
  radius: (v) => isNum(v) || (Array.isArray(v) && v.length === 4 && v.every(isNum)),
  clip: (v) => typeof v === 'boolean',
  text: (v) => isStr(v, 4000), fontFamily: (v) => isStr(v, 80), fontSize: isNum, fontWeight: isNum,
  textAlign: oneOf('left', 'center', 'right', 'justify'), textVAlign: oneOf('top', 'middle', 'bottom'),
  color: isColor,
};
const KINDS = ['frame', 'group', 'rect', 'ellipse', 'text'];

function propsError(p: unknown): string | null {
  if (!isObj(p)) return 'props must be an object';
  for (const [k, v] of Object.entries(p)) {
    const g = PROP_GUARDS[k];
    if (!g) return `prop "${k}" is not allowed`;
    if (!g(v)) return `prop "${k}" has an invalid value`;
  }
  return null;
}
const posOk = (v: unknown) => v === undefined || v === 'top' || v === 'bottom' || (isObj(v) && isRef(v.after));

/** null = fine, else a short reason. Only document-editing commands are accepted; chat/status/claims belong to the runtime. */
export function commandError(c: unknown): string | null {
  if (!isObj(c) || typeof c.t !== 'string') return 'command must be an object with a "t" string';
  const bad = (m: string) => `${c.t}: ${m}`;
  switch (c.t) {
    case 'shape.create': {
      if (!KINDS.includes(c.kind as string)) return bad('kind must be one of ' + KINDS.join('/'));
      if (c.id !== undefined && !isRef(c.id)) return bad('bad id');
      if (c.parent !== undefined && c.parent !== null && !isRef(c.parent)) return bad('bad parent');
      if (!posOk(c.at)) return bad('bad "at"');
      const e = propsError(c.props ?? {});
      return e ? bad(e) : null;
    }
    case 'shape.update': {
      if (!isRefs(c.ids)) return bad('ids must be 1-200 ids');
      const e = propsError(c.patch);
      return e ? bad(e) : null;
    }
    case 'shape.translate': return isRefs(c.ids) && isNum(c.dx) && isNum(c.dy) ? null : bad('needs ids, dx, dy');
    case 'shape.resize': return isRef(c.id) && isObj(c.box) && ['x', 'y', 'w', 'h'].every((k) => isNum((c.box as Rec)[k])) ? null : bad('needs id and box {x,y,w,h}');
    case 'shape.delete': case 'shape.ungroup': return isRefs(c.ids) ? null : bad('ids must be 1-200 ids');
    case 'shape.duplicate': return isRefs(c.ids) && (c.offset === undefined || (isObj(c.offset) && isNum(c.offset.x) && isNum(c.offset.y))) ? null : bad('bad ids/offset');
    case 'shape.reparent': return isRefs(c.ids) && (c.parent === null || isRef(c.parent)) && posOk(c.at) ? null : bad('bad ids/parent');
    case 'shape.reorder': return isRefs(c.ids) && oneOf('front', 'back', 'forward', 'backward')(c.to) ? null : bad('bad ids/to');
    case 'shape.group': return isRefs(c.ids) && (c.as === undefined || c.as === 'group' || c.as === 'frame') && (c.name === undefined || isStr(c.name, 80)) ? null : bad('bad ids/as/name');
    case 'selection.set': return Array.isArray(c.ids) && c.ids.length <= 200 && c.ids.every(isRef) ? null : bad('bad ids');
    default: return `command "${c.t}" is not allowed from the bridge`;
  }
}

export type BridgeReply = { ok: true; say?: string; commands: Command[]; usage?: unknown } | { ok: false; error: string };

/** Validate a decoded bridge response. Pure; used by the driver and the tests. */
export function validateReply(raw: unknown): BridgeReply {
  if (!isObj(raw)) return { ok: false, error: 'bridge reply is not an object' };
  if (raw.v !== PROTOCOL_VERSION) return { ok: false, error: `unsupported protocol version ${String(raw.v)}` };
  if (raw.error !== undefined) return { ok: false, error: `bridge error: ${String(raw.error).slice(0, 300)}` };
  if (raw.say !== undefined && !isStr(raw.say, MAX_SAY)) return { ok: false, error: '"say" must be a string up to 2000 chars' };
  const cmds = raw.commands ?? [];
  if (!Array.isArray(cmds)) return { ok: false, error: '"commands" must be an array' };
  if (cmds.length > MAX_COMMANDS) return { ok: false, error: `too many commands (max ${MAX_COMMANDS})` };
  for (let i = 0; i < cmds.length; i++) {
    const e = commandError(cmds[i]);
    if (e) return { ok: false, error: `command ${i}: ${e}` };
  }
  return { ok: true, say: raw.say as string | undefined, commands: cmds as Command[], usage: raw.usage };
}

export interface LlmDriverOpts {
  /** Bridge base URL, e.g. http://localhost:8787. Empty = driver unavailable. */
  bridgeUrl: string;
  fetch?: typeof fetch;
  usage?: UsageStore;
  /** Chat lines addressed to this agent (newest last). */
  chatLines?: (agentId: string) => string[];
  timeoutMs?: number;
  now?: () => number;
}

const trimUrl = (u: string) => u.replace(/\/+$/, '');

/** Is a bridge answering? Never throws. */
export async function probeBridge(url: string, f: typeof fetch = fetch, timeoutMs = 1500): Promise<boolean> {
  if (!url) return false;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await f(`${trimUrl(url)}/health`, { signal: ctl.signal });
    return r.ok;
  } catch { return false; } finally { clearTimeout(t); }
}

export function createLlmDriver(o: LlmDriverOpts): AgentDriver {
  const f = o.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const usage = o.usage ?? usageStore;
  const now = o.now ?? Date.now;
  let ctx: AgentContext | null = null;
  let stopped = false;

  async function call(c: AgentContext, task: Task, repair?: string): Promise<{ reply: BridgeReply; usage?: unknown }> {
    const perception = buildPerception(c.board, { me: c.me, task, chatLines: o.chatLines?.(c.me.id) ?? [task.text] });
    const ctl = new AbortController();
    const onAbort = () => ctl.abort();
    c.signal.addEventListener('abort', onAbort);
    const timer = setTimeout(() => ctl.abort(), o.timeoutMs ?? 120_000);
    try {
      const res = await f(`${trimUrl(o.bridgeUrl)}/task`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: ctl.signal,
        body: JSON.stringify({ v: PROTOCOL_VERSION, agent: { id: c.me.id, name: c.me.name, role: c.me.role }, task: perception.task, perception, ...(repair ? { repair } : {}) }),
      });
      if (!res.ok) return { reply: { ok: false, error: `bridge returned HTTP ${res.status}` } };
      const text = await res.text();
      if (text.length > MAX_RESPONSE_BYTES) return { reply: { ok: false, error: 'bridge reply too large' } };
      let json: unknown;
      try { json = JSON.parse(text); } catch { return { reply: { ok: false, error: 'bridge reply is not JSON' } }; }
      return { reply: validateReply(json), usage: isObj(json) ? json.usage : undefined };
    } finally {
      clearTimeout(timer);
      c.signal.removeEventListener('abort', onAbort);
    }
  }

  return {
    kind: 'llm',
    async start(c) { ctx = c; stopped = false; },
    stop() { stopped = true; },
    async onTask(task) {
      const c = ctx;
      if (!c) return;
      c.setState('thinking', 'asking the bridge');
      const t0 = now();
      let repair: string | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        let out: { reply: BridgeReply; usage?: unknown };
        try {
          out = await call(c, task, repair);
        } catch {
          usage.record(c.me.id, undefined, { label: task.text, ms: now() - t0, ok: false });
          if (c.signal.aborted || stopped) return;    // clean cancel
          c.say('LLM bridge offline. Start the local bridge or switch me back to the scripted driver.');
          c.setState('idle', 'bridge offline');
          return;
        }
        const { reply } = out;
        usage.record(c.me.id, out.usage, { label: task.text, ms: now() - t0, ok: reply.ok });
        if (c.signal.aborted || stopped) return;
        if (!reply.ok) {
          if (attempt === 0 && !reply.error.startsWith('bridge error') && !reply.error.startsWith('bridge returned')) { repair = reply.error; continue; }
          c.say(`I could not do that: ${reply.error}`);
          c.setState('error', reply.error.slice(0, 80));
          return;
        }
        if (reply.say) c.say(reply.say);
        if (reply.commands.length) {
          c.setState('drawing', 'applying changes');
          const res = c.board.exec({ actor: c.me.id, opId: opId(c.me.id), commands: reply.commands, atomic: true, label: `${c.me.name}: ${task.text.slice(0, 40)}` });
          const fail = res.results.find((r) => !r.ok);
          if (!res.ok || fail) c.say(`The board rejected my changes: ${fail && !fail.ok ? fail.message : 'unknown error'}`);
        }
        c.setState('idle');
        return;
      }
    },
  };
}
