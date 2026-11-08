// The layer tree: nested rows in z-order (top first), expand/collapse, kind icons, click to select.
import { useCallback, useMemo, useRef, useState } from 'react';
import { goToShape } from '../../core/goto';
import { useDoc } from '../../core/react';
import type { ShapeId } from '../../core/types';
import { selectIds } from '../board/state';
import { useSelection } from '../hooks';
import { LayerFooter, LayerSearch, filterRows, useDebounced } from './LayerSearch';
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

  const [query, setQuery] = useState('');
  const debounced = useDebounced(query);
  const searchRef = useRef<HTMLInputElement>(null);
  const filtered = useMemo(() => filterRows(st.children, st.shapes, debounced), [st.children, st.shapes, debounced]);
  const treeRows = useMemo(() => flattenTree(st.children, st.shapes, exp), [st.children, st.shapes, exp]);
  const rows = filtered ? filtered.rows : treeRows;
  const total = useMemo(() => { let n = 0; for (const s of st.shapes.values()) if (!s.deleted) n++; return n; }, [st.shapes]);
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

  const focusList = useCallback(() => listRef.current?.element()?.focus(), []);
  // Left: collapse, else go to the parent. Right: expand, else go to the first child. Other keys: selection hook.
  const onListKey = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).tagName === 'INPUT' || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) { onKeyDown(e); return; }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') { onKeyDown(e); return; }
    const at = rows.findIndex((r) => r.id === selected[selected.length - 1]);
    if (at < 0) return;
    e.preventDefault();
    e.stopPropagation();
    const row = rows[at];
    const go = (id: ShapeId | undefined) => { if (!id) return; selectIds(board, [id]); listRef.current?.scrollToIndex(rows.findIndex((r) => r.id === id), 'auto'); };
    if (e.key === 'ArrowLeft') {
      if (row.expanded && !filtered) onToggle(row.id, false);
      else { const p = st.shapes.get(row.id)?.parent; go(rows.find((r) => r.id === p)?.id); }
    } else if (row.hasChildren && !row.expanded) onToggle(row.id, false);
    else if (row.expanded) go(rows[at + 1]?.depth > row.depth ? rows[at + 1].id : undefined);
  }, [rows, selected, board, filtered, onToggle, onKeyDown, st.shapes]);
  // Cmd/Ctrl+F while the panel has focus opens the search box (the browser find is not useful here).
  const onPanelKey = useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') {
      e.preventDefault(); e.stopPropagation(); searchRef.current?.focus(); searchRef.current?.select();
    }
  }, []);

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }} onClickCapture={onClickCapture} onClick={onBackgroundClick} onKeyDown={onPanelKey}>
      <LayerSearch ref={searchRef} value={query} onChange={setQuery} onLeave={focusList} />
      <VirtualList ref={listRef} className="pg-layers" items={rows} rowHeight={ROW_HEIGHT} getKey={(r) => r.id} aria-label="Layers"
        onKeyDown={onListKey}
        empty={<div className="pg-empty">{filtered ? 'No layers match' : 'Agents are warming up…'}</div>}
        renderRow={(row) => (
          <LayerRow row={row} selected={selSet.has(row.id)} hiddenSelected={hidden.has(row.id)}
            lockColors={activity.own.get(row.id)} belowColors={activity.below.get(row.id)}
            onPick={onPick} onToggle={onToggle} onJump={onJump} />
        )} />
      <LayerFooter total={total} selected={selected.length} matches={filtered ? filtered.matches : null} />
    </div>
  );
}
