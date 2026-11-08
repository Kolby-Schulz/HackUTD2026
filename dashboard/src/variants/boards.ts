// Bridge from the #/playground board to the comparison page. Pure: no React, no DOM, no storage access.
// The playground autosaves to localStorage (`pg.board.v1.<boardId>`, core/persist.ts); both pages share an
// origin, so this page reads the same save. Nothing here writes to the playground.
//
// The playground is optional: its modules are loaded with import.meta.glob, which yields nothing when the files
// are absent (e.g. on main before the board lands). Then PLAYGROUND_AVAILABLE is false and the page hides the
// "From playground" entry; copies already saved in lineage.json still render once the board's styles exist.
import type { CodeInfo } from './model.ts';
import type { BoardRef, SlotId } from './types.ts';

type Rec = Record<string, unknown>;
type Loaded = { status: 'ok'; board: { boardId: string; meta: { name: string }; savedAt: number; shapes: unknown[] } } | { status: string };
const persistMods = import.meta.glob<{ parseSaved: (raw: string) => Loaded }>('../playground/core/persist.ts', { eager: true });
const persist = Object.values(persistMods)[0];
export const PLAYGROUND_AVAILABLE = !!persist;

/** The fields of a playground shape this page reads (core/types.ts `Shape`), kept local so main builds without it. */
export interface Shape extends Rec {
  id: string;
  kind: string;
  parent: string | null;
  index: string;
  name: string;
  x: number; y: number; w: number; h: number;
  text?: string;
  author?: string;
  createdBy?: string;
  deleted?: true;
}

/** Same order as the playground's core/order.ts compareSiblings: fractional index, then id. */
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const compareSiblings = (x: { index: string; id: string }, y: { index: string; id: string }) => cmp(x.index, y.index) || cmp(x.id, y.id);

export const PLAYGROUND_BOARD = 'playground';
/** core/persist.ts storageKey. */
export const boardKey = (boardId: string) => `pg.board.v1.${boardId}`;

/** A link that opens the playground centred on a frame with it selected (core/url.ts encodeView format). */
export function playgroundHref(f: Pick<Shape, 'id' | 'x' | 'y' | 'w' | 'h'>): string {
  return `#/playground?x=${Math.round(f.x + f.w / 2)}&y=${Math.round(f.y + f.h / 2)}&z=1&sel=${encodeURIComponent(f.id)}`;
}

export interface BoardData {
  boardId: string;
  name: string;
  savedAt: number;
  shapes: ReadonlyMap<string, Shape>;
  kids: ReadonlyMap<string | null, readonly string[]>;
}

/** Live shapes only (tombstones dropped), with a sorted child index. */
export function boardFromShapes(boardId: string, list: readonly unknown[], meta: { name?: string; savedAt?: number } = {}): BoardData {
  const shapes = new Map<string, Shape>();
  for (const s of list as Shape[]) if (s && typeof s.id === 'string' && !s.deleted) shapes.set(s.id, s);
  const groups = new Map<string | null, Shape[]>();
  for (const s of shapes.values()) {
    const p = s.parent && shapes.has(s.parent) ? s.parent : null;
    groups.set(p, [...(groups.get(p) ?? []), s]);
  }
  const kids = new Map<string | null, string[]>();
  for (const [p, g] of groups) kids.set(p, g.sort((a, b) => compareSiblings({ index: a.index ?? '', id: a.id }, { index: b.index ?? '', id: b.id })).map((s) => s.id));
  return { boardId, name: meta.name ?? 'Untitled', savedAt: meta.savedAt ?? 0, shapes, kids };
}

/** Parse a raw playground save (or null when there is none / it is unreadable). */
export function parseBoard(raw: string | null): BoardData | null {
  if (!raw || !persist) return null;
  const r = persist.parseSaved(raw);
  if (r.status !== 'ok' || !('board' in r)) return null;
  return boardFromShapes(r.board.boardId, r.board.shapes, { name: r.board.meta.name, savedAt: r.board.savedAt });
}

export interface FrameInfo { id: string; name: string; w: number; h: number; layers: number; author?: string }

/** Top-level frames, in board order: the things worth comparing. */
export function listFrames(b: BoardData): FrameInfo[] {
  return (b.kids.get(null) ?? [])
    .map((id) => b.shapes.get(id)!)
    .filter((s) => s.kind === 'frame')
    .map((s) => ({ id: s.id, name: s.name || 'Frame', w: Math.round(s.w), h: Math.round(s.h), layers: descendants(b, s.id).length, author: s.author ?? s.createdBy }));
}

export function descendants(b: BoardData, id: string): string[] {
  const out: string[] = [];
  const walk = (p: string) => { for (const k of b.kids.get(p) ?? []) { out.push(k); walk(k); } };
  walk(id);
  return out;
}

/** The frame and everything inside it, as plain records, for a frozen copy. */
export function snapshot(b: BoardData, frameId: string): Record<string, unknown>[] {
  if (!b.shapes.has(frameId)) return [];
  return [frameId, ...descendants(b, frameId)].map((id) => {
    const { stamps: _s, ...rest } = b.shapes.get(id)!;
    return { ...rest, ...(id === frameId ? { parent: null } : {}) };
  });
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Which direct children of the frame stand for which screen parts. A layer named "Hero", "hero" or "Top nav"
 * matches the slot `hero` / the slot labelled "Top nav". The first match per slot wins.
 */
export function matchSlots(b: BoardData, frameId: string, slots: Record<SlotId, string>): Record<SlotId, string> {
  const out: Record<SlotId, string> = {};
  for (const kid of b.kids.get(frameId) ?? []) {
    const n = norm(b.shapes.get(kid)?.name ?? '');
    if (!n) continue;
    for (const [slot, label] of Object.entries(slots)) {
      if (!out[slot] && (norm(slot) === n || norm(label) === n)) out[slot] = kid;
    }
  }
  return out;
}

export interface BoardNode { ref: BoardRef; data: BoardData | null; frame: Shape | null; matches: Record<SlotId, string>; info: CodeInfo }

/** Turns a board link into a graph node. A frame with no matching layers is compared as a whole page. */
export function boardNode(ref: BoardRef, live: BoardData | null, slots: Record<SlotId, string>): BoardNode {
  const data = ref.mode === 'copy' ? boardFromShapes(ref.boardId, ref.shapes ?? []) : live;
  const frame = data?.shapes.get(ref.frameId) ?? null;
  const matches = data && frame ? matchSlots(data, ref.frameId, slots) : {};
  const own = Object.keys(matches);
  const note =
    ref.mode === 'copy' ? 'A frozen copy of a playground frame'
    : !live ? 'Live link: no playground board saved in this browser'
    : !frame ? 'Live link: this frame was deleted in the playground'
    : 'Live from the playground: updates when the board changes';
  return {
    ref, data, frame, matches,
    info: { id: ref.id, title: ref.title, note, own, source: ref.mode, whole: !own.length },
  };
}
