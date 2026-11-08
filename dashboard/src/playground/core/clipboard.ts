// Clipboard (HISTORY-19, HISTORY-21): copy a selection with its subtrees, paste it with fresh ids.
// Pure over a BoardKit (no DOM). The payload keeps roots relative to the selection's world bounds, so a paste can
// land centered on the pointer or in place. Everything is one board.exec batch = one undo entry.
import type { BoardKit } from './commands';
import { COORD_LIMIT } from './geom';
import { opId } from './ids';
import { PROP_KEYS, descendants, flatten, frameAt, toLocal, toWorld, worldBounds } from './tree';
import type { Command, ExecResult, Kind, Pt, Rect, ShapeId, ShapeProps } from './types';

export const PASTE_STACK_OFFSET = 16;
export const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;
const KINDS: Kind[] = ['frame', 'group', 'rect', 'ellipse', 'text', 'line', 'image'];

export interface ClipItem {
  kind: Kind;
  /** Index (in `items`) of the parent, null for a root of the copy. Parents always come before children. */
  parent: number | null;
  /** Shape props. For roots x/y are relative to the payload's world origin; for children they stay parent-local. */
  props: Partial<ShapeProps>;
}
export interface ClipboardPayload {
  format: 'contract-board-clip';
  v: 1;
  /** World top-left of the copied selection (where an in-place paste lands). */
  origin: Pt;
  /** Size of the copied selection's world bounds. */
  size: { w: number; h: number };
  /** Parent the first root was copied from (in-place paste goes back there when it still exists). */
  srcParent: ShapeId | null;
  /** World top-left of the source parent (absent = copied from the root). Lets "paste into frame" keep relative position. */
  srcParentOrigin?: Pt;
  items: ClipItem[];
}

// ---- in-memory clipboard ----
let mem: ClipboardPayload | null = null;
export const getClipboard = (): ClipboardPayload | null => mem;
export const setClipboard = (p: ClipboardPayload | null): void => { mem = p; };

const live = (board: BoardKit, id: ShapeId): boolean => {
  const s = board.doc.getState().shapes.get(id);
  return !!s && !s.deleted;
};

// ---- copy ----
/** Serialize `ids` (and their subtrees) to a payload. Null when nothing live is selected. */
export function copyShapes(board: BoardKit, ids: readonly ShapeId[]): ClipboardPayload | null {
  const st = board.doc.getState();
  const picked = ids.filter((id) => live(board, id));
  const pick = new Set(picked);
  // a root is a picked shape with no picked ancestor (its subtree comes along anyway)
  const roots = picked.filter((id) => {
    let p = st.shapes.get(id)!.parent;
    while (p !== null && st.shapes.has(p)) { if (pick.has(p)) return false; p = st.shapes.get(p)!.parent; }
    return true;
  });
  if (!roots.length) return null;
  const rootSet = new Set(roots);
  const keep = new Set<ShapeId>(roots);
  for (const r of roots) descendants(st, r).forEach((d) => keep.add(d));

  const boxes = roots.map((r) => worldBounds(st, r)).filter((b): b is Rect => !!b);
  if (!boxes.length) return null;
  const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w)), y1 = Math.max(...boxes.map((b) => b.y + b.h));

  const order = flatten(st).filter((id) => keep.has(id)); // z-order, parents first
  const at = new Map<ShapeId, number>(order.map((id, i) => [id, i]));
  const items: ClipItem[] = order.map((id) => {
    const s = st.shapes.get(id)!;
    const props: Record<string, unknown> = {};
    for (const k of PROP_KEYS) if (s[k] !== undefined && k !== 'author' && k !== 'humanEdited') props[k] = structuredClone(s[k]);
    let parent: number | null = null;
    if (rootSet.has(id)) {
      const w = toWorld(st, s.parent !== null && st.shapes.has(s.parent) ? s.parent : null, { x: s.x, y: s.y });
      props.x = w.x - x0; props.y = w.y - y0;
    } else parent = at.get(s.parent as ShapeId) ?? null;
    return { kind: s.kind, parent, props: props as Partial<ShapeProps> };
  });
  const first = st.shapes.get(roots[0])!;
  const srcParent = first.parent !== null && st.shapes.has(first.parent) ? first.parent : null;
  const srcParentOrigin = srcParent !== null ? toWorld(st, srcParent, { x: 0, y: 0 }) : undefined;
  return { format: 'contract-board-clip', v: 1, origin: { x: x0, y: y0 }, size: { w: x1 - x0, h: y1 - y0 }, srcParent, srcParentOrigin, items };
}

/** "Card" -> "Card copy" -> "Card copy 2" ... only when `name` is already taken among the siblings. */
export function uniqueName(name: string, taken: ReadonlySet<string | undefined>): string {
  if (!taken.has(name)) return name;
  const base = `${name} copy`;
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`)) return `${base} ${i}`;
}

// ---- paste ----
export interface PasteOpts {
  /** Pointer paste: the world point the payload's bounds are centered on (top-left if bigger than `view`). */
  at?: Pt;
  /** Paste at the original coordinates (ignores `at`). */
  inPlace?: boolean;
  /** Visible world rect: a payload larger than it anchors its top-left to `at`. */
  view?: Rect;
  /** Force a target parent (null = root). Default: in place -> the original parent, else the frame under the anchor. */
  parent?: ShapeId | null;
  /** Paste into this frame at the same offset from its top-left as from the source parent (clamped inside). Wins over `parent`. */
  intoFrame?: ShapeId;
  /** Offset consecutive pastes at the same anchor by +16,+16 (default true). */
  stack?: boolean;
}
export interface PasteResult { ok: boolean; ids: ShapeId[]; exec?: ExecResult; error?: string }

const lastPaste = new WeakMap<BoardKit, { payload: ClipboardPayload; key: string; n: number }>();

/** Paste a payload as `board.me` (or `actor`): new ids, appended on top of the target parent, one undo entry. */
export function pastePayload(board: BoardKit, payload: ClipboardPayload, o: PasteOpts = {}, actor = board.me): PasteResult {
  if (!payload.items.length) return { ok: false, ids: [], error: 'Nothing to paste' };
  const st = board.doc.getState();
  const { w, h } = payload.size;

  // anchor = world top-left where the copy lands before the stacking offset
  let tl: Pt;
  let key: string;
  const into = o.intoFrame !== undefined && live(board, o.intoFrame) && st.shapes.get(o.intoFrame)!.kind === 'frame' ? o.intoFrame : null;
  if (into) {
    const f = st.shapes.get(into)!;
    const po = payload.srcParentOrigin ?? { x: 0, y: 0 };
    let rx = payload.origin.x - po.x, ry = payload.origin.y - po.y;
    // completely outside the target: pull it back inside (as far as the frame's size allows)
    if (rx + w <= 0 || rx >= f.w) rx = Math.max(0, Math.min(rx, f.w - w));
    if (ry + h <= 0 || ry >= f.h) ry = Math.max(0, Math.min(ry, f.h - h));
    tl = toWorld(st, into, { x: rx, y: ry });
    key = `into:${into}`;
  }
  else if (o.inPlace || !o.at) { tl = { ...payload.origin }; key = 'place'; }
  else {
    const big = !!o.view && (w > o.view.w || h > o.view.h);
    tl = big ? { ...o.at } : { x: o.at.x - w / 2, y: o.at.y - h / 2 };
    key = `${Math.round(o.at.x)},${Math.round(o.at.y)}`;
  }
  const prev = lastPaste.get(board);
  const n = o.stack === false ? 0 : prev && prev.payload === payload && prev.key === key ? prev.n + 1 : 0;
  tl = { x: tl.x + n * PASTE_STACK_OFFSET, y: tl.y + n * PASTE_STACK_OFFSET };

  let parent: ShapeId | null;
  if (into) parent = into;
  else if (o.parent !== undefined) parent = o.parent;
  else if (o.inPlace || !o.at) parent = payload.srcParent;
  else parent = frameAt(st, { x: tl.x + w / 2, y: tl.y + h / 2 });
  if (parent !== null && !live(board, parent)) parent = null;

  const taken = new Set((st.children.get(parent) ?? []).map((id) => st.shapes.get(id)?.name));
  const commands: Command[] = payload.items.map((it) => {
    const props: Partial<ShapeProps> = { ...it.props };
    if (it.parent === null) {
      const p = toLocal(st, parent, { x: tl.x + (it.props.x ?? 0), y: tl.y + (it.props.y ?? 0) });
      props.x = p.x; props.y = p.y;
      if (props.name !== undefined) { props.name = uniqueName(props.name, taken); taken.add(props.name); }
    }
    return { t: 'shape.create', kind: it.kind, props, parent: it.parent === null ? parent : `$${it.parent}` } as Command;
  });
  const exec = board.exec({ actor, opId: opId(actor), commands, atomic: true, label: payload.items.length > 1 ? 'Paste layers' : 'Paste' });
  if (!exec.ok) {
    const bad = exec.results.find((r) => !r.ok);
    return { ok: false, ids: [], exec, error: bad && !bad.ok ? (bad.error === 'locked' ? 'Layer is locked' : bad.message) : 'Could not paste' };
  }
  lastPaste.set(board, { payload, key, n });
  const ids: ShapeId[] = [];
  payload.items.forEach((it, i) => {
    const r = exec.results[i];
    if (it.parent === null && r.ok && r.id) ids.push(r.id);
  });
  return { ok: true, ids, exec };
}

// ---- system clipboard text ----
export const serializePayload = (p: ClipboardPayload): string => JSON.stringify(p);

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(-COORD_LIMIT, Math.min(COORD_LIMIT, v)) : undefined;

/** Parse clipboard text from outside. Returns null for anything that is not a valid payload (never throws). */
export function parsePayload(text: string): ClipboardPayload | null {
  if (typeof text !== 'string' || text.length > MAX_PAYLOAD_BYTES) return null;
  let raw: any;
  try { raw = JSON.parse(text); } catch { return null; }
  if (!raw || raw.format !== 'contract-board-clip' || raw.v !== 1 || !Array.isArray(raw.items) || !raw.items.length) return null;
  const items: ClipItem[] = [];
  for (let i = 0; i < raw.items.length; i++) {
    const it = raw.items[i];
    if (!it || !KINDS.includes(it.kind) || typeof it.props !== 'object' || it.props === null) return null;
    if (it.parent !== null && !(Number.isInteger(it.parent) && it.parent >= 0 && it.parent < i)) return null;
    const props: Record<string, unknown> = {};
    for (const k of PROP_KEYS) {
      if (!(k in it.props) || k === 'author' || k === 'humanEdited') continue;
      const v = ['x', 'y', 'w', 'h'].includes(k) ? num(it.props[k]) : it.props[k];
      if (v !== undefined) props[k] = v;
    }
    items.push({ kind: it.kind, parent: it.parent, props: props as Partial<ShapeProps> });
  }
  const o = raw.origin, s = raw.size;
  return {
    format: 'contract-board-clip', v: 1,
    origin: { x: num(o?.x) ?? 0, y: num(o?.y) ?? 0 },
    size: { w: Math.max(0, num(s?.w) ?? 0), h: Math.max(0, num(s?.h) ?? 0) },
    srcParent: null, // ids from another session mean nothing here
    srcParentOrigin: raw.srcParentOrigin && num(raw.srcParentOrigin.x) !== undefined && num(raw.srcParentOrigin.y) !== undefined
      ? { x: num(raw.srcParentOrigin.x)!, y: num(raw.srcParentOrigin.y)! } : undefined,
    items,
  };
}

/** What the system clipboard text is. `newer` = our format from a newer app version (refuse politely). */
export type ClipText =
  | { kind: 'payload'; payload: ClipboardPayload }
  | { kind: 'newer' } | { kind: 'toolarge' } | { kind: 'empty' }
  | { kind: 'text'; text: string };
export function classifyClipboardText(text: unknown): ClipText {
  if (typeof text !== 'string' || !text.trim()) return { kind: 'empty' };
  if (text.length > MAX_PAYLOAD_BYTES) return { kind: 'toolarge' };
  const payload = parsePayload(text);
  if (payload) return { kind: 'payload', payload };
  if (text.includes('contract-board-clip')) {
    try { const r = JSON.parse(text); if (r?.format === 'contract-board-clip' && typeof r.v === 'number' && r.v > 1) return { kind: 'newer' }; } catch { /* plain text */ }
  }
  return { kind: 'text', text };
}

// ---- paste plain text (HISTORY-24) ----
export const MAX_PASTE_TEXT = 10000;
const TEXT_FONT = 18, TEXT_MAX_W = 480;
export interface PasteTextResult { ok: boolean; id?: ShapeId; truncated: boolean; replaced?: boolean; exec?: ExecResult; error?: string }

/** Rough text box: 0.55em per char, 1.4 line height, wrapped at 480. */
function measureText(text: string): { w: number; h: number } {
  const cw = TEXT_FONT * 0.55, lh = Math.ceil(TEXT_FONT * 1.4);
  const lines = text.split('\n');
  const longest = Math.max(...lines.map((l) => l.length));
  const w = Math.max(24, Math.min(TEXT_MAX_W, Math.ceil(longest * cw) + 2));
  const perLine = Math.max(1, Math.floor(w / cw));
  const n = lines.reduce((a, l) => a + Math.max(1, Math.ceil(l.length / perLine)), 0);
  return { w, h: n * lh };
}

/** Plain text -> a text layer at world point `at` (or replace the text of `replace`). One undo entry. */
export function pasteText(board: BoardKit, raw: string, o: { at: Pt; replace?: ShapeId | null }, actor = board.me): PasteTextResult {
  if (!raw.trim()) return { ok: false, truncated: false };
  const truncated = raw.length > MAX_PASTE_TEXT;
  const text = (truncated ? raw.slice(0, MAX_PASTE_TEXT) : raw).replace(/\r\n?/g, '\n');
  const st = board.doc.getState();
  const target = o.replace ? st.shapes.get(o.replace) : undefined;
  if (target && !target.deleted && target.kind === 'text') {
    const exec = board.exec({ actor, opId: opId(actor), commands: [{ t: 'shape.update', ids: [target.id], patch: { text } }], label: 'Paste text' });
    return exec.ok ? { ok: true, id: target.id, truncated, replaced: true, exec } : { ok: false, truncated, exec, error: 'Could not paste' };
  }
  const parent = frameAt(st, o.at);
  const l = toLocal(st, parent, o.at);
  const { w, h } = measureText(text);
  const firstLine = text.split('\n').find((x) => x.trim()) ?? 'Text';
  const props: Partial<ShapeProps> = {
    name: firstLine.trim().slice(0, 24), x: l.x, y: l.y, w, h, fills: [], text, fontSize: TEXT_FONT, color: '#1c1917',
    textMode: w >= TEXT_MAX_W || text.includes('\n') ? 'auto-h' : 'auto-w',
  };
  const exec = board.exec({ actor, opId: opId(actor), commands: [{ t: 'shape.create', kind: 'text', props, parent }], label: 'Paste text' });
  const r = exec.results[0];
  if (!exec.ok || !r?.ok) return { ok: false, truncated, exec, error: r && !r.ok ? r.message : 'Could not paste' };
  return { ok: true, id: r.id, truncated, exec };
}
