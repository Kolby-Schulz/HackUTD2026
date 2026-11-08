// Pure helpers shared by the browser page and the Vite dev plugin (vite-variants.ts):
// id rules, lineage.json normalisation and the source text of a new child variant.
import type { BoardRef, Combo, Lineage, NodeId, SlotId } from './types.ts';

export const EMPTY_LINEAGE: Lineage = { version: 1, combos: [], boards: [], final: {} };

const ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
export const isSafeId = (s: unknown): s is string => typeof s === 'string' && ID_RE.test(s);

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'variant';
}

export function uniqueId(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  const root = slugify(base);
  if (!set.has(root)) return root;
  for (let i = 2; ; i++) if (!set.has(`${root}-${i}`)) return `${root}-${i}`;
}

export function newComboId(taken: Iterable<string>, now = Date.now()): NodeId {
  return uniqueId(`mix-${now.toString(36)}`, taken);
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Accepts anything; returns a valid Lineage, dropping malformed entries. */
export function normalizeLineage(raw: unknown): Lineage {
  if (!isRecord(raw)) return { version: 1, combos: [], boards: [], final: {} };
  const combos: Combo[] = [];
  const ids = new Set<string>();
  for (const c of Array.isArray(raw.combos) ? raw.combos : []) {
    if (!isRecord(c) || !isSafeId(c.id) || !isSafeId(c.screen) || ids.has(c.id) || !isRecord(c.picks)) continue;
    const picks: Record<SlotId, NodeId> = {};
    for (const [s, p] of Object.entries(c.picks)) if (typeof p === 'string' && isSafeId(p)) picks[s] = p;
    const combo: Combo = {
      id: c.id,
      screen: c.screen,
      title: typeof c.title === 'string' && c.title.trim() ? c.title : c.id,
      parents: Array.isArray(c.parents) ? c.parents.filter(isSafeId) : [],
      picks,
      createdAt: typeof c.createdAt === 'string' ? c.createdAt : new Date(0).toISOString(),
    };
    if (typeof c.note === 'string' && c.note) combo.note = c.note;
    ids.add(c.id);
    combos.push(combo);
  }
  const boards: BoardRef[] = [];
  for (const b of Array.isArray(raw.boards) ? raw.boards : []) {
    if (!isRecord(b) || !isSafeId(b.id) || !isSafeId(b.screen) || ids.has(b.id)) continue;
    if (typeof b.boardId !== 'string' || typeof b.frameId !== 'string' || (b.mode !== 'live' && b.mode !== 'copy')) continue;
    const ref: BoardRef = {
      id: b.id, screen: b.screen, title: typeof b.title === 'string' && b.title.trim() ? b.title : b.id,
      boardId: b.boardId, frameId: b.frameId, mode: b.mode,
      importedAt: typeof b.importedAt === 'string' ? b.importedAt : new Date(0).toISOString(),
    };
    if (b.mode === 'copy') ref.shapes = Array.isArray(b.shapes) ? b.shapes.filter(isRecord) : [];
    ids.add(b.id);
    boards.push(ref);
  }
  const final: Record<string, NodeId> = {};
  if (isRecord(raw.final)) for (const [s, n] of Object.entries(raw.final)) if (isSafeId(s) && isSafeId(n)) final[s] = n;
  return { version: 1, combos, boards, final };
}

/** Stable, diff-friendly JSON (mixes by screen then time, keys sorted where order is not meaningful). */
export function serializeLineage(l: Lineage): string {
  const combos = [...l.combos].sort((a, b) => a.screen.localeCompare(b.screen) || a.createdAt.localeCompare(b.createdAt));
  const final = Object.fromEntries(Object.entries(l.final).sort(([a], [b]) => a.localeCompare(b)));
  const boards = [...l.boards].sort((a, b) => a.screen.localeCompare(b.screen) || a.importedAt.localeCompare(b.importedAt));
  return JSON.stringify({ version: 1, final, combos, ...(boards.length ? { boards } : {}) }, null, 2) + '\n';
}

export interface ScaffoldSlot {
  slot: SlotId;
  label: string;
  from: NodeId | null;
  path?: string;
}

export interface ScaffoldRequest {
  screen: string;
  id: NodeId;
  parent: NodeId;
  title: string;
  note?: string;
  slots: ScaffoldSlot[];
}

const q = (s: string) => JSON.stringify(s);

/** Source of src/designs/<screen>/<id>/index.tsx for a new child that starts identical to its parent. */
export function scaffoldSource(r: ScaffoldRequest): string {
  const w = Math.max(4, ...r.slots.map((s) => s.slot.length));
  const lw = Math.max(4, ...r.slots.map((s) => s.label.length));
  const lines = r.slots.map(
    (s) => `//   ${s.slot.padEnd(w)}  ${s.label.padEnd(lw)}  from ${s.from ?? '(nothing)'}${s.path ? `  (${s.path})` : ''}`,
  );
  const commented = r.slots.map((s) => `    // ${s.slot}: ${s.slot[0].toUpperCase()}${s.slot.slice(1)},`);
  return [
    `// ${r.title.replace(/\s+/g, ' ')}: a child of "${r.parent}". It renders exactly like its parent until you override a slot.`,
    `// Write a component for each slot you change and add it to \`slots\` below. Slots today:`,
    ...lines,
    `import { defineVariant } from '../../../variants/define.ts';`,
    ``,
    `export default defineVariant({`,
    `  title: ${q(r.title)},`,
    ...(r.note?.trim() ? [`  note: ${q(r.note.trim())},`] : []),
    `  extends: ${q(r.parent)},`,
    `  slots: {`,
    ...commented,
    `  },`,
    `});`,
    ``,
  ].join('\n');
}

export function isScaffoldRequest(v: unknown): v is ScaffoldRequest {
  return (
    isRecord(v) && isSafeId(v.screen) && isSafeId(v.id) && isSafeId(v.parent) && typeof v.title === 'string' &&
    Array.isArray(v.slots) && v.slots.every((s) => isRecord(s) && typeof s.slot === 'string' && /^[A-Za-z][A-Za-z0-9_]*$/.test(s.slot) && typeof s.label === 'string')
  );
}
