// Props contract for inspector sections (PROPS-10, PROPS-28).
//   const sp = useSelectionProps(board);
//   const w = sp.get('w');              // { mixed: false, value } | { mixed: true }
//   sp.set({ w: 200 }, 'Set width');    // one board.exec over every selected shape (one undo entry)
//   const f = useFieldFlash(board, sp, 'fills');   // spread onto the field: className + style (agent edit flash)
// Subscribes per selected shape (store.subscribeShape), never to the whole document.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { BoardKit } from '../../core/commands';
import type { ActorId, Kind, Shape, ShapeId, ShapeProps } from '../../core/types';
import { useSelection } from '../hooks';

export type Mixed<T> = { mixed: false; value: T | undefined } | { mixed: true };
const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/** Common value of `key` across shapes, or { mixed: true } when they differ. Empty list -> undefined value. */
export function mixedValue<K extends keyof ShapeProps>(shapes: readonly Shape[], key: K): Mixed<ShapeProps[K]> {
  if (!shapes.length) return { mixed: false, value: undefined };
  const first = shapes[0]![key];
  return shapes.every((s) => same(s[key], first)) ? { mixed: false, value: first } : { mixed: true };
}

export interface SelectionProps {
  ids: readonly ShapeId[];
  shapes: readonly Shape[];
  kinds: ReadonlySet<Kind>;
  get<K extends keyof ShapeProps>(key: K): Mixed<ShapeProps[K]>;
  /** Apply a patch to every selected shape (one tx, human actor). Returns false when nothing was done. */
  set(patch: Partial<ShapeProps>, label?: string): boolean;
  /** Actor that last wrote `key` (first selected shape), from the LWW stamp. */
  editor(key: keyof ShapeProps): ActorId | null;
}

let opSeq = 0;

/** Shapes of the current selection, re-rendering only when one of them changes. */
function useShapes(board: BoardKit, ids: readonly ShapeId[]): readonly Shape[] {
  const key = ids.join('\u0000');
  const cache = useRef<readonly Shape[]>([]);
  const subscribe = useCallback((l: () => void) => {
    const offs = ids.map((id) => board.doc.subscribeShape(id, l));
    return () => offs.forEach((f) => f());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, key]);
  const get = useCallback(() => {
    const shapes = board.doc.getState().shapes;
    const next = ids.map((id) => shapes.get(id)).filter((s): s is Shape => !!s && !s.deleted);
    const prev = cache.current;
    if (next.length !== prev.length || next.some((s, i) => s !== prev[i])) cache.current = next;
    return cache.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, key]);
  return useSyncExternalStore(subscribe, get, get);
}

export function useSelectionProps(board: BoardKit): SelectionProps {
  const ids = useSelection(board);
  const shapes = useShapes(board, ids);
  const live = shapes.map((s) => s.id);
  const kinds = new Set(shapes.map((s) => s.kind));
  return {
    ids: live,
    shapes,
    kinds,
    get: (key) => mixedValue(shapes, key),
    set(patch, label) {
      if (!live.length) return false;
      const r = board.exec({
        actor: board.me, opId: `insp-${Date.now().toString(36)}-${opSeq++}`,
        commands: [{ t: 'shape.update', ids: live, patch }], label: label ?? 'Edit properties',
      });
      return r.ok;
    },
    editor: (key) => shapes[0]?.stamps[key]?.[1] ?? null,
  };
}

/** Flash for 600ms in the agent's colour when another actor changes `key` of the selection. */
export function useFieldFlash(board: BoardKit, sp: SelectionProps, key: keyof ShapeProps, ms = 600) {
  const value = JSON.stringify(sp.shapes.map((s) => s[key]));
  const prev = useRef(value);
  const [flash, setFlash] = useState<string | null>(null);
  const editor = sp.editor(key);
  useEffect(() => {
    if (prev.current === value) return;
    prev.current = value;
    if (!editor || editor === board.me) return;
    setFlash(board.actors.get(editor)?.color ?? 'var(--pg-accent)');
    const t = setTimeout(() => setFlash(null), ms);
    return () => clearTimeout(t);
  }, [value, editor, board, ms]);
  return {
    className: flash ? 'pg-flash' : '',
    style: flash ? ({ '--insp-flash': flash } as React.CSSProperties) : undefined,
    /** The agent that just changed it (null when not flashing); show as a small dot. */
    agent: flash ? editor : null,
  };
}
