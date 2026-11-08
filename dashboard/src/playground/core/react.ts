// React bindings for the document store. The only file in core/ allowed to import React.
// Stores are passed in (the composition root owns them); hooks re-render only on what they read.
import { useCallback, useRef, useSyncExternalStore } from 'react';
import type { DocState, DocStore, Shape, ShapeId } from './types';

/** Whole document state; re-renders on every committed or transient change. Prefer useShape/useChildren. */
export function useDoc(store: DocStore): DocState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

/** One shape record (undefined when missing); re-renders only when that shape changes. */
export function useShape(store: DocStore, id: ShapeId): Shape | undefined {
  const subscribe = useCallback((l: () => void) => store.subscribeShape(id, l), [store, id]);
  const get = useCallback(() => store.getState().shapes.get(id), [store, id]);
  return useSyncExternalStore(subscribe, get, get);
}

const NONE: readonly ShapeId[] = Object.freeze([]);

/** Ordered child ids of a parent (null = root). Identity is stable while the list content is unchanged. */
export function useChildren(store: DocStore, parent: ShapeId | null): readonly ShapeId[] {
  const last = useRef<readonly ShapeId[]>(NONE);
  const get = useCallback(() => {
    const next = store.getState().children.get(parent) ?? NONE;
    const prev = last.current;
    if (next !== prev && (next.length !== prev.length || next.some((id, i) => id !== prev[i]))) last.current = next;
    return last.current;
  }, [store, parent]);
  // children can change on any shape's place/remove, so listen to the whole doc but re-render only on list change
  return useSyncExternalStore(store.subscribe, get, get);
}

/** Generic escape hatch for the other external stores (selection, camera): `useStoreValue(s.subscribe, s.get)`. */
export function useStoreValue<T>(subscribe: (l: () => void) => () => void, get: () => T): T {
  return useSyncExternalStore(subscribe, get, get);
}
