// Routing policy (COMMENT-8, COMMENT-9): who gets a note or a General message. Pure TS, no React or DOM.
// Order: @mention, claim holder, author, frame author, role match, nearest idle agent, general.
// The caller (useChat) builds a `RouterInput` from the board and runtime, then posts the decision as a routing card.
import { absRect, ancestors } from '../core/tree';
import type { TreeView } from '../core/tree';
import type { ActorId, MsgBody, ShapeId } from '../core/types';

export const GENERAL = 'general';
/** @all asks for confirmation above this many agents (COMMENT-8). */
export const ALL_CONFIRM_ABOVE = 5;

export type RouteWhy = 'mention' | 'claim' | 'author' | 'frame-author' | 'role' | 'nearest' | 'split' | 'general';

export interface RouterAgent {
  id: ActorId; name: string; role?: string;
  /** Stopped agents are never picked automatically; a mention of one is reported, not dropped. */
  stopped?: boolean;
  /** Tasks running or queued. 0 = idle. */
  load?: number;
}

export interface RouterInput {
  agents: RouterAgent[];
  doc: TreeView;
  /** The pin's layer, if the note is about one. */
  shapeId?: ShapeId;
  /** Live claims covering a layer (presence/claims.ts `covering`). */
  claims?: { covering(id: ShapeId): { holder: ActorId }[] };
  presence?: { get(id: ActorId): { x?: number; y?: number } | undefined };
}

export interface Decision {
  /** Thread / agent id that gets the note, or 'general' when nobody can. */
  to: ActorId;
  why: RouteWhy;
  /** Short reason shown in the pin popover and the card: "made this". */
  label: string;
}

const LABEL: Record<RouteWhy, string> = {
  mention: 'mentioned', claim: 'claimed this frame', author: 'made this', 'frame-author': 'made this frame',
  role: 'role match', nearest: 'closest agent', split: 'split by template', general: 'no agents yet',
};
const decision = (to: ActorId, why: RouteWhy): Decision => ({ to, why, label: LABEL[why] });

// ---- mentions ----

export interface Mentions {
  agents: RouterAgent[];
  all: boolean;
  /** @names that matched nobody (error chip, never silent routing). */
  unknown: string[];
  /** @names that matched several agents by first name: the user must be specific. */
  ambiguous: string[];
  /** Mentioned agents that are stopped ("Iris is stopped, start?"). */
  stopped: RouterAgent[];
  /** The text with code spans and quotes left intact, for display. */
  text: string;
}

/** Blank out `code`, ```fences``` and "quoted" runs so an @ inside them is not a mention. */
function maskLiteral(text: string): string {
  return text.replace(/```[\s\S]*?```|`[^`]*`|"[^"]*"|“[^”]*”/g, (m) => ' '.repeat(m.length));
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '');

export function parseMentions(text: string, agents: RouterAgent[]): Mentions {
  const masked = maskLiteral(text);
  const out: Mentions = { agents: [], all: false, unknown: [], ambiguous: [], stopped: [], text };
  const re = /(^|[^\w@])@([\p{L}\p{N}_-]+)/gu;
  for (let m = re.exec(masked); m; m = re.exec(masked)) {
    const raw = m[2];
    const key = norm(raw);
    if (key === 'all') { out.all = true; continue; }
    const exact = agents.filter((a) => norm(a.name) === key);
    const hits = exact.length ? exact : agents.filter((a) => norm(a.name.split(/\s+/)[0]) === key);
    if (!hits.length) { out.unknown.push(raw); continue; }
    if (hits.length > 1) { out.ambiguous.push(raw); continue; }
    const a = hits[0];
    if (!out.agents.some((x) => x.id === a.id)) out.agents.push(a);
    if (a.stopped && !out.stopped.some((x) => x.id === a.id)) out.stopped.push(a);
  }
  return out;
}

/** True when `@all` would hit more than 5 agents and the UI should confirm first. */
export const needsAllConfirm = (agents: RouterAgent[]) => agents.filter((a) => !a.stopped).length > ALL_CONFIRM_ABOVE;

/** Composer autocomplete: the `@query` being typed at `caret`, if any. */
export function mentionQuery(text: string, caret = text.length): { query: string; start: number } | null {
  const before = text.slice(0, caret);
  const m = /(^|[^\w@])@([\p{L}\p{N}_-]*)$/u.exec(before);
  if (!m) return null;
  const odd = (c: string) => (before.split(c).length - 1) % 2 === 1;
  if (odd('`') || odd('"')) return null; // still inside an unclosed code span or quote
  return { query: m[2], start: caret - m[2].length - 1 };
}

export type Suggestion = { id: ActorId | 'all'; name: string; role?: string; stopped?: boolean };

/** Autocomplete rows: live agents first, prefix matches before substring matches; `all` last. */
export function suggestMentions(query: string, agents: RouterAgent[], o: { includeStopped?: boolean } = {}): Suggestion[] {
  const q = norm(query);
  const rows: Suggestion[] = agents
    .filter((a) => (o.includeStopped || !a.stopped) && norm(a.name).includes(q))
    .sort((a, b) => Number(norm(b.name).startsWith(q)) - Number(norm(a.name).startsWith(q)) || a.name.localeCompare(b.name))
    .map((a) => ({ id: a.id, name: a.name, ...(a.role ? { role: a.role } : {}), ...(a.stopped ? { stopped: true } : {}) }));
  if (agents.length && 'all'.startsWith(q)) rows.push({ id: 'all', name: 'all', role: `${agents.filter((a) => !a.stopped).length} agents` });
  return rows;
}

/** Replace the `@query` at `start` with `@Name ` and return the new text and caret. */
export function applyMention(text: string, start: number, caret: number, name: string): { text: string; caret: number } {
  const ins = `@${name.includes(' ') ? name.split(/\s+/)[0] : name} `;
  return { text: text.slice(0, start) + ins + text.slice(caret), caret: start + ins.length };
}

// ---- policy ----

const dist = (inp: RouterInput, a: RouterAgent, cx: number, cy: number) => {
  const p = inp.presence?.get(a.id);
  return p?.x === undefined || p.y === undefined ? Infinity : Math.hypot(p.x - cx, p.y - cy);
};

/** Nearest non-stopped agent to a point: idle first, then distance, then shorter queue, then name. */
export function nearestIdle(inp: RouterInput, cx?: number, cy?: number): RouterAgent | undefined {
  const live = inp.agents.filter((a) => !a.stopped);
  const d = (a: RouterAgent) => (cx === undefined || cy === undefined ? 0 : dist(inp, a, cx, cy));
  return live.sort((a, b) =>
    Number((a.load ?? 0) > 0) - Number((b.load ?? 0) > 0) || d(a) - d(b) || (a.load ?? 0) - (b.load ?? 0) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))[0];
}

/**
 * Where a note goes. `mentions` (from parseMentions) wins when it names exactly one agent; with several, the first
 * is the primary recipient and the caller fans the rest out. Without a layer, only mention and least-busy apply.
 */
export function route(inp: RouterInput, mentions?: Mentions): Decision {
  const live = new Map(inp.agents.filter((a) => !a.stopped).map((a) => [a.id, a]));
  if (mentions?.agents.length) return decision(mentions.agents[0].id, 'mention');
  if (!live.size) return decision(GENERAL, 'general');

  const st = inp.doc;
  const s = inp.shapeId ? st.shapes.get(inp.shapeId) : undefined;
  if (inp.shapeId && s) {
    const chain = [inp.shapeId, ...ancestors(st, inp.shapeId)];
    const holder = inp.claims?.covering(inp.shapeId).map((c) => c.holder).find((h) => live.has(h));
    if (holder) return decision(holder, 'claim');
    const owner = (id: ShapeId) => { const x = st.shapes.get(id); return [x?.author, x?.createdBy].find((a) => a && live.has(a)); };
    const own = owner(inp.shapeId);
    if (own) return decision(own, 'author');
    for (const id of chain.slice(1)) { const o = owner(id); if (o) return decision(o, 'frame-author'); }
    if (s.kind === 'text') {
      const copy = inp.agents.filter((a) => !a.stopped && /copy/i.test(a.role ?? ''));
      if (copy.length) return decision(nearestIdle({ ...inp, agents: copy }, ...centre(inp, inp.shapeId))!.id, 'role');
    }
    const n = nearestIdle(inp, ...centre(inp, inp.shapeId));
    return decision(n!.id, 'nearest');
  }
  return decision(nearestIdle(inp)!.id, 'nearest');
}

function centre(inp: RouterInput, id: ShapeId): [number | undefined, number | undefined] {
  const r = absRect(inp.doc, id);
  return r ? [r.x + r.w / 2, r.y + r.h / 2] : [undefined, undefined];
}

// ---- General: one request per template keyword ----

export type SplitPart = { agent: RouterAgent; text: string; part: string };

const PARTS: { re: RegExp; ask: string; part: string }[] = [
  { re: /\b(hero|landing)\b/i, ask: 'build a hero section', part: 'hero' },
  { re: /\b(stat|stats|chart|widget|revenue)\b/i, ask: 'build a stats widget', part: 'stats' },
  { re: /\b(profile|card)\b/i, ask: 'build a profile card', part: 'profile card' },
  { re: /\b(mobile|phone|app|tasks?)\b/i, ask: 'build a mobile tasks screen', part: 'mobile screen' },
];

/**
 * "build a landing page: hero, stats, profile card" -> one request per agent. Needs a build verb and 2+ distinct
 * template keywords, otherwise returns null and the message goes to a single agent via `route`. Parts go to the
 * least busy agents first (stable order), wrapping around when there are more parts than agents.
 */
export function splitGeneral(text: string, inp: RouterInput): SplitPart[] | null {
  if (!/\b(build|make|create|design|draw)\b/i.test(text)) return null;
  const parts = PARTS.filter((p) => p.re.test(text));
  if (parts.length < 2) return null;
  const live = inp.agents.filter((a) => !a.stopped);
  if (!live.length) return null;
  const order = [...live].sort((a, b) => (a.load ?? 0) - (b.load ?? 0) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return parts.map((p, i) => ({ agent: order[i % order.length], text: p.ask, part: p.part }));
}

// ---- the card ----

/** The routing card body for a decision. The text ("Routed to Iris (made this)") goes in NewMsg.text. */
export function routingCard(d: Decision, nameOf: (id: ActorId) => string): { body: MsgBody; text: string } {
  const why: Extract<MsgBody, { kind: 'routing' }>['why'] =
    d.why === 'role' || d.why === 'split' || d.why === 'general' ? 'manual' : d.why;
  return {
    body: { kind: 'routing', to: d.to, why },
    text: d.to === GENERAL ? 'No agents yet' : `Routed to ${nameOf(d.to)} (${d.label})`,
  };
}
