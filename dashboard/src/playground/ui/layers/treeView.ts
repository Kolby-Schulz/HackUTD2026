// Pure layer-tree flattening: the document's ordered children -> display rows (top layer first), honouring expanded state.
import type { Shape, ShapeId } from '../../core/types';

export interface LayerRowData {
  id: ShapeId; depth: number; kind: string; name: string;
  hasChildren: boolean; expanded: boolean;
}
/** Explicit expand/collapse choices; ids not present use the default (frames open, everything else closed). */
export type ExpandedMap = ReadonlyMap<ShapeId, boolean>;

export const MAX_INDENT_DEPTH = 12;
export const isExpanded = (s: Pick<Shape, 'id' | 'kind'>, overrides: ExpandedMap) => overrides.get(s.id) ?? s.kind === 'frame';
export const rowName = (s: Pick<Shape, 'kind' | 'name' | 'text'>) => (s.kind === 'text' && s.text ? s.text : s.name);

type Children = ReadonlyMap<ShapeId | null, readonly ShapeId[]>;
type Shapes = ReadonlyMap<ShapeId, Shape>;

/** Flatten the tree. Siblings are reversed (store order is render order, bottom first); collapsed subtrees are skipped. */
export function flattenTree(children: Children, shapes: Shapes, overrides: ExpandedMap): LayerRowData[] {
  const rows: LayerRowData[] = [];
  const seen = new Set<ShapeId>(); // cycle / duplicate guard
  const stack: Array<{ id: ShapeId; depth: number }> = [];
  const pushKids = (p: ShapeId | null, depth: number) => {
    const kids = children.get(p);
    if (kids) for (let i = 0; i < kids.length; i++) stack.push({ id: kids[i], depth }); // reversed pop order = top first
  };
  pushKids(null, 0);
  while (stack.length) {
    const { id, depth } = stack.pop()!;
    const s = shapes.get(id);
    if (!s || seen.has(id)) continue;
    seen.add(id);
    const hasChildren = (children.get(id)?.length ?? 0) > 0;
    const expanded = hasChildren && isExpanded(s, overrides);
    rows.push({ id, depth, kind: s.kind, name: rowName(s), hasChildren, expanded });
    if (expanded) pushKids(id, depth + 1);
  }
  return rows;
}

/** `id` and all its descendants that have children (for Alt+click). */
export function subtreeParents(children: Children, id: ShapeId): ShapeId[] {
  const out: ShapeId[] = [];
  const seen = new Set<ShapeId>();
  const walk = (p: ShapeId) => {
    if (seen.has(p)) return;
    seen.add(p);
    const kids = children.get(p);
    if (!kids?.length) return;
    out.push(p);
    kids.forEach(walk);
  };
  walk(id);
  return out;
}

/** Ancestors of the selected ids that are collapsed in `rows`' terms: ids whose subtree hides a selected layer. */
export function hiddenSelectionParents(rows: readonly LayerRowData[], shapes: Shapes, selected: readonly ShapeId[]): Set<ShapeId> {
  const visible = new Set(rows.map((r) => r.id));
  const out = new Set<ShapeId>();
  for (const id of selected) {
    if (visible.has(id)) continue;
    let p = shapes.get(id)?.parent ?? null;
    for (let n = 0; p && n < 1000; n++) {
      if (visible.has(p)) { out.add(p); break; }
      p = shapes.get(p)?.parent ?? null;
    }
  }
  return out;
}
