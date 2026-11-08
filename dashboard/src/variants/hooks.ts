// Proportional scroll sync across the comparison panes (vertical and horizontal).
import { useRef } from 'react';

export function useScrollSync(enabled: boolean) {
  const scrollers = useRef(new Map<string, HTMLDivElement>());
  const syncing = useRef(false);
  const onScroll = (key: string) => {
    if (!enabled || syncing.current) return;
    const src = scrollers.current.get(key);
    if (!src) return;
    const ry = src.scrollTop / Math.max(1, src.scrollHeight - src.clientHeight);
    const rx = src.scrollLeft / Math.max(1, src.scrollWidth - src.clientWidth);
    syncing.current = true;
    for (const [k, el] of scrollers.current) {
      if (k === key) continue;
      el.scrollTop = ry * (el.scrollHeight - el.clientHeight);
      el.scrollLeft = rx * (el.scrollWidth - el.clientWidth);
    }
    requestAnimationFrame(() => { syncing.current = false; });
  };
  const scrollRef = (key: string) => (el: HTMLDivElement | null) => {
    if (el) scrollers.current.set(key, el);
    else scrollers.current.delete(key);
  };
  return { scrollRef, onScroll };
}
