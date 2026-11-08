// Slot: ContextMenu (SHELL-10). One menu built from the action registry (core/actions.ts): titles, shortcut labels and
// disabled reasons all come from the registry. The slot listens for `contextmenu` itself (no seam in Board needed):
// right-click on the board (.pg-view) or a layer row ([data-layer]) opens it; text inputs keep the native menu.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Action } from '../../core/types';
import { getAction, shortcutLabels, runAction } from '../../core/actions';
import { hitTest } from '../../core/hittest';
import { toast } from '../../core/toast';
import { activeBoard, selectIds, selectedIds } from '../board/state';
import type { SlotProps } from '../slotProps';
import '../../styles/menus.css';

export type MenuKind = 'layer' | 'canvas';
/** Registry ids per menu; '-' is a separator. */
export const MENU_IDS: Record<MenuKind, string[]> = {
  layer: [
    'clipboard.cut', 'clipboard.copy', 'clipboard.pasteInPlace', 'edit.duplicate', '-',
    'arrange.front', 'arrange.forward', 'arrange.backward', 'arrange.back', '-',
    'arrange.group', 'arrange.ungroup', 'layers.lock', 'layers.hide', '-',
    'share.exportPng', '-', 'edit.delete',
  ],
  canvas: ['clipboard.paste', 'edit.selectAll', '-', 'view.zoomFit', 'view.zoomSelection'],
};

export interface MenuEntry { sep?: true; id?: string; title?: string; keys?: string; disabled?: string; danger?: boolean; action?: Action }

/** Resolve registry ids to entries: missing actions are dropped, `when()` strings become the disabled reason. */
export function buildEntries(ids: readonly string[], get: (id: string) => Action | undefined = getAction, labels: (a: Action) => string[] = shortcutLabels): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const id of ids) {
    if (id === '-') { if (out.length && !out[out.length - 1].sep) out.push({ sep: true }); continue; }
    const a = get(id);
    if (!a) continue;
    const w = a.when ? a.when() : true;
    out.push({ id, title: a.title, keys: labels(a)[0] ?? '', disabled: w === true ? undefined : w, danger: id === 'edit.delete', action: a });
  }
  while (out.length && out[out.length - 1].sep) out.pop();
  return out;
}

/** Keep a w x h box inside the viewport; flip to the other side of the pointer when it would overflow. */
export function placeMenu(x: number, y: number, w: number, h: number, vw: number, vh: number, m = 8): { left: number; top: number } {
  let left = x + w + m > vw ? x - w : x;
  let top = y + h + m > vh ? y - h : y;
  left = Math.max(m, Math.min(left, vw - w - m));
  top = Math.max(m, Math.min(top, vh - h - m));
  return { left, top };
}

/** Next enabled-or-not item index with wraparound (disabled items stay focusable so the reason can be read). */
export function stepIndex(cur: number, n: number, dir: 1 | -1): number {
  return n <= 0 ? -1 : cur < 0 ? (dir === 1 ? 0 : n - 1) : (cur + dir + n) % n;
}

/** Typeahead: first item after `cur` whose title starts with `q`. */
export function typeahead(titles: readonly string[], cur: number, q: string): number {
  const s = q.toLowerCase();
  for (let k = 1; k <= titles.length; k++) {
    const i = (cur + k) % titles.length;
    if (titles[i].toLowerCase().startsWith(s)) return i;
  }
  return -1;
}

interface Open { x: number; y: number; kind: MenuKind; entries: MenuEntry[] }
const TEXT_SEL = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role=textbox]';

function openFor(target: Element, cx: number, cy: number, viaKey: boolean): Open | null {
  const env = activeBoard();
  if (!env) return null;
  const board = env.board;
  const row = target.closest<HTMLElement>('[data-layer]');
  let id: string | null = row ? row.getAttribute('data-layer') : null;
  if (!row) {
    if (!target.closest('.pg-view')) return null;
    if (!viaKey) {
      const world = env.camera.toWorld(cx, cy);
      id = hitTest(board.doc.getState(), board.index, world, { z: env.camera.getCam().z, deep: false });
    }
  }
  // right-clicking a shape selects it first unless it is already part of the selection
  if (id && !selectedIds(board).includes(id)) selectIds(board, [id]);
  const kind: MenuKind = id || (viaKey && selectedIds(board).length) ? 'layer' : 'canvas';
  return { x: cx, y: cy, kind, entries: buildEntries(MENU_IDS[kind]) };
}

export function ContextMenu(_props: SlotProps) {
  const [open, setOpen] = useState<Open | null>(null);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const typed = useRef({ q: '', t: 0 });

  const close = (restore = false) => {
    setOpen(null); setPos(null);
    if (restore && opener.current?.isConnected) opener.current.focus();
  };

  // global triggers
  useEffect(() => {
    const onCtx = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (!t || !t.closest || !t.closest('.pg') || t.closest('.pg-ctxmenu') || t.closest(TEXT_SEL)) return;
      const o = openFor(t, e.clientX, e.clientY, false);
      if (!o) { setOpen(null); return; }
      e.preventDefault();
      opener.current = document.activeElement as HTMLElement | null;
      setActive(0); setPos(null); setOpen(o);
    };
    const onKey = (e: KeyboardEvent) => {
      if (!(e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey))) return;
      const t = document.activeElement as Element | null;
      if (!t || !t.closest || t.closest(TEXT_SEL)) return;
      const env = activeBoard();
      const view = document.querySelector('.pg-view');
      if (!env || !view) return;
      const r = view.getBoundingClientRect();
      const o = openFor(view, r.left + (env.pointer.inside ? env.pointer.x : 24), r.top + (env.pointer.inside ? env.pointer.y : 24), true);
      if (!o) return;
      e.preventDefault();
      opener.current = t as HTMLElement;
      setActive(0); setPos(null); setOpen(o);
    };
    document.addEventListener('contextmenu', onCtx);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('contextmenu', onCtx); document.removeEventListener('keydown', onKey); };
  }, []);

  // measure + clamp inside the viewport, then focus the menu
  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos(placeMenu(open.x, open.y, r.width, r.height, window.innerWidth, window.innerHeight));
    ref.current.focus();
  }, [open]);

  // close on outside press, scroll, resize, blur
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    const away = () => close();
    document.addEventListener('pointerdown', down, true);
    window.addEventListener('resize', away);
    window.addEventListener('blur', away);
    document.addEventListener('scroll', away, true);
    document.addEventListener('wheel', away, { passive: true, capture: true });
    return () => {
      document.removeEventListener('pointerdown', down, true);
      window.removeEventListener('resize', away);
      window.removeEventListener('blur', away);
      document.removeEventListener('scroll', away, true);
      document.removeEventListener('wheel', away, true);
    };
  }, [open]);

  if (!open) return null;
  const items = open.entries.filter((e) => !e.sep);
  const run = (en: MenuEntry) => {
    if (en.disabled) { toast(en.disabled, { key: `when:${en.id}`, onceMs: 3000 }); return; }
    close(true);
    const res = runAction(en.id!);
    if (res !== true) toast(res, { key: `when:${en.id}`, onceMs: 3000 });
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const k = e.key;
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    if (k === 'Escape') { stop(); close(true); }
    else if (k === 'ArrowDown') { stop(); setActive((a) => stepIndex(a, items.length, 1)); }
    else if (k === 'ArrowUp') { stop(); setActive((a) => stepIndex(a, items.length, -1)); }
    else if (k === 'Home') { stop(); setActive(0); }
    else if (k === 'End') { stop(); setActive(items.length - 1); }
    else if (k === 'Enter' || k === ' ') { stop(); if (items[active]) run(items[active]); }
    else if (k === 'Tab') { stop(); close(true); }
    else if (k.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const now = Date.now();
      typed.current = { q: now - typed.current.t < 700 ? typed.current.q + k : k, t: now };
      const i = typeahead(items.map((x) => x.title ?? ''), active, typed.current.q);
      if (i >= 0) { stop(); setActive(i); }
    }
  };

  let n = -1;
  return (
    <div ref={ref} className="pg-ctxmenu" role="menu" tabIndex={-1} data-pg-ctx="palette" aria-label={open.kind === 'layer' ? 'Layer menu' : 'Canvas menu'}
      style={{ left: pos?.left ?? open.x, top: pos?.top ?? open.y, visibility: pos ? 'visible' : 'hidden' }}
      onKeyDown={onKeyDown} onContextMenu={(e) => e.preventDefault()}>
      {open.entries.map((en, i) => {
        if (en.sep) return <div key={`s${i}`} className="pg-ctxmenu-sep" role="separator" />;
        const idx = ++n;
        return (
          <div key={en.id} role="menuitem" className="pg-ctxmenu-item" aria-disabled={en.disabled ? true : undefined}
            data-active={idx === active} data-danger={en.danger || undefined} title={en.disabled}
            onMouseEnter={() => setActive(idx)} onClick={() => run(en)}>
            <span className="pg-ctxmenu-title">{en.title}</span>
            <span className="pg-ctxmenu-keys">{en.disabled ? en.disabled : en.keys}</span>
          </div>
        );
      })}
    </div>
  );
}
