// The design board's agent process: a real model-driven agent on the live board.
// It is a SpacetimeDB client like a browser tab: it joins the board as an agent (an `agent` row), reads chat from
// board_message, asks the model for a design through packages/llm (tokens logged with purpose `design`), and draws it
// step by step through the same session as people, so every viewer watches the layers grow.
//
// Run: npm run board-agent -w @contract/dashboard   (reads SPACETIME_HOST / SPACETIME_DB_NAME from the root .env)
import { createLLM } from '@contract/llm';
import { keysBetween, between } from '../src/playground/core/order';
import { newId } from '../src/playground/core/ids';
import { createDocStore } from '../src/playground/core/store';
import type { Op, Shape, ShapeId } from '../src/playground/core/types';
import { createPresenceBus } from '../src/playground/presence/bus';
import { connectBoard } from '../src/playground/net/session';
import { connectSpacetime } from '../src/playground/net/spacetime';
import type { BoardMessageRow } from '../src/playground/net/types';

const BOARD = 'playground';
const host = process.env.SPACETIME_HOST;
const database = process.env.SPACETIME_DB_NAME;
if (!host || !database) throw new Error('SPACETIME_HOST and SPACETIME_DB_NAME must be set (root .env)');

const AGENT = { id: `agent-claude-${newId('').slice(-6)}`, kind: 'agent' as const, name: 'Claude', color: '#d97757' };
const llm = createLLM();
const doc = createDocStore({ boardId: BOARD });
const bus = createPresenceBus({ schedule: (f) => { setTimeout(f, 16); } });
const net = connectSpacetime({ uri: host, database, boardId: BOARD, boardName: 'Design board' });
connectBoard({
  boardId: BOARD, doc, presence: bus, transport: net,
  actors: [{ ...AGENT, agentId: AGENT.id }],
  onError: (e) => console.error('[board-agent] sync', e),
});

// ---- the design the model returns ----
interface El { kind: 'rect' | 'ellipse' | 'text'; name: string; x: number; y: number; w: number; h: number; fill?: string; radius?: number; text?: string; fontSize?: number; fontWeight?: number; color?: string }
interface Design { reply: string; frame: { name: string; w: number; h: number; fill: string }; elements: El[] }

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['reply', 'frame', 'elements'],
  properties: {
    reply: { type: 'string', description: 'One short sentence to the person about what you designed.' },
    frame: {
      type: 'object', additionalProperties: false, required: ['name', 'w', 'h', 'fill'],
      properties: { name: { type: 'string' }, w: { type: 'number' }, h: { type: 'number' }, fill: { type: 'string', description: 'hex colour' } },
    },
    elements: {
      type: 'array', maxItems: 40,
      items: {
        type: 'object', additionalProperties: false, required: ['kind', 'name', 'x', 'y', 'w', 'h'],
        properties: {
          kind: { enum: ['rect', 'ellipse', 'text'] }, name: { type: 'string' },
          x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' },
          fill: { type: 'string', description: 'hex colour (rect, ellipse)' }, radius: { type: 'number' },
          text: { type: 'string' }, fontSize: { type: 'number' }, fontWeight: { type: 'number' }, color: { type: 'string', description: 'hex text colour' },
        },
      },
    },
  },
} as const;

const SYSTEM = `You are a UI designer working on a shared design board. Answer with one screen as a frame and the layers
inside it. Coordinates are relative to the frame's top-left corner, in pixels; keep every layer inside the frame.
Use a mobile frame (390 x 844) unless the request says otherwise. Build a real, readable layout: a header, content
and controls, with text layers for every label (fontSize 12-32). Use a small, consistent palette. Order layers
back to front (backgrounds and cards before the text on them). At most 40 layers.`;

// ---- drawing, step by step ----
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let cursor = { x: 0, y: 0 };
const say = (state: 'idle' | 'thinking' | 'drawing', detail = '') => bus.publish({ actor: AGENT.id, state, detail, x: cursor.x, y: cursor.y });

async function glide(x: number, y: number, ms = 300) {
  const from = cursor, steps = Math.max(1, Math.round(ms / 50));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, e = t * t * (3 - 2 * t);
    cursor = { x: from.x + (x - from.x) * e, y: from.y + (y - from.y) * e };
    bus.publish({ actor: AGENT.id, x: cursor.x, y: cursor.y });
    await sleep(50);
  }
}
const put = (label: string, ops: Op[]) => doc.dispatch(AGENT.id, label, ops);

/** Free space to the right of everything on the board. */
function freeSpot(): { x: number; y: number } {
  let right = -Infinity, top = 0;
  for (const s of doc.getState().shapes.values()) {
    if (s.deleted || s.parent !== null) continue;
    if (s.x + s.w > right) { right = s.x + s.w; top = s.y; }
  }
  return right === -Infinity ? { x: 0, y: 0 } : { x: right + 120, y: top };
}

async function grow(id: ShapeId, x: number, y: number, w: number, h: number, steps: number) {
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, e = 1 - (1 - t) ** 3;
    put('Draw', [{ t: 'set', id, patch: { w: Math.max(1, w * e), h: Math.max(1, h * e) } }]);
    await glide(x + w * e, y + h * e, 60);
  }
}

async function draw(d: Design) {
  const st = doc.getState();
  const top = st.children.get(null) ?? [];
  const lastTop = top.length ? st.shapes.get(top[top.length - 1])?.index ?? null : null;
  const at = freeSpot();
  const frameId = newId('s');
  const fw = clamp(d.frame.w, 200, 1600), fh = clamp(d.frame.h, 200, 1600);
  say('drawing', `frame ${d.frame.name}`);
  await glide(at.x, at.y, 500);
  const frame: Omit<Shape, 'stamps' | 'deleted'> = {
    id: frameId, kind: 'frame', name: d.frame.name, x: at.x, y: at.y, w: 1, h: 1, clip: true,
    fills: [{ type: 'solid', color: d.frame.fill || '#ffffff' }], parent: null, index: between(lastTop, null), createdBy: AGENT.id, author: AGENT.id,
  };
  put('Draw frame', [{ t: 'create', shape: frame }]);
  await grow(frameId, at.x, at.y, fw, fh, 10);

  const keys = keysBetween(d.elements.length);
  for (const [i, el] of d.elements.entries()) {
    const x = clamp(el.x, 0, fw - 1), y = clamp(el.y, 0, fh - 1);
    const w = clamp(el.w, 1, fw - x), h = clamp(el.h, 1, fh - y);
    const id = newId('s');
    say('drawing', `${el.kind === 'text' ? 'typing' : 'drawing'} ${el.name}`.slice(0, 40));
    await glide(at.x + x, at.y + y, 220);
    if (el.kind === 'text') {
      const text = el.text ?? el.name;
      put('Add text', [{ t: 'create', shape: {
        id, kind: 'text', name: el.name, x, y, w, h, fills: [], text: '', textMode: 'fixed',
        fontSize: clamp(el.fontSize ?? 16, 8, 96), fontWeight: el.fontWeight ?? 400, color: el.color ?? '#111111',
        parent: frameId, index: keys[i], createdBy: AGENT.id, author: AGENT.id,
      } }]);
      // type it out a few characters at a time
      const step = Math.max(1, Math.ceil(text.length / 8));
      for (let n = step; n < text.length + step; n += step) {
        put('Type', [{ t: 'set', id, patch: { text: text.slice(0, n) } }]);
        await sleep(45);
      }
    } else {
      put('Draw', [{ t: 'create', shape: {
        id, kind: el.kind, name: el.name, x, y, w: 1, h: 1, radius: el.radius ?? 0,
        fills: [{ type: 'solid', color: el.fill ?? '#e5e7eb' }], parent: frameId, index: keys[i], createdBy: AGENT.id, author: AGENT.id,
      } }]);
      await grow(id, at.x + x, at.y + y, w, h, 5);
    }
  }
}
const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);

// ---- requests from chat ----
const queue: BoardMessageRow[] = [];
const seen = new Set<string>();
let busy = false;
let live = false;

function reply(to: BoardMessageRow, body: string) {
  return net.postMessage({ id: newId('m'), boardId: BOARD, threadId: to.threadId, kind: 'chat', author: AGENT.id, toActor: to.author, body: body.slice(0, 4000) });
}

async function work() {
  if (busy) return;
  busy = true;
  try {
    for (let m = queue.shift(); m; m = queue.shift()) {
      console.log(`[board-agent] request from ${m.author}: ${m.body}`);
      await reply(m, `On it: ${m.body}`);
      say('thinking', 'designing');
      try {
        const { output } = await llm.decide<Design>(`Design request: ${m.body}`, SCHEMA as unknown as Record<string, unknown>, {
          purpose: 'design', system: SYSTEM,
          onUsage: (u) => net.logTokens({ agentId: AGENT.id, promptTokens: u.prompt_tokens, completionTokens: u.completion_tokens, costUsd: u.cost_usd })
            .catch((e: unknown) => console.error('[board-agent] log_tokens', e)),
        });
        await draw(output);
        await reply(m, output.reply);
      } catch (e) {
        console.error('[board-agent] request failed', e);
        await reply(m, `Sorry, that failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300));
      }
      say('idle');
    }
  } finally { busy = false; }
}

net.onSynced(() => { live = true; say('idle'); console.log(`[board-agent] ${AGENT.name} (${AGENT.id}) is on board '${BOARD}'`); });
net.onMessages((c) => {
  for (const m of c.added) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    // history from before this process started is not a request; only new chat from people is
    if (!live || m.kind !== 'chat' || !m.author.startsWith('human-')) continue;
    if (m.toActor && m.toActor !== AGENT.id) continue;
    queue.push(m);
  }
  void work();
});
setInterval(() => { if (live) net.heartbeat(AGENT.id).catch(() => {}); }, 20_000);
