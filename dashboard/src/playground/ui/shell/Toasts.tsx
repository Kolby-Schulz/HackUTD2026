// Renders the toast queue from core/toast (call `toast('text')` from anywhere).
// Bottom-centre stack, newest at the bottom, max 3 visible, same text+variant collapsed to one.
// Hovering the stack holds toasts on screen even after the store's timer has dropped them.
import { useReducer, useRef, useState } from 'react';
import { toasts } from '../../core/toast';
import type { Toast } from '../../core/toast';
import { useStoreValue } from '../../core/react';
import '../../styles/toasts.css';

export const MAX_SHOWN = 3;

/** Optional action button; the store has no field for it yet (see report), so read it structurally. */
type WithAction = Toast & { action?: { label: string; run: () => void } };

/** Collapse repeats (keep the newest) and keep only the last `max`, oldest first. */
export function visibleToasts(list: readonly Toast[], max = MAX_SHOWN): Toast[] {
  const seen = new Set<string>();
  const out: Toast[] = [];
  for (let i = list.length - 1; i >= 0; i--) {
    const k = `${list[i].variant}\u0000${list[i].text}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.unshift(list[i]);
  }
  return out.slice(-max);
}

/** While held (hover), toasts the store already dropped stay in the stack. */
export function mergeHeld(held: readonly Toast[], live: readonly Toast[]): Toast[] {
  const ids = new Set(live.map((t) => t.id));
  return [...held.filter((t) => !ids.has(t.id)), ...live].sort((a, b) => a.id - b.id);
}

export function Toasts() {
  const live = useStoreValue(toasts.subscribe, toasts.getToasts);
  const [hover, setHover] = useState(false);
  const held = useRef<Toast[]>([]);
  const [, bump] = useReducer((n: number) => n + 1, 0);

  const all = hover ? mergeHeld(held.current, live) : [...live];
  held.current = all;
  const shown = visibleToasts(all);
  if (!shown.length) return null;

  const close = (id: number) => {
    held.current = held.current.filter((t) => t.id !== id);
    toasts.dismiss(id);
    bump();
  };

  return (
    <div className="pg-toasts" role="status" aria-live="polite" data-pg-ui
      onMouseEnter={() => { setHover(true); shown.forEach((t) => toasts.pause(t.id)); }}
      onMouseLeave={() => { setHover(false); shown.forEach((t) => toasts.resume(t.id)); }}>
      {shown.map((t) => {
        const a = (t as WithAction).action;
        return (
          <div key={t.id} className={`pg-toast ${t.variant}`} role={t.variant === 'error' ? 'alert' : undefined}>
            <span className="pg-toast-text">{t.text}</span>
            {a && <button className="pg-toast-act" onClick={() => { a.run(); close(t.id); }}>{a.label}</button>}
            <button className="pg-toast-x" aria-label="Dismiss" onClick={() => close(t.id)}>{'×'}</button>
          </div>
        );
      })}
    </div>
  );
}
