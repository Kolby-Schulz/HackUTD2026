// Toast store (SHELL-24 family). No React: the shell subscribes and renders.
export type ToastVariant = 'info' | 'success' | 'warn' | 'error';
export interface ToastAction { label: string; run: () => void }
export interface Toast { id: number; text: string; variant: ToastVariant; ttlMs: number; at: number; key?: string; action?: ToastAction }
export interface ToastOpts { variant?: ToastVariant; ttlMs?: number; key?: string; onceMs?: number; action?: ToastAction }

const MAX_VISIBLE = 4;

export function createToasts(now: () => number = Date.now) {
  let list: Toast[] = [];
  let nextId = 1;
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  const lastByKey = new Map<string, number>();
  const subs = new Set<() => void>();
  const emit = () => subs.forEach(f => f());

  function dismiss(id: number) {
    const t = timers.get(id);
    if (t) { clearTimeout(t); timers.delete(id); }
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
    const toast: Toast = { id: nextId++, text, variant: o.variant ?? 'info', ttlMs: o.ttlMs ?? 4000, at: t, ...(o.key ? { key: o.key } : {}), ...(o.action ? { action: o.action } : {}) };
    list = [...list, toast].slice(-MAX_VISIBLE);
    if (toast.ttlMs > 0) timers.set(toast.id, setTimeout(() => dismiss(toast.id), toast.ttlMs));
    emit();
    return toast.id;
  }

  return {
    show, dismiss,
    clear() { [...list].forEach(t => dismiss(t.id)); },
    getToasts: (): readonly Toast[] => list,
    subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; },
  };
}

export const toasts = createToasts();
export const toast = toasts.show;
