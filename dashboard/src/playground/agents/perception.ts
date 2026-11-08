// What an LLM agent sees (AGENT-21): a compact, size-capped JSON snapshot of the board around it.
// Read-only; no React, no DOM. Sent to the local bridge, never to a provider from the browser.
import { absRect } from '../core/tree';
import type { Actor, Rect, Shape, Task } from '../core/types';
import type { Board } from '../core/types';

export const DEFAULT_MAX_BYTES = 8000;
const NEAR = 900;          // world units around the agent's cursor when it has no frame
const MAX_SHAPES = 2000, MAX_CHAT = 8, MAX_TEXT = 80, MAX_CHAT_LINE = 300;

export interface PShape { id: string; k: string; n: string; x: number; y: number; w: number; h: number; p?: string; f?: string; t?: string; a?: string }
export interface Perception {
  seq: number;
  task: { id: string; kind: string; text: string; shapeId?: string };
  self: { id: string; name: string; role?: string; at?: { x: number; y: number } };
  frame: PShape | null;
  shapes: PShape[];
  chat: string[];
  truncated: boolean;
}

const hit = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const r = Math.round;

function topFrame(shapes: ReadonlyMap<string, Shape>, id: string | undefined): Shape | null {
  let cur = id ? shapes.get(id) : undefined, found: Shape | null = null;
  for (let n = 0; cur && n < 64; n++) {
    if (cur.kind === 'frame') found = cur;
    cur = cur.parent ? shapes.get(cur.parent) : undefined;
  }
  return found;
}

function compact(s: Shape, box: Rect): PShape {
  const fill = s.fills?.find((f) => !f.hidden);
  const o: PShape = { id: s.id, k: s.kind, n: s.name.slice(0, 40), x: r(box.x), y: r(box.y), w: r(box.w), h: r(box.h) };
  if (s.parent) o.p = s.parent;
  if (fill) o.f = fill.color;
  if (s.text) o.t = s.text.slice(0, MAX_TEXT);
  if (s.author) o.a = s.author;
  return o;
}

export function buildPerception(board: Board, o: {
  me: Actor; task: Task; chatLines?: readonly string[]; maxBytes?: number;
}): Perception {
  const max = o.maxBytes ?? DEFAULT_MAX_BYTES;
  const doc = board.doc.getState();
  const pos = board.presence.get(o.me.id);
  const at = pos && typeof pos.x === 'number' && typeof pos.y === 'number' ? { x: r(pos.x), y: r(pos.y) } : undefined;

  const target = o.task.shapeId ? doc.shapes.get(o.task.shapeId) : undefined;
  let frame = topFrame(doc.shapes, target && !target.deleted ? target.id : undefined);
  let region: Rect | null = null;
  if (frame) region = absRect(doc, frame.id);
  else if (at) region = { x: at.x - NEAR, y: at.y - NEAR, w: NEAR * 2, h: NEAR * 2 };
  if (!region) frame = null;

  const list: PShape[] = [];
  let truncated = false;
  for (const s of doc.shapes.values()) {
    if (s.deleted) continue;
    const box = absRect(doc, s.id);
    if (!box || (region && !hit(region, box))) continue;
    if (list.length >= MAX_SHAPES) { truncated = true; break; }
    list.push(compact(s, box));
  }
  // The task's own layer first, then bigger layers before small ones, so a size cut drops the least useful.
  const tid = o.task.shapeId;
  list.sort((a, b) => (a.id === tid ? -1 : b.id === tid ? 1 : b.w * b.h - a.w * a.h));

  const frameBox = frame ? absRect(doc, frame.id) : null;
  const p: Perception = {
    seq: board.snapshot().seq,
    task: { id: o.task.id, kind: o.task.kind, text: o.task.text.slice(0, 600), ...(tid ? { shapeId: tid } : {}) },
    self: { id: o.me.id, name: o.me.name, ...(o.me.role ? { role: o.me.role } : {}), ...(at ? { at } : {}) },
    frame: frame && frameBox ? compact(frame, frameBox) : null,
    shapes: list,
    chat: (o.chatLines ?? []).slice(-MAX_CHAT).map((l) => l.slice(0, MAX_CHAT_LINE)),
    truncated,
  };
  // Size cap: drop shapes from the tail (smallest first) until the JSON fits.
  while (p.shapes.length > 0 && JSON.stringify(p).length > max) {
    p.shapes.length = Math.floor(p.shapes.length * 0.8) === p.shapes.length ? p.shapes.length - 1 : Math.floor(p.shapes.length * 0.8);
    p.truncated = true;
  }
  return p;
}
