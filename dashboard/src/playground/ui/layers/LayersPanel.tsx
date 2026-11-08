// The layer tree: nested rows in z-order (top first), expand/collapse, kind icons, click to select.
import { useCallback, useMemo, useRef, useState } from 'react';
import { goToShape } from '../../core/goto';
import { useDoc } from '../../core/react';
import type { ShapeId } from '../../core/types';
import { useSelection } from '../hooks';
import type { SlotProps } from '../slotProps';
import { LayerRow, ROW_HEIGHT } from './LayerRow';
import { flattenTree, hiddenSelectionParents, isExpanded, rowActivity, subtreeParents, type ExpandedMap } from './treeView';
import { useLayerSelection, withAncestorsOpen } from './useLayerSelection';
import { VirtualList } from './VirtualList';
import type { VirtualListHandle } from './VirtualList';
import '../../styles/layers.css';

// Expand/collapse choices live for the browser session (per viewer, not synced).
let overrides: ExpandedMap = new Map();

export function LayersPanel({ board, cursors }: SlotProps) {
  const st = useDoc(board.doc);
  const selected = useSelection(board);
  const [exp, setExp] = useState<ExpandedMap>(overrides);

  const rows = useMemo(() => flattenTree(st.children, st.shapes, exp), [st.children, st.shapes, exp]);
  const selSet = useMemo(() => new Set(selected), [selected]);
  const hidden = useMemo(() => hiddenSelectionParents(rows, st.shapes, selected), [rows, st.shapes, selected]);
  const colors = new Map(cursors.map((a) => [a.id, a.color]));
  const activity = rowActivity(board.locks.list(), st.shapes, (h) => colors.get(h));
  const listRef = useRef<VirtualListHandle>(null);

  const shapesRef = useRef(st.shapes);
  shapesRef.current = st.shapes;
  // Reveal: open collapsed ancestors of the human's selected layers (expand state is per viewer).
  const expand = useCallback((ids: readonly ShapeId[]) => {
    const next = withAncestorsOpen(overrides, shapesRef.current, ids, (s) => isExpanded(s, overrides));
    if (next === overrides) return;
    overrides = next;
    setExp(next);
  }, []);
  const { onPick, onClickCapture, onBackgroundClick, onKeyDown } =
    useLayerSelection({ board, rows, selected, shapes: st.shapes, listRef, expand });
  const onJump = useCallback((id: ShapeId) => { goToShape(board.doc.getState(), id); }, [board]);
  const onToggle = useCallback((id: ShapeId, deep: boolean) => {
    const s = st.shapes.get(id);
    if (!s) return;
    const open = !isExpanded(s, overrides);
    const next = new Map(overrides);
    for (const p of deep ? subtreeParents(st.children, id) : [id]) next.set(p, open);
    overrides = next;
    setExp(next);
  }, [st.children, st.shapes]);

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }} onClickCapture={onClickCapture} onClick={onBackgroundClick}>
      <VirtualList ref={listRef} className="pg-layers" items={rows} rowHeight={ROW_HEIGHT} getKey={(r) => r.id} aria-label="Layers"
        onKeyDown={onKeyDown}
        empty={<div className="pg-empty">Agents are warming up…</div>}
        renderRow={(row) => (
          <LayerRow row={row} selected={selSet.has(row.id)} hiddenSelected={hidden.has(row.id)}
            lockColors={activity.own.get(row.id)} belowColors={activity.below.get(row.id)}
            onPick={onPick} onToggle={onToggle} onJump={onJump} />
        )} />
    </div>
  );
}
