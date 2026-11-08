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
  return { format: 'contract-board-clip', v: 1, origin: { x: x0, y: y0 }, size: { w: x1 - x0, h: y1 - y0 }, srcParent, items };
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
  if (o.inPlace || !o.at) { tl = { ...payload.origin }; key = 'place'; }
  else {
    const big = !!o.view && (w > o.view.w || h > o.view.h);
    tl = big ? { ...o.at } : { x: o.at.x - w / 2, y: o.at.y - h / 2 };
    key = `${Math.round(o.at.x)},${Math.round(o.at.y)}`;
  }
  const prev = lastPaste.get(board);
  const n = o.stack === false ? 0 : prev && prev.payload === payload && prev.key === key ? prev.n + 1 : 0;
  tl = { x: tl.x + n * PASTE_STACK_OFFSET, y: tl.y + n * PASTE_STACK_OFFSET };

  let parent: ShapeId | null;
  if (o.parent !== undefined) parent = o.parent;
  else if (o.inPlace || !o.at) parent = payload.srcParent;
  else parent = frameAt(st, { x: tl.x + w / 2, y: tl.y + h / 2 });
  if (parent !== null && !live(board, parent)) parent = null;

  const taken = new Set((st.children.get(parent) ?? []).map((id) => st.shapes.get(id)?.name));
  const commands: Command[] = payload.items.map((it) => {
    const props: Partial<ShapeProps> = { ...it.props };
    if (it.parent === null) {
      const p = toLocal(st, parent, { x: tl.x + (it.props.x ?? 0), y: tl.y + (it.props.y ?? 0) });
      props.x = p.x; props.y = p.y;
      if (props.name !== undefined && taken.has(props.name)) props.name = `${props.name} copy`;
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
    items,
  };
}
