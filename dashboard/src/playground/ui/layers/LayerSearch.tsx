// Layers search box, footer summary and the pure filter behind them (LAYERS-14, LAYERS-26).
import { forwardRef, useEffect, useState } from 'react';
import type { Shape, ShapeId } from '../../core/types';
import { flattenTree, rowName, type LayerRowData } from './treeView';

type Children = ReadonlyMap<ShapeId | null, readonly ShapeId[]>;
type Shapes = ReadonlyMap<ShapeId, Shape>;

export const SEARCH_DEBOUNCE_MS = 100;

/** Rows matching `query` (case-insensitive substring of name or text content) plus all their ancestors, in tree order.
 *  Ancestors of a match show expanded; a blank query returns null (use the normal tree). */
export function filterRows(children: Children, shapes: Shapes, query: string): { rows: LayerRowData[]; matches: number } | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const open = new Map<ShapeId, boolean>();
  for (const [p, kids] of children) if (p && kids.length) open.set(p, true);
  const all = flattenTree(children, shapes, open);
  const matched = new Set<ShapeId>();
  for (const r of all) {
    const s = shapes.get(r.id);
    if (s && (rowName(s).toLowerCase().includes(q) || s.name.toLowerCase().includes(q))) matched.add(r.id);
  }
  const keep = new Set(matched);
  for (const id of matched) {
    let p = shapes.get(id)?.parent ?? null;
    for (let n = 0; p && !keep.has(p) && n < 1000; n++) { keep.add(p); p = shapes.get(p)?.parent ?? null; }
  }
  const rows = all.filter((r) => keep.has(r.id)).map((r) => ({ ...r, expanded: r.hasChildren && children.get(r.id)!.some((k) => keep.has(k)) }));
  return { rows, matches: matched.size };
}

/** '12 layers · 3 selected', or '2 of 12 layers · 1 selected' while filtering. */
export function summaryText(total: number, selected: number, matches: number | null): string {
  const head = matches === null ? `${total} ${total === 1 ? 'layer' : 'layers'}` : `${matches} of ${total} ${total === 1 ? 'layer' : 'layers'}`;
  return selected ? `${head} · ${selected} selected` : head;
}

/** Debounced copy of `value`. */
export function useDebounced<T>(value: T, ms = SEARCH_DEBOUNCE_MS): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

interface SearchProps {
  value: string;
  onChange: (v: string) => void;
  /** Esc or ArrowDown: hand focus back to the list. */
  onLeave: () => void;
}
export const LayerSearch = forwardRef<HTMLInputElement, SearchProps>(function LayerSearch({ value, onChange, onLeave }, ref) {
  return (
    <div style={{ padding: '8px 8px 0' }} onClick={(e) => e.stopPropagation()}>
      <input ref={ref} type="search" value={value} placeholder="Search layers" aria-label="Search layers" spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') { e.preventDefault(); onChange(''); onLeave(); }
          else if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); onLeave(); }
        }}
        style={{ width: '100%', boxSizing: 'border-box', height: 26, padding: '0 8px', fontSize: 12, color: 'var(--pg-ink)', background: 'var(--pg-sunken)', border: '1px solid var(--pg-line)', borderRadius: 6, outline: 'none' }} />
    </div>
  );
});

export function LayerFooter({ total, selected, matches }: { total: number; selected: number; matches: number | null }) {
  return (
    <div aria-live="polite" style={{ padding: '4px 10px', fontSize: 11, color: 'var(--pg-muted)', borderTop: '1px solid var(--pg-line)' }}>
      {summaryText(total, selected, matches)}
    </div>
  );
}
