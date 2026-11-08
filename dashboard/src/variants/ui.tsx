// Small accessible building blocks for #/variants: a popover menu and a modal dialog.
// Menus are position: fixed under their trigger so scrolling panels never clip them.
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

const ITEMS = '[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"]';

export function Menu(p: {
  label: string;
  trigger: ReactNode;
  className?: string;
  align?: 'left' | 'right';
  /** Popover content: MenuItem / MenuSep / MenuLabel, or free content for a help card. */
  children: ReactNode | ((close: () => void) => ReactNode);
  role?: 'menu' | 'dialog';
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number }>({ top: 0 });
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const role = p.role ?? 'menu';
  const close = (refocus = true) => { setOpen(false); if (refocus) btn.current?.focus(); };

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    setPos(p.align === 'left' ? { top: r.bottom + 4, left: r.left } : { top: r.bottom + 4, right: window.innerWidth - r.right });
    pop.current?.querySelector<HTMLElement>(ITEMS + ',button,input')?.focus();
  }, [open, p.align]);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (!pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) close(false);
    };
    const resize = () => close(false);
    window.addEventListener('mousedown', down);
    window.addEventListener('resize', resize);
    return () => { window.removeEventListener('mousedown', down); window.removeEventListener('resize', resize); };
  }, [open]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
    if (role !== 'menu' || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    const items = [...(pop.current?.querySelectorAll<HTMLElement>(ITEMS) ?? [])].filter((el) => !el.hasAttribute('disabled'));
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    e.preventDefault();
  };

  return (
    <>
      <button
        ref={btn}
        className={p.className ?? 'vx-iconbtn'}
        aria-label={p.label}
        title={p.label}
        aria-haspopup={role}
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
      >
        {p.trigger}
      </button>
      {open && (
        <div ref={pop} className={`vx-menu${role === 'dialog' ? ' card' : ''}`} role={role} aria-label={p.label} style={pos} onKeyDown={onKey} onClick={(e) => e.stopPropagation()}>
          {typeof p.children === 'function' ? p.children(() => close()) : p.children}
        </div>
      )}
    </>
  );
}

export function MenuItem(p: {
  onSelect: () => void; children: ReactNode; checked?: boolean; kind?: 'radio' | 'check'; danger?: boolean; disabled?: boolean; hint?: string; close?: () => void;
}) {
  const role = p.kind === 'radio' ? 'menuitemradio' : p.kind === 'check' ? 'menuitemcheckbox' : 'menuitem';
  return (
    <button
      role={role}
      aria-checked={p.kind ? !!p.checked : undefined}
      disabled={p.disabled}
      className={`vx-menuitem${p.danger ? ' danger' : ''}`}
      onClick={() => { p.onSelect(); p.close?.(); }}
    >
      <span className="vx-menucheck" aria-hidden="true">{p.kind && p.checked ? '✓' : ''}</span>
      <span className="vx-grow">{p.children}</span>
      {p.hint && <kbd>{p.hint}</kbd>}
    </button>
  );
}

export const MenuSep = () => <div className="vx-menusep" role="separator" />;
export const MenuLabel = ({ children }: { children: ReactNode }) => <div className="vx-menulabel">{children}</div>;

/** Modal dialog: labelled, traps Tab inside, closes on Escape or scrim click, restores focus. */
export function Dialog(p: { heading: string; onClose: () => void; children: ReactNode; width?: number }) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = box.current?.querySelector<HTMLElement>('[autofocus],input,textarea,button');
    first?.focus();
    return () => prev?.focus?.();
  }, []);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); p.onClose(); return; }
    if (e.key !== 'Tab' || !box.current) return;
    const f = [...box.current.querySelectorAll<HTMLElement>('input,textarea,button,select,[tabindex]:not([tabindex="-1"])')].filter((el) => !el.hasAttribute('disabled'));
    if (!f.length) return;
    const [a, z] = [f[0], f[f.length - 1]];
    if (e.shiftKey && document.activeElement === a) { z.focus(); e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === z) { a.focus(); e.preventDefault(); }
  };
  return (
    <div className="vx-modal" onMouseDown={(e) => { if (e.target === e.currentTarget) p.onClose(); }}>
      <div ref={box} className="vx-dialog" role="dialog" aria-modal="true" aria-labelledby={id} onKeyDown={onKey} style={p.width ? { width: `min(${p.width}px, 100%)` } : undefined}>
        <h3 id={id}>{p.heading}</h3>
        {p.children}
      </div>
    </div>
  );
}
