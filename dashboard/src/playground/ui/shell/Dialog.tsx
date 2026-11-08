// Slot: Dialog (SHELL-28). A small accessible modal pattern plus an imperative helper:
//   const ok = await confirm({ title: 'Delete 12 layers?', body: '...', confirmLabel: 'Delete 12 layers', destructive: true });
// Stacked dialogs: only the top one responds to Esc and Tab. Esc / scrim click cancel unless `blocking`.
// The root carries data-pg-ctx="dialog" so canvas shortcuts do not fire while it is open.
import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { SlotProps } from '../slotProps';
import '../../styles/menus.css';

export interface ConfirmOpts {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button; focus starts on Cancel so Enter cannot destroy by accident. */
  destructive?: boolean;
  /** No Esc / scrim dismissal: the user must pick a button. */
  blocking?: boolean;
}
interface Entry extends ConfirmOpts { id: number; resolve: (ok: boolean) => void }

// ---- store (module level so any code can call confirm()) ----
let stack: Entry[] = [];
let nextId = 1;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const snapshot = () => stack;

/** Open a confirm dialog. Resolves true on confirm, false on cancel / Esc / scrim click. */
export function confirm(opts: ConfirmOpts): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    stack = [...stack, { ...opts, id: nextId++, resolve }];
    emit();
  });
}

function settle(id: number, ok: boolean) {
  const e = stack.find((x) => x.id === id);
  if (!e) return;
  stack = stack.filter((x) => x.id !== id);
  emit();
  e.resolve(ok);
}

/** Cancel every open dialog (board unmount). */
export function closeAllDialogs() { for (const e of [...stack]) settle(e.id, false); }

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Next focus index when Tab is pressed inside a trap of `n` items (current -1 = outside). */
export function trapIndex(current: number, n: number, shift: boolean): number {
  if (n <= 0) return -1;
  if (current < 0) return shift ? n - 1 : 0;
  return shift ? (current - 1 + n) % n : (current + 1) % n;
}

function DialogView({ entry, top }: { entry: Entry; top: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  const titleId = `pg-dlg-title-${entry.id}`;
  const bodyId = `pg-dlg-body-${entry.id}`;

  // remember the opener, focus the safe button, return focus on close
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    (entry.destructive ? cancelRef.current : okRef.current)?.focus();
    return () => { if (opener && opener.isConnected) opener.focus(); };
  }, [entry.destructive]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!top) return;
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      if (!entry.blocking) settle(entry.id, false);
    } else if (e.key === 'Tab') {
      const items = Array.from(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      const next = trapIndex(items.indexOf(document.activeElement as HTMLElement), items.length, e.shiftKey);
      if (next >= 0) { e.preventDefault(); items[next].focus(); }
    }
  };

  return (
    <div className="pg-dlg-scrim" data-top={top} aria-hidden={!top || undefined}
      onMouseDown={(e) => { if (e.target === e.currentTarget && top && !entry.blocking) settle(entry.id, false); }}>
      <div ref={ref} className="pg-dlg" role="dialog" aria-modal="true" data-pg-ctx="dialog"
        aria-labelledby={titleId} aria-describedby={entry.body ? bodyId : undefined} onKeyDown={onKeyDown}>
        <h2 id={titleId} className="pg-dlg-title">{entry.title}</h2>
        {entry.body && <div id={bodyId} className="pg-dlg-body">{entry.body}</div>}
        <div className="pg-dlg-actions">
          <button ref={cancelRef} type="button" className="pg-dlg-btn" onClick={() => settle(entry.id, false)}>{entry.cancelLabel ?? 'Cancel'}</button>
          <button ref={okRef} type="button" className="pg-dlg-btn pg-dlg-primary" data-destructive={entry.destructive || undefined}
            onClick={() => settle(entry.id, true)}>{entry.confirmLabel ?? 'OK'}</button>
        </div>
      </div>
    </div>
  );
}

export function Dialog(_props: SlotProps) {
  const list = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => closeAllDialogs, []);
  if (!list.length) return null;
  return <>{list.map((e, i) => <DialogView key={e.id} entry={e} top={i === list.length - 1} />)}</>;
}
