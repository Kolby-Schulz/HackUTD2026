// Generic windowed list: fixed row height, overscan, imperative scrollToIndex, no dependency.
// Only rows in view (plus overscan) are mounted, each in an absolutely positioned slot inside a spacer.
import { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export const OVERSCAN = 10;

export interface VirtualWindow { start: number; end: number } // end is exclusive

/** Pure: which row indexes to mount for a scroll position. `pinned` indexes are always kept (e.g. a rename input). */
export function computeWindow(count: number, rowHeight: number, scrollTop: number, viewport: number, overscan = OVERSCAN): VirtualWindow {
  if (count <= 0) return { start: 0, end: 0 };
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const last = Math.ceil((Math.max(0, scrollTop) + viewport) / rowHeight);
  return { start: Math.max(0, first - overscan), end: Math.min(count, last + overscan) };
}

/** Pure: the scrollTop that brings row `index` into view (null when it already is, for align 'auto'). */
export function scrollTopFor(
  index: number, rowHeight: number, scrollTop: number, viewport: number, count: number,
  align: 'auto' | 'start' | 'center' = 'auto',
): number | null {
  const i = Math.min(Math.max(0, index), Math.max(0, count - 1));
  const top = i * rowHeight;
  const max = Math.max(0, count * rowHeight - viewport);
  if (align === 'start') return Math.min(top, max);
  if (align === 'center') return Math.min(Math.max(0, top - (viewport - rowHeight) / 2), max);
  if (top < scrollTop) return top;
  if (top + rowHeight > scrollTop + viewport) return Math.min(top + rowHeight - viewport, max);
  return null;
}

export interface VirtualListHandle {
  scrollToIndex(index: number, align?: 'auto' | 'start' | 'center'): void;
  /** The scroll container, for focus or measuring. */
  element(): HTMLDivElement | null;
}

export interface VirtualListProps<T> {
  items: readonly T[];
  rowHeight?: number;
  overscan?: number;
  getKey: (item: T, index: number) => string;
  renderRow: (item: T, index: number) => ReactNode;
  /** Indexes mounted even when scrolled out of the window. */
  pinnedIndexes?: readonly number[];
  /** Viewport height used until the first measurement (and in server rendering). */
  initialHeight?: number;
  className?: string;
  /** Extra keys handled by the parent; PageUp/PageDown/Home/End scroll the list natively. */
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  /** Rendered instead of the list when `items` is empty. */
  empty?: ReactNode;
  'aria-label'?: string;
}

function VirtualListInner<T>(props: VirtualListProps<T>, ref: React.Ref<VirtualListHandle>) {
  const { items, rowHeight = 28, overscan = OVERSCAN, getKey, renderRow, pinnedIndexes, initialHeight = 400, className, onKeyDown, empty } = props;
  const box = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(initialHeight);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setViewport(el.clientHeight || initialHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [initialHeight]);

  // When rows disappear (collapse, filter) the browser clamps scrollTop and fires scroll; mirror it eagerly too.
  const onScroll = useCallback(() => { if (box.current) setScrollTop(box.current.scrollTop); }, []);

  useImperativeHandle(ref, () => ({
    element: () => box.current,
    scrollToIndex(index, align = 'auto') {
      const el = box.current;
      if (!el) return;
      const next = scrollTopFor(index, rowHeight, el.scrollTop, el.clientHeight || viewport, items.length, align);
      if (next !== null) { el.scrollTop = next; setScrollTop(next); }
    },
  }), [rowHeight, viewport, items.length]);

  const { start, end } = computeWindow(items.length, rowHeight, scrollTop, viewport, overscan);
  const indexes: number[] = [];
  for (const p of pinnedIndexes ?? []) if ((p < start || p >= end) && p >= 0 && p < items.length && p < start) indexes.push(p);
  for (let i = start; i < end; i++) indexes.push(i);
  for (const p of pinnedIndexes ?? []) if (p >= end && p < items.length) indexes.push(p);

  return (
    <div ref={box} className={className} onScroll={onScroll} onKeyDown={onKeyDown} role="list" tabIndex={0}
      aria-label={props['aria-label']} aria-rowcount={items.length}
      style={{ overflow: 'auto', position: 'relative' }} data-virtual-list="">
      {items.length === 0 ? empty : (
        <div style={{ height: items.length * rowHeight, position: 'relative' }} data-virtual-spacer="">
          {indexes.map((i) => (
            <div key={getKey(items[i], i)} role="listitem" aria-posinset={i + 1} aria-setsize={items.length}
              style={{ position: 'absolute', top: i * rowHeight, left: 0, right: 0, height: rowHeight }}>
              {renderRow(items[i], i)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export const VirtualList = forwardRef(VirtualListInner) as <T>(
  props: VirtualListProps<T> & { ref?: React.Ref<VirtualListHandle> },
) => ReturnType<typeof VirtualListInner>;
