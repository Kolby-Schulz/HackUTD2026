// Toast store (SHELL-24 family). No React: the shell subscribes and renders.
export type ToastVariant = 'info' | 'success' | 'warn' | 'error';
export interface ToastAction { label: string; run: () => void }
export interface Toast { id: number; text: string; variant: ToastVariant; ttlMs: number; at: number; key?: string; action?: ToastAction; sticky?: boolean }
/** `sticky`: no auto-dismiss; the toast stays until dismissed (or replaced out of the visible stack). */
export interface ToastOpts { variant?: ToastVariant; ttlMs?: number; key?: string; onceMs?: number; action?: ToastAction; sticky?: boolean }

const MAX_VISIBLE = 4;

export function createToasts(now: () => number = Date.now) {
  let list: Toast[] = [];
  let nextId = 1;
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  const due = new Map<number, number>();        // when each running timer fires
  const paused = new Map<number, number>();     // ms left for toasts whose timer is paused (hover)
  const lastByKey = new Map<string, number>();
  const subs = new Set<() => void>();
  const emit = () => subs.forEach(f => f());

  function dismiss(id: number) {
    const t = timers.get(id);
    if (t) { clearTimeout(t); timers.delete(id); }
    due.delete(id); paused.delete(id);
    const next = list.filter(x => x.id !== id);
    if (next.length !== list.length) { list = next; emit(); }
  }

  /** Show a toast. With `key` + `onceMs`, repeats inside the window are dropped ("View only" at most once per 5s). */
  function show(text: string, o: ToastOpts = {}): number | null {
    const t = now();
    if (o.key) {
      const last = lastByKey.get(o.key);
      if (o.onceMs && last !== undefined && t - last < o.onceMs) return null;
      lastByKey.set(o.key, t);
    }
    const toast: Toast = { id: nextId++, text, variant: o.variant ?? 'info', ttlMs: o.sticky ? 0 : (o.ttlMs ?? 4000), at: t, ...(o.sticky ? { sticky: true } : {}), ...(o.key ? { key: o.key } : {}), ...(o.action ? { action: o.action } : {}) };
    list = [...list, toast].slice(-MAX_VISIBLE);
    if (toast.ttlMs > 0) arm(toast.id, toast.ttlMs);
    emit();
    return toast.id;
  }

  function arm(id: number, ms: number) {
    timers.set(id, setTimeout(() => dismiss(id), ms));
    due.set(id, now() + ms);
  }
  /** Hover: stop the countdown, remembering what was left. No-op for sticky or unknown toasts. */
  function pause(id: number) {
    const t = timers.get(id);
    if (t === undefined) return;
    clearTimeout(t); timers.delete(id);
    paused.set(id, Math.max(0, (due.get(id) ?? now()) - now()));
  }
  /** Pointer left: restart the countdown with the time that was left (at least 1s so it can be read). */
  function resume(id: number) {
    const left = paused.get(id);
    if (left === undefined) return;
    paused.delete(id);
    arm(id, Math.max(left, 1000));
  }

  return {
    show, dismiss, pause, resume,
    clear() { [...list].forEach(t => dismiss(t.id)); },
    getToasts: (): readonly Toast[] => list,
    subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; },
  };
}

export const toasts = createToasts();
export const toast = toasts.show;
