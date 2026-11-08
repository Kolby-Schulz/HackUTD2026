// Small subscriptions slots use to read what they need, so the composition root passes few props.
import { useCallback } from 'react';
import type { BoardKit } from '../core/commands';
import { useStoreValue } from '../core/react';
import type { ShapeId } from '../core/types';
import type { UiState, UiStore } from './board/state';

/** One field of the UI store (tool, editing, hover, pop, ...). */
export function useUi<K extends keyof UiState>(ui: UiStore, key: K): UiState[K] {
  return useStoreValue(ui.subscribe, useCallback(() => ui.get()[key], [ui, key]));
}

/** The local human's selected layer ids (stable array while unchanged). */
export function useSelection(board: BoardKit): readonly ShapeId[] {
  const sub = useCallback((l: () => void) => board.selection.subscribe(() => l()), [board]);
  return useStoreValue(sub, useCallback(() => board.selection.get(board.me).ids, [board]));
}
