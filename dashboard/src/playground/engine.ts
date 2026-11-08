// Playground engine: cursors, their motion, and scripted "agent" designers.
// Pure TS (no React) so anything can drive a cursor: the demo agents below, the human
// pointer, or window.board from the console / a future SpacetimeDB subscription.
import type { Dispatch, SetStateAction } from 'react';

export type Kind = 'frame' | 'rect' | 'ellipse' | 'text';

export type Shape = {
  id: string;
  kind: Kind;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
  color?: string; // text color
  text?: string;
  fontSize?: number;
  weight?: number;
  radius?: number;
  owner?: string; // cursor id currently editing it (multiplayer outline)
};

export type CursorKind = 'human' | 'agent' | 'api';
export type CursorMeta = { id: string; name: string; color: string; kind: CursorKind; status: string; paused: boolean };

type Anim = {
  fx: number; fy: number; tx: number; ty: number;
  t0: number; dur: number; bend: number;
  step?: (x: number, y: number) => void;
  resolve: () => void;
  reject: (e: unknown) => void;
};
type Pos = { id: string; x: number; y: number; down: boolean; paused: boolean; human: boolean; anim: Anim | null };
type Token = { alive: boolean; paused: boolean };

export const CANCEL = Symbol('cancel');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
let idc = 0;
export const uid = (p = 's') => `${p}${(++idc).toString(36)}`;

export const NAMES = ['Iris', 'Juno', 'Milo', 'Nova', 'Otto', 'Pia', 'Rex', 'Sol', 'Tess', 'Vik', 'Wren', 'Zed'];
export const COLORS = ['#f24e1e', '#a259ff', '#14ae5c', '#ff7262', '#0fa5e9', '#e8a700', '#ec4899', '#6366f1', '#10b981', '#f97316', '#8b5cf6', '#06b6d4'];

// ---- design templates: what an agent "draws". 'A' = agent accent, 'a' = soft accent ----
type El = { kind: Kind; name: string; x: number; y: number; w: number; h: number; fill?: string; text?: string; fontSize?: number; weight?: number; radius?: number; color?: string };
type Tpl = { name: string; w: number; h: number; radius?: number; children: El[] };

const INK = '#1c1917', MUTED = '#78716c', LINE = '#e7e5e0', WASH = '#f4f2ec';

const TEMPLATES: Tpl[] = [
  {
    name: 'Profile card', w: 320, h: 400, radius: 16,
    children: [
      { kind: 'ellipse', name: 'Avatar', x: 24, y: 24, w: 64, h: 64, fill: 'a' },
      { kind: 'text', name: 'Name', x: 104, y: 32, w: 190, h: 24, text: 'Ada Lovelace', fontSize: 18, weight: 600 },
      { kind: 'text', name: 'Role', x: 104, y: 60, w: 190, h: 18, text: 'Product designer', fontSize: 13, color: MUTED },
      { kind: 'rect', name: 'Cover', x: 24, y: 108, w: 272, h: 132, fill: WASH, radius: 10 },
      { kind: 'rect', name: 'Line', x: 24, y: 262, w: 272, h: 10, fill: LINE, radius: 5 },
      { kind: 'rect', name: 'Line', x: 24, y: 282, w: 216, h: 10, fill: LINE, radius: 5 },
      { kind: 'rect', name: 'Line', x: 24, y: 302, w: 168, h: 10, fill: LINE, radius: 5 },
      { kind: 'rect', name: 'Button', x: 24, y: 336, w: 128, h: 40, fill: 'A', radius: 20 },
      { kind: 'text', name: 'Label', x: 64, y: 347, w: 80, h: 18, text: 'Follow', fontSize: 14, weight: 600, color: '#fff' },
    ],
  },
  {
    name: 'Mobile · Tasks', w: 280, h: 520, radius: 28,
    children: [
      { kind: 'text', name: 'Title', x: 24, y: 40, w: 200, h: 32, text: 'Today', fontSize: 26, weight: 700 },
      { kind: 'text', name: 'Subtitle', x: 24, y: 78, w: 200, h: 18, text: '3 tasks left', fontSize: 13, color: MUTED },
      ...[0, 1, 2].flatMap((i): El[] => [
        { kind: 'rect', name: 'Row', x: 16, y: 120 + i * 76, w: 248, h: 64, fill: WASH, radius: 14 },
        { kind: 'ellipse', name: 'Icon', x: 28, y: 134 + i * 76, w: 36, h: 36, fill: 'a' },
        { kind: 'rect', name: 'Row title', x: 78, y: 142 + i * 76, w: 140 - i * 20, h: 10, fill: '#d6d3cd', radius: 5 },
        { kind: 'rect', name: 'Row meta', x: 78, y: 160 + i * 76, w: 84, h: 8, fill: LINE, radius: 4 },
      ]),
      { kind: 'rect', name: 'Tab bar', x: 16, y: 452, w: 248, h: 52, fill: INK, radius: 26 },
      { kind: 'ellipse', name: 'Tab', x: 132, y: 470, w: 16, h: 16, fill: 'A' },
    ],
  },
  {
    name: 'Stat widget', w: 360, h: 230, radius: 16,
    children: [
      { kind: 'text', name: 'Label', x: 24, y: 22, w: 200, h: 18, text: 'Weekly revenue', fontSize: 13, color: MUTED },
      { kind: 'text', name: 'Value', x: 24, y: 42, w: 200, h: 40, text: '$48.2k', fontSize: 32, weight: 700 },
      { kind: 'rect', name: 'Pill', x: 252, y: 26, w: 84, h: 26, fill: 'a', radius: 13 },
      { kind: 'text', name: 'Delta', x: 268, y: 31, w: 64, h: 16, text: '+12.4%', fontSize: 12, weight: 600, color: 'A' },
      ...[50, 78, 62, 104, 88, 124, 98].map((h, i): El => ({ kind: 'rect', name: `Bar ${i + 1}`, x: 24 + i * 46, y: 206 - h, w: 30, h, fill: i === 5 ? 'A' : 'a', radius: 6 })),
    ],
  },
  {
    name: 'Hero section', w: 440, h: 300, radius: 16,
    children: [
      { kind: 'rect', name: 'Logo', x: 24, y: 24, w: 28, h: 28, fill: 'A', radius: 8 },
      { kind: 'rect', name: 'Nav', x: 300, y: 33, w: 44, h: 10, fill: LINE, radius: 5 },
      { kind: 'rect', name: 'Nav', x: 356, y: 33, w: 60, h: 10, fill: LINE, radius: 5 },
      { kind: 'text', name: 'Headline', x: 24, y: 80, w: 380, h: 76, text: 'Design with a whole team of agents', fontSize: 30, weight: 700 },
      { kind: 'rect', name: 'Body', x: 24, y: 176, w: 300, h: 10, fill: LINE, radius: 5 },
      { kind: 'rect', name: 'Body', x: 24, y: 194, w: 236, h: 10, fill: LINE, radius: 5 },
      { kind: 'rect', name: 'CTA', x: 24, y: 230, w: 140, h: 44, fill: 'A', radius: 22 },
      { kind: 'text', name: 'CTA label', x: 50, y: 243, w: 110, h: 18, text: 'Get started', fontSize: 14, weight: 600, color: '#fff' },
      { kind: 'rect', name: 'Secondary', x: 176, y: 230, w: 124, h: 44, fill: WASH, radius: 22 },
      { kind: 'text', name: 'Secondary label', x: 199, y: 243, w: 90, h: 18, text: 'Learn more', fontSize: 14, weight: 500 },
    ],
  },
];

const COLS = 5, CELL_W = 500, CELL_H = 620, MAX_SLOTS = 30;

export type Engine = ReturnType<typeof createEngine>;

export function createEngine(h: {
  setShapes: Dispatch<SetStateAction<Shape[]>>;
  setCursors: Dispatch<SetStateAction<CursorMeta[]>>;
}) {
  const pos = new Map<string, Pos>();
  const tokens = new Map<string, Token>();
  const colors = new Map<string, string>();
  const slots = new Set<number>();
  const human = { x: 0, y: 0, visible: false };
  let speed = 1;
  let spawned = 0;
  let last = performance.now();

  const addShape = (s: Shape) => h.setShapes((ss) => [...ss, s]);
  const patch = (id: string, p: Partial<Shape>) => h.setShapes((ss) => ss.map((s) => (s.id === id ? { ...s, ...p } : s)));
  const setMeta = (id: string, p: Partial<CursorMeta>) => h.setCursors((cs) => cs.map((c) => (c.id === id ? { ...c, ...p } : c)));
  const status = (id: string, s: string) => setMeta(id, { status: s });

  function addCursor(meta: { id: string; name: string; color: string; kind: CursorKind; status?: string }, x = 0, y = 0) {
    pos.set(meta.id, { id: meta.id, x, y, down: false, paused: false, human: meta.kind === 'human', anim: null });
    colors.set(meta.id, meta.color);
    h.setCursors((cs) => [...cs.filter((c) => c.id !== meta.id), { status: 'idle', paused: false, ...meta }]);
    return meta.id;
  }

  function stopScript(id: string) {
    const t = tokens.get(id);
    if (t) t.alive = false;
    tokens.delete(id);
    const p = pos.get(id);
    if (p?.anim) { const a = p.anim; p.anim = null; a.reject(CANCEL); }
    if (p) p.down = false;
    h.setShapes((ss) => ss.map((s) => (s.owner === id ? { ...s, owner: undefined } : s)));
  }

  function removeCursor(id: string) {
    stopScript(id);
    pos.delete(id);
    h.setCursors((cs) => cs.filter((c) => c.id !== id));
  }

  /** Glide a cursor to world (x, y). Resolves on arrival; `step` fires every frame (used for drags). */
  function moveTo(id: string, x: number, y: number, o: { dur?: number; step?: (x: number, y: number) => void; straight?: boolean } = {}) {
    const p = pos.get(id);
    if (!p) return Promise.reject(CANCEL);
    if (p.anim) { const a = p.anim; p.anim = null; a.resolve(); }
    const dist = Math.hypot(x - p.x, y - p.y);
    const dur = (o.dur ?? clamp(200 + dist * 0.8, 200, 1100)) / speed;
    return new Promise<void>((resolve, reject) => {
      p.anim = { fx: p.x, fy: p.y, tx: x, ty: y, t0: performance.now(), dur, bend: o.straight ? 0 : (Math.random() - 0.5) * 0.3, step: o.step, resolve, reject };
    });
  }

  /** Called every animation frame by the board. */
  function tick(now: number) {
    const dt = now - last;
    last = now;
    for (const p of pos.values()) {
      const a = p.anim;
      if (!a) continue;
      if (p.paused) { a.t0 += dt; continue; }
      const t = clamp((now - a.t0) / a.dur, 0, 1);
      const e = ease(t);
      const dx = a.tx - a.fx, dy = a.ty - a.fy;
      const arc = Math.sin(Math.PI * e) * a.bend;
      p.x = a.fx + dx * e - dy * arc;
      p.y = a.fy + dy * e + dx * arc;
      a.step?.(p.x, p.y);
      if (t >= 1) { p.anim = null; a.resolve(); }
    }
  }

  // ---- scripted agents ----
  async function gate(tok: Token) {
    while (tok.paused && tok.alive) await sleep(80);
    if (!tok.alive) throw CANCEL;
  }
  async function wait(tok: Token, ms: number) {
    let left = ms / speed;
    while (left > 0) {
      if (!tok.alive) throw CANCEL;
      await sleep(Math.min(left, 40));
      if (!tok.paused) left -= 40;
    }
    if (!tok.alive) throw CANCEL;
  }
  const press = (id: string, down: boolean) => { const p = pos.get(id); if (p) p.down = down; };

  function claimSlot() {
    let k = 0;
    while (slots.has(k)) k++;
    if (k >= MAX_SLOTS) return -1;
    slots.add(k);
    return k;
  }

  async function drag(id: string, tok: Token, s: Shape, toX: number, toY: number) {
    await gate(tok);
    press(id, true);
    addShape({ ...s, w: 1, h: 1 });
    await moveTo(id, toX, toY, { straight: true, step: (x, y) => patch(s.id, { w: Math.max(1, x - s.x), h: Math.max(1, y - s.y) }) });
    patch(s.id, { w: toX - s.x, h: toY - s.y });
    press(id, false);
  }

  async function build(id: string, tok: Token, tpl: Tpl, ox: number, oy: number) {
    const color = colors.get(id) ?? '#000';
    const res = (f?: string) => (f === 'A' ? color : f === 'a' ? color + '29' : f);
    const frameId = uid('f');
    status(id, `framing ${tpl.name}`);
    await moveTo(id, ox, oy);
    await drag(id, tok, { id: frameId, kind: 'frame', name: tpl.name, x: ox, y: oy, w: tpl.w, h: tpl.h, fill: '#ffffff', radius: tpl.radius, owner: id }, ox + tpl.w, oy + tpl.h);

    for (const el of tpl.children) {
      await gate(tok);
      status(id, `${el.kind === 'text' ? 'typing' : 'drawing'} ${el.name.toLowerCase()}`);
      const sx = ox + el.x, sy = oy + el.y, sid = uid();
      if (el.kind === 'text') {
        const fs = el.fontSize ?? 14;
        await moveTo(id, sx, sy + fs * 0.6);
        press(id, true); await wait(tok, 90); press(id, false);
        addShape({ id: sid, kind: 'text', name: el.name, x: sx, y: sy, w: el.w, h: el.h, fill: 'transparent', text: '', fontSize: fs, weight: el.weight, color: res(el.color) ?? INK, owner: id });
        const full = el.text ?? '';
        for (let k = 1; k <= full.length; k++) {
          await wait(tok, 25 + Math.random() * 45);
          patch(sid, { text: full.slice(0, k) });
          const p = pos.get(id);
          if (p && !p.anim) p.x = sx + Math.min(el.w, ((k * fs * 0.56) % (el.w + 1)));
        }
      } else {
        await moveTo(id, sx, sy);
        await drag(id, tok, { id: sid, kind: el.kind, name: el.name, x: sx, y: sy, w: el.w, h: el.h, fill: res(el.fill) ?? LINE, radius: el.radius, owner: id }, sx + el.w, sy + el.h);
      }
      patch(sid, { owner: undefined });
    }
    patch(frameId, { owner: undefined });
  }

  async function runAgent(id: string, tok: Token) {
    await wait(tok, 200 + Math.random() * 800);
    while (tok.alive) {
      const slot = claimSlot();
      if (slot < 0) {
        // board is full: wander and "review" other designs
        status(id, 'reviewing');
        const k = Math.floor(Math.random() * MAX_SLOTS);
        await moveTo(id, (k % COLS) * CELL_W + 100 + Math.random() * 300, Math.floor(k / COLS) * CELL_H + 60 + Math.random() * 400);
        await wait(tok, 800 + Math.random() * 1500);
        continue;
      }
      const tpl = TEMPLATES[Math.floor(Math.random() * TEMPLATES.length)];
      const ox = (slot % COLS) * CELL_W + Math.round((CELL_W - tpl.w) / 2);
      const oy = Math.floor(slot / COLS) * CELL_H + 40;
      await build(id, tok, tpl, ox, oy);
      status(id, 'idle');
      await wait(tok, 500 + Math.random() * 1200);
    }
  }

  function startScript(id: string) {
    stopScript(id);
    const tok: Token = { alive: true, paused: false };
    tokens.set(id, tok);
    setMeta(id, { paused: false });
    const p = pos.get(id);
    if (p) p.paused = false;
    runAgent(id, tok).catch((e) => { if (e !== CANCEL) console.error(e); });
  }

  function spawnAgent(at?: { x: number; y: number }) {
    const i = spawned++;
    const lap = Math.floor(i / NAMES.length);
    const id = `agent-${i}`;
    addCursor({ id, name: NAMES[i % NAMES.length] + (lap ? ` ${lap + 1}` : ''), color: COLORS[i % COLORS.length], kind: 'agent', status: 'joining' },
      (at?.x ?? 600) + (Math.random() - 0.5) * 300, (at?.y ?? 300) + (Math.random() - 0.5) * 200);
    startScript(id);
    return id;
  }

  function setPaused(id: string, paused: boolean) {
    const t = tokens.get(id);
    if (t) t.paused = paused;
    const p = pos.get(id);
    if (p) p.paused = paused;
    setMeta(id, { paused, ...(paused ? { status: 'paused' } : {}) });
  }

  function clearBoard() {
    const agents = [...tokens.keys()];
    agents.forEach(stopScript);
    slots.clear();
    h.setShapes([]);
    agents.forEach(startScript);
  }

  function reset() {
    [...pos.keys()].forEach((id) => { stopScript(id); pos.delete(id); });
    slots.clear();
    spawned = 0;
    h.setShapes([]);
    h.setCursors([]);
  }

  return {
    pos, human, addCursor, removeCursor, moveTo, tick, spawnAgent, setPaused, clearBoard, reset,
    patch, addShape,
    get speed() { return speed; },
    setSpeed(s: number) { speed = s; },
    press,
    agentIds: () => [...tokens.keys()],
  };
}
