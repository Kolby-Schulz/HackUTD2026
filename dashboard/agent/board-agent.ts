// The design board's agent process: a Nemotron orchestrator and a team of Claude designers on the live board.
// Everything is a SpacetimeDB client action: each agent joins the board (an `agent` row), people's chat arrives
// through board_message, and every layer is drawn step by step as ops through push_ops, so every viewer watches
// all the designers build in parallel. Model calls go through packages/llm, with tokens logged as `design`.
//
// A request goes to the orchestrator (Nemotron), which reads the conversation and a summary of the board and splits
// the work into up to TEAM_SIZE briefs. Each brief goes to its own Claude designer; all of them run at once, each in
// a spot reserved on the board before drawing starts.
//
// Run: npm run board-agent -w @contract/dashboard   (reads SPACETIME_HOST / SPACETIME_DB_NAME / NVIDIA_* from .env)
import { ClaudeCodeLLM, NemotronLLM } from '@contract/llm';
import type { LLM, Usage } from '@contract/llm';
import { keysBetween, between } from '../src/playground/core/order';
import { newId } from '../src/playground/core/ids';
import { createDocStore } from '../src/playground/core/store';
import type { ActorId, Op, Shape, ShapeId } from '../src/playground/core/types';
import { createPresenceBus } from '../src/playground/presence/bus';
import { connectBoard } from '../src/playground/net/session';
import type { LocalActor } from '../src/playground/net/session';
import { connectSpacetime } from '../src/playground/net/spacetime';
import type { BoardMessageRow } from '../src/playground/net/types';

const BOARD = 'playground';
const TEAM_SIZE = 10;
/** Designers use a fast model by default; override with BOARD_DESIGN_MODEL. Nemo (planning) is unchanged. */
const DESIGN_MODEL = process.env.BOARD_DESIGN_MODEL || 'claude-sonnet-5-5';
/** A designer's model call is stopped after this long, so one slow call never holds up the rest. */
const DESIGN_TIMEOUT_MS = 180_000;
const host = process.env.SPACETIME_HOST;
const database = process.env.SPACETIME_DB_NAME;
if (!host || !database) throw new Error('SPACETIME_HOST and SPACETIME_DB_NAME must be set (.env)');

const run = newId('').slice(-5);
const COLORS = ['#d97757', '#6366f1', '#10b981', '#f59e0b', '#ec4899', '#0ea5e9', '#8b5cf6', '#ef4444', '#14b8a6', '#84cc16'];
const ORCH: LocalActor = { id: `agent-nemo-${run}`, kind: 'agent', name: 'Nemo', color: '#76b900', agentId: `agent-nemo-${run}` };
const TEAM: LocalActor[] = Array.from({ length: TEAM_SIZE }, (_, i) => ({
  id: `agent-claude${i + 1}-${run}`, kind: 'agent', name: `Claude ${i + 1}`, color: COLORS[i], agentId: `agent-claude${i + 1}-${run}`,
}));

const nemo: LLM = new NemotronLLM();
const claude: LLM = new ClaudeCodeLLM();
const doc = createDocStore({ boardId: BOARD });
const bus = createPresenceBus({ schedule: (f) => { setTimeout(f, 16); } });
const net = connectSpacetime({ uri: host, database, boardId: BOARD, boardName: 'Design board' });
connectBoard({ boardId: BOARD, doc, presence: bus, transport: net, actors: [ORCH, ...TEAM], onError: (e) => console.error('[board-agent] sync', e) });

const logUsage = (agentId: string) => (u: Usage) =>
  net.logTokens({ agentId, promptTokens: u.prompt_tokens, completionTokens: u.completion_tokens, costUsd: u.cost_usd })
    .catch((e: unknown) => console.error('[board-agent] log_tokens', e));

// ---- what the models see: the conversation and the board ----
const history: { who: string; text: string }[] = [];
const remember = (who: string, text: string) => { history.push({ who, text }); if (history.length > 30) history.shift(); };

/** The board as text: each screen (top-level frame) with the words on it, newest last. */
function boardSummary(): string {
  const st = doc.getState();
  const frames = (st.children.get(null) ?? []).map((id) => st.shapes.get(id)).filter((s): s is Shape => !!s && !s.deleted && s.kind === 'frame');
  if (!frames.length) return '(the board is empty)';
  return frames.slice(-15).map((f) => {
    const words = (st.children.get(f.id) ?? []).map((id) => st.shapes.get(id)).filter((s) => s && !s.deleted && s.kind === 'text' && s.text).map((s) => s!.text).join(' | ');
    return `- "${f.name}" (${Math.round(f.w)}x${Math.round(f.h)}, by ${f.author ?? f.createdBy}): ${words.slice(0, 300)}`;
  }).join('\n');
}
const context = () => `Conversation so far:\n${history.map((h) => `${h.who}: ${h.text}`).join('\n') || '(none)'}\n\nScreens on the board now:\n${boardSummary()}`;

// ---- orchestrator: split a request into briefs ----
interface Plan { reply: string; briefs: { title: string; brief: string }[] }
const PLAN_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['reply', 'briefs'],
  properties: {
    reply: { type: 'string', description: 'One short sentence to the person: what the team will make.' },
    briefs: {
      type: 'array', minItems: 1, maxItems: TEAM_SIZE,
      items: { type: 'object', additionalProperties: false, required: ['title', 'brief'], properties: { title: { type: 'string' }, brief: { type: 'string' } } },
    },
  },
} as const;
const PLAN_SYSTEM = `You are the orchestrator of a team of up to ${TEAM_SIZE} UI designers on a shared design board. Read the
conversation and the screens already on the board, work out what the person wants now, and split it into one brief
per screen, each for a different designer working in parallel. Follow-ups refer to earlier work: "3 more" means three
more screens like the most recent ones (same product, new screens or variations), not something unrelated. Make
exactly as many briefs as screens asked for (default 1, never more than ${TEAM_SIZE}). Each brief must stand alone:
name the product, the screen, its content, and the visual style to match (colours and layout of the existing screens).`;

// ---- designer: one screen ----
interface El {
  kind: 'rect' | 'ellipse' | 'text'; name: string; x: number; y: number; w: number; h: number;
  fill?: string; radius?: number; stroke?: string; strokeWidth?: number; shadow?: boolean; opacity?: number;
  text?: string; fontSize?: number; fontWeight?: number; color?: string; align?: 'left' | 'center' | 'right'; valign?: 'top' | 'middle' | 'bottom'; lineHeight?: number;
}
interface Design { frame: { name: string; w: number; h: number; fill: string }; elements: El[] }
const DESIGN_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['frame', 'elements'],
  properties: {
    frame: {
      type: 'object', additionalProperties: false, required: ['name', 'w', 'h', 'fill'],
      properties: { name: { type: 'string' }, w: { type: 'number' }, h: { type: 'number' }, fill: { type: 'string', description: 'hex colour' } },
    },
    elements: {
      type: 'array', maxItems: 80,
      items: {
        type: 'object', additionalProperties: false, required: ['kind', 'name', 'x', 'y', 'w', 'h'],
        properties: {
          kind: { enum: ['rect', 'ellipse', 'text'] }, name: { type: 'string' },
          x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' },
          fill: { type: 'string', description: 'hex colour (rect, ellipse)' }, radius: { type: 'number', description: 'corner radius (rect)' },
          stroke: { type: 'string', description: 'hex border colour' }, strokeWidth: { type: 'number' },
          shadow: { type: 'boolean', description: 'soft drop shadow, for raised cards and buttons' }, opacity: { type: 'number', description: '0 to 1' },
          text: { type: 'string' }, fontSize: { type: 'number' }, fontWeight: { type: 'number', description: '400, 500, 600 or 700' },
          color: { type: 'string', description: 'hex text colour' }, lineHeight: { type: 'number', description: 'multiple of fontSize, e.g. 1.3' },
          align: { enum: ['left', 'center', 'right'] }, valign: { enum: ['top', 'middle', 'bottom'] },
        },
      },
    },
  },
} as const;
const DESIGN_SYSTEM = `You are a senior product designer on a shared design board. Design exactly the screen in your brief as
one frame and the layers inside it, polished enough to ship.

Canvas: coordinates are relative to the frame's top-left corner, in pixels; keep every layer inside the frame. Use a
mobile frame (390 x 844) unless the brief says otherwise. Order layers back to front (backgrounds and cards first,
then the shapes and text on them). Up to 80 layers; use them for detail.

Craft rules:
- Spacing on an 8 px grid; 20-24 px side margins; consistent gaps between sections.
- Type scale: 28-34 bold for the title, 17-20 semibold for section heads, 15-16 regular for body, 12-13 for captions.
  lineHeight 1.2 for headings, 1.4 for body. Size each text box to fit its text (about 0.55 x fontSize per character).
- Colour: one brand colour plus neutrals, at most one accent. Body text at least 4.5:1 contrast on its background.
- Buttons and chips: a rect with radius, the label as a text layer of the same box with align center, valign middle.
- Cards: white or tinted rect with radius 12-20, shadow true, or a 1 px stroke on a light background.
- No grey placeholder boxes. Picture areas get a tinted rect with a simple illustration built from ellipses and rects
  (for a pet, a face: head, ears, eyes, nose). Icons are small compositions of shapes, never empty circles.
- Real, specific copy for every label, name and number. No emoji, no lorem ipsum.`;

// ---- drawing, step by step, one cursor per agent ----
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);
const cursors = new Map<ActorId, { x: number; y: number }>();
const status = (a: LocalActor, state: 'idle' | 'thinking' | 'drawing', detail = '') => {
  const c = cursors.get(a.id) ?? { x: 0, y: 0 };
  bus.publish({ actor: a.id, state, detail, x: c.x, y: c.y });
};
async function glide(a: LocalActor, x: number, y: number, ms: number) {
  const from = cursors.get(a.id) ?? { x, y }, steps = Math.max(1, Math.round(ms / 50));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, e = t * t * (3 - 2 * t);
    const c = { x: from.x + (x - from.x) * e, y: from.y + (y - from.y) * e };
    cursors.set(a.id, c);
    bus.publish({ actor: a.id, x: c.x, y: c.y });
    await sleep(50);
  }
}
const put = (a: LocalActor, label: string, ops: Op[]) => doc.dispatch(a.id, label, ops);

async function grow(a: LocalActor, id: ShapeId, x: number, y: number, w: number, h: number, steps: number) {
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, e = 1 - (1 - t) ** 3;
    put(a, 'Draw', [{ t: 'set', id, patch: { w: Math.max(1, w * e), h: Math.max(1, h * e) } }]);
    await glide(a, x + w * e, y + h * e, 30);
  }
}

/** Reserve `n` spots in a new row below everything on the board, so parallel designers never overlap. */
function reserveRow(n: number): { x: number; y: number }[] {
  let bottom = -Infinity, left = Infinity;
  for (const s of doc.getState().shapes.values()) {
    if (s.deleted || s.parent !== null) continue;
    bottom = Math.max(bottom, s.y + s.h);
    left = Math.min(left, s.x);
  }
  const y = bottom === -Infinity ? 0 : bottom + 160;
  const x0 = left === Infinity ? 0 : left;
  return Array.from({ length: n }, (_, i) => ({ x: x0 + i * 480, y }));
}

async function draw(a: LocalActor, d: Design, at: { x: number; y: number }, index: string) {
  const frameId = newId('s');
  const fw = clamp(d.frame.w, 200, 1600), fh = clamp(d.frame.h, 200, 1600);
  status(a, 'drawing', `frame ${d.frame.name}`.slice(0, 40));
  await glide(a, at.x, at.y, 200);
  put(a, 'Draw frame', [{ t: 'create', shape: {
    id: frameId, kind: 'frame', name: d.frame.name, x: at.x, y: at.y, w: 1, h: 1, clip: true,
    fills: [{ type: 'solid', color: d.frame.fill || '#ffffff' }], parent: null, index, createdBy: a.id, author: a.id,
  } }]);
  await grow(a, frameId, at.x, at.y, fw, fh, 6);
  const keys = keysBetween(d.elements.length);
  for (const [i, el] of d.elements.entries()) {
    const x = clamp(el.x, 0, fw - 1), y = clamp(el.y, 0, fh - 1);
    const w = clamp(el.w, 1, fw - x), h = clamp(el.h, 1, fh - y);
    const id = newId('s');
    status(a, 'drawing', `${el.kind === 'text' ? 'typing' : 'drawing'} ${el.name}`.slice(0, 40));
    await glide(a, at.x + x, at.y + y, 80);
    if (el.kind === 'text') {
      const text = el.text ?? el.name;
      put(a, 'Add text', [{ t: 'create', shape: {
        id, kind: 'text', name: el.name, x, y, w, h, fills: [], text: '', textMode: 'fixed',
        fontSize: clamp(el.fontSize ?? 16, 8, 96), fontWeight: el.fontWeight ?? 400, color: el.color ?? '#111111',
        textAlign: el.align ?? 'left', textVAlign: el.valign ?? 'top', ...(el.lineHeight ? { lineHeight: clamp(el.lineHeight, 0.8, 3) * clamp(el.fontSize ?? 16, 8, 96) } : {}),
        ...(el.opacity !== undefined ? { opacity: clamp(el.opacity, 0, 1) } : {}),
        parent: frameId, index: keys[i], createdBy: a.id, author: a.id,
      } }]);
      const step = Math.max(1, Math.ceil(text.length / 4));
      for (let n = step; n < text.length + step; n += step) { put(a, 'Type', [{ t: 'set', id, patch: { text: text.slice(0, n) } }]); await sleep(25); }
    } else {
      put(a, 'Draw', [{ t: 'create', shape: {
        id, kind: el.kind, name: el.name, x, y, w: 1, h: 1, radius: el.radius ?? 0,
        fills: [{ type: 'solid', color: el.fill ?? '#e5e7eb' }],
        ...(el.stroke ? { strokes: [{ color: el.stroke, width: clamp(el.strokeWidth ?? 1, 0.5, 8), align: 'inside' as const }] } : {}),
        ...(el.shadow ? { effects: [{ type: 'drop' as const, x: 0, y: 4, blur: 16, color: 'rgba(15, 23, 42, 0.10)' }] } : {}),
        ...(el.opacity !== undefined ? { opacity: clamp(el.opacity, 0, 1) } : {}),
        parent: frameId, index: keys[i], createdBy: a.id, author: a.id,
      } }]);
      await grow(a, id, at.x + x, at.y + y, w, h, 3);
    }
  }
  status(a, 'idle');
}

/** One designer's model call: the fast model, a time limit, and one retry if the first answer fails. */
async function design(a: LocalActor, prompt: string): Promise<Design> {
  const once = async () => (await claude.decide<Design>(prompt, DESIGN_SCHEMA as unknown as Record<string, unknown>, {
    purpose: 'design', model: DESIGN_MODEL, system: DESIGN_SYSTEM, onUsage: logUsage(a.id), signal: AbortSignal.timeout(DESIGN_TIMEOUT_MS),
  })).output;
  try { return await once(); }
  catch (e) {
    console.error(`[board-agent] ${a.name} retrying after: ${e instanceof Error ? e.message : String(e)}`);
    status(a, 'thinking', 'retrying');
    return once();
  }
}

// ---- requests ----
function post(from: LocalActor, to: BoardMessageRow, body: string) {
  remember(from.name, body);
  return net.postMessage({ id: newId('m'), boardId: BOARD, threadId: to.threadId, kind: 'chat', author: from.id, toActor: to.author, body: body.slice(0, 4000) })
    .catch((e: unknown) => console.error('[board-agent] post', e));
}

async function handle(m: BoardMessageRow) {
  console.log(`[board-agent] request: ${m.body}`);
  remember('Person', m.body);
  status(ORCH, 'thinking', 'planning');
  let plan: Plan;
  try {
    plan = (await nemo.decide<Plan>(`${context()}\n\nNew request from the person: ${m.body}`, PLAN_SCHEMA as unknown as Record<string, unknown>,
      { purpose: 'design', system: PLAN_SYSTEM, onUsage: logUsage(ORCH.id) })).output;
  } catch (e) {
    status(ORCH, 'idle');
    await post(ORCH, m, `Sorry, I couldn't plan that: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300));
    return;
  }
  const briefs = plan.briefs.slice(0, TEAM_SIZE);
  await post(ORCH, m, `${plan.reply} (${briefs.length} designer${briefs.length > 1 ? 's' : ''} on it)`);
  status(ORCH, 'idle');
  console.log(`[board-agent] ${briefs.length} briefs: ${briefs.map((b) => b.title).join(' · ')}`);

  // reserve spots and z-order up front, then every designer works at once
  const spots = reserveRow(briefs.length);
  const st = doc.getState();
  const top = st.children.get(null) ?? [];
  const lastTop = top.length ? st.shapes.get(top[top.length - 1])?.index ?? null : null;
  const indexes = keysBetween(briefs.length, lastTop, null);
  const ctx = context();
  await Promise.all(briefs.map(async (b, i) => {
    const a = TEAM[i];
    status(a, 'thinking', `designing ${b.title}`.slice(0, 40));
    await glide(a, spots[i].x + 180, spots[i].y + 200, 300);
    try {
      const t0 = Date.now();
      const output = await design(a, `${ctx}\n\nYour brief: ${b.title}. ${b.brief}`);
      console.log(`[board-agent] ${a.name} designed "${output.frame.name}" (${output.elements.length} layers) in ${Math.round((Date.now() - t0) / 1000)} s`);
      const t1 = Date.now();
      await draw(a, output, spots[i], indexes[i]);
      console.log(`[board-agent] ${a.name} drew it in ${Math.round((Date.now() - t1) / 1000)} s`);
      remember(a.name, `designed "${output.frame.name}"`);
    } catch (e) {
      status(a, 'idle');
      await post(a, m, `I couldn't finish "${b.title}": ${e instanceof Error ? e.message : String(e)}`.slice(0, 300));
    }
  }));
  await post(ORCH, m, `Done: ${briefs.map((b) => b.title).join(', ')}.`);
}

const queue: BoardMessageRow[] = [];
const seen = new Set<string>();
let busy = false;
let live = false;
async function work() {
  if (busy) return;
  busy = true;
  try { for (let m = queue.shift(); m; m = queue.shift()) await handle(m); } finally { busy = false; }
}

net.onSynced(() => {
  if (!live) console.log(`[board-agent] Nemo + ${TEAM_SIZE} Claude designers are on board '${BOARD}'`);
  live = true;
  for (const a of [ORCH, ...TEAM]) status(a, 'idle');
});
net.onMessages((c) => {
  for (const m of c.added) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    if (m.kind !== 'chat') continue;
    if (!live) { remember(m.author.startsWith('human-') ? 'Person' : 'Agent', m.body); continue; }   // earlier conversation
    if (!m.author.startsWith('human-')) continue;
    queue.push(m);
  }
  void work();
});
setInterval(() => { if (live) for (const a of [ORCH, ...TEAM]) net.heartbeat(a.id).catch(() => {}); }, 20_000);
