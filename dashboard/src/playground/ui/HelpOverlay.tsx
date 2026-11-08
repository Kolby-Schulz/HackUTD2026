// Slot: HelpOverlay (KEYS-8). Shortcut cheat sheet built only from the action registry: every action with a
// binding on this platform appears once, grouped by area, filterable. `?` (action help.shortcuts) toggles it.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { bindingsFor, detectPlatform, listActions, shortcutLabels, subscribeActions, type Platform } from '../core/actions';
import type { Action } from '../core/types';
import type { SlotProps } from './slotProps';
import { useReducedMotion } from './shell/Tooltip';

// ---- open state (module level so the help.shortcuts action can drive it) ----
let open = false;
const subs = new Set<() => void>();
const set = (v: boolean) => { if (open !== v) { open = v; subs.forEach((f) => f()); } };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const openHelp = () => set(true);
export const closeHelp = () => set(false);
export const toggleHelp = () => set(!open);
export const isHelpOpen = () => open;

const GROUP_ORDER: Action['group'][] = ['Tools', 'Edit', 'View', 'Arrange', 'Share', 'Agents', 'Help'];

export interface HelpGroup { group: Action['group']; rows: { id: string; title: string; keys: string[] }[] }

/** Pure: actions that have a binding on `platform`, filtered by `query` (title, group or key label), grouped in display order. */
export function helpGroups(list: readonly Action[], platform: Platform, query = ''): HelpGroup[] {
  const q = query.trim().toLowerCase();
  const out: HelpGroup[] = [];
  for (const group of GROUP_ORDER) {
    const rows = list
      .filter((a) => a.group === group && bindingsFor(a, platform).length > 0)
      .map((a) => ({ id: a.id, title: a.title, keys: shortcutLabels(a, platform) }))
      .filter((r) => !q || group.toLowerCase().includes(q) || r.title.toLowerCase().includes(q) || r.keys.some((k) => k.toLowerCase().includes(q)));
    if (rows.length) out.push({ group, rows });
  }
  return out;
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function HelpOverlay(_props: SlotProps) {
  const isOpen = useSyncExternalStore(subscribe, isHelpOpen, () => false);
  useEffect(() => closeHelp, []);          // board unmount
  return isOpen ? <Sheet /> : null;
}

function Sheet() {
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const reduced = useReducedMotion();
  const actions = useSyncExternalStore(subscribeActions, listActions, listActions);
  const platform = useMemo(() => detectPlatform(), []);
  const groups = useMemo(() => helpGroups(actions, platform, query), [actions, platform, query]);

  // focus the filter, give focus back to whatever had it (the board) on close
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => {
      if (opener && opener.isConnected) opener.focus();
      else document.querySelector<HTMLElement>('[data-pg-ctx="canvas"]')?.focus();
    };
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' || (e.key === '?' && e.target !== inputRef.current)) { e.preventDefault(); e.stopPropagation(); closeHelp(); }
    else if (e.key === 'Tab') {
      const items = Array.from(rootRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      if (!items.length) return;
      const i = items.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i < 0 || i === items.length - 1 ? 0 : i + 1);
      e.preventDefault(); items[next].focus();
    }
  };

  return (
    <div onMouseDown={(e) => { if (e.target === e.currentTarget) closeHelp(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 70, display: 'grid', placeItems: 'center', padding: 16, background: 'var(--pg-scrim)', pointerEvents: 'auto' }}>
      <div ref={rootRef} role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" data-pg-ctx="dialog" onKeyDown={onKeyDown}
        style={{ width: 'min(760px, 100%)', maxHeight: 'min(640px, 100%)', display: 'flex', flexDirection: 'column', background: 'var(--pg-panel)', color: 'var(--pg-ink-body)', border: '1px solid var(--pg-line)', borderRadius: 14, boxShadow: 'var(--pg-shadow-pop)', overflow: 'hidden', transition: reduced ? 'none' : undefined }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--pg-line)' }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--pg-ink)', flex: 'none' }}>Keyboard shortcuts</h2>
          <input ref={inputRef} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter shortcuts" aria-label="Filter shortcuts"
            style={{ flex: 1, minWidth: 0, height: 30, padding: '0 10px', border: '1px solid var(--pg-line)', borderRadius: 8, background: 'var(--pg-sunken)', color: 'var(--pg-ink)', font: 'inherit', fontSize: 13 }} />
          <button type="button" onClick={closeHelp} aria-label="Close"
            style={{ flex: 'none', width: 28, height: 28, border: 0, borderRadius: 6, background: 'none', color: 'var(--pg-muted)', fontSize: 16, cursor: 'pointer' }}>×</button>
        </div>
        <div role="table" aria-label="Shortcuts" style={{ overflowY: 'auto', padding: '8px 16px 16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '4px 28px', alignContent: 'start' }}>
          {groups.length === 0 && <div role="row" style={{ gridColumn: '1 / -1', padding: '24px 0', textAlign: 'center', color: 'var(--pg-muted)', fontSize: 13 }}>No shortcuts match "{query}"</div>}
          {groups.map((g) => (
            <div key={g.group} role="rowgroup" aria-label={g.group} style={{ paddingTop: 8 }}>
              <div role="row"><span role="columnheader" style={{ display: 'block', margin: '4px 0', fontSize: 11, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--pg-muted)' }}>{g.group}</span></div>
              {g.rows.map((r) => (
                <div key={r.id} role="row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '4px 0', fontSize: 13 }}>
                  <span role="cell">{r.title}</span>
                  <span role="cell" style={{ display: 'flex', gap: 4, flex: 'none' }}>
                    {r.keys.map((k) => <kbd key={k} style={{ font: 'inherit', fontSize: 11, padding: '1px 6px', borderRadius: 4, border: '1px solid var(--pg-line)', background: 'var(--pg-sunken)', color: 'var(--pg-ink-soft)' }}>{k}</kbd>)}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
