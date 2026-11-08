// What an action card can say about a committed tx, read back from the document log (pure, no React):
// the before / after of a colour or size change, and whether a later edit has superseded the tx.
// The log only exists for this session, so after a reload a card has no diff and no pre-check (Undo then
// reports the reason itself, see ActionCard).
import type { DocStore, OpEnvelope, ShapeId, ShapeProps } from '../../core/types';

export type TxDiff =
  | { kind: 'color'; from?: string; to: string }
  | { kind: 'size'; dw: number; dh: number };
export interface TxInfo {
  diff?: TxDiff;
  /** Field values the tx wrote: if any no longer holds, someone changed the layer since. */
  wrote: Array<{ id: ShapeId; field: string; value: unknown }>;
  deleted: ShapeId[];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** The colour a patch / prior state shows. `color` is the TEXT colour (default black), so only text layers use it. */
const swatch = (p: Partial<ShapeProps>, text: boolean): string | undefined => {
  const f = (p.fills ?? []).find((x) => x.type === 'solid' && !x.hidden);
  return f ? f.color : text ? p.color : undefined;
};

/** Read the tx out of the log. Undefined when the log no longer holds it. */
export function inspectTx(doc: DocStore, txId: string): TxInfo | undefined {
  const log = doc.log();
  const mine: OpEnvelope[] = [];
  let first = -1;
  log.forEach((e, i) => { if (e.tx === txId) { mine.push(e); if (first < 0) first = i; } });
  if (!mine.length) return undefined;

  /** The value of `field` on `id` just before the tx: last earlier set, else the create. */
  const before = (id: ShapeId, field: string): unknown => {
    for (let i = first - 1; i >= 0; i--) {
      const b = log[i].body;
      if (b.t === 'set' && b.id === id && field in b.patch) return (b.patch as Record<string, unknown>)[field];
      if (b.t === 'create' && b.shape.id === id) return (b.shape as unknown as Record<string, unknown>)[field];
    }
    return undefined;
  };

  const info: TxInfo = { wrote: [], deleted: [] };
  for (const e of mine) {
    const b = e.body;
    if (b.t === 'remove') info.deleted.push(b.id);
    if (b.t !== 'set') continue;
    for (const [field, value] of Object.entries(b.patch)) info.wrote.push({ id: b.id, field, value });
    if (info.diff) continue;
    const isText = doc.getState().shapes.get(b.id)?.kind === 'text';
    const to = swatch(b.patch, isText);
    if (to) {
      const prior = swatch({ fills: before(b.id, 'fills') as ShapeProps['fills'], color: before(b.id, 'color') as string | undefined }, isText);
      info.diff = { kind: 'color', ...(prior ? { from: prior } : {}), to };
    } else if (typeof b.patch.w === 'number' || typeof b.patch.h === 'number') {
      const w0 = before(b.id, 'w'), h0 = before(b.id, 'h');
      info.diff = { kind: 'size', dw: Math.round((b.patch.w ?? (w0 as number)) - (w0 as number) || 0), dh: Math.round((b.patch.h ?? (h0 as number)) - (h0 as number) || 0) };
    }
  }
  return info;
}

/** True when a layer this tx wrote has a different value now (so Undo would skip it). */
export function changedSince(doc: DocStore, info: TxInfo): boolean {
  const shapes = doc.getState().shapes;
  for (const w of info.wrote) {
    const s = shapes.get(w.id);
    if (!s || s.deleted) return true;
    if (!same((s as unknown as Record<string, unknown>)[w.field], w.value)) return true;
  }
  return false;
}
