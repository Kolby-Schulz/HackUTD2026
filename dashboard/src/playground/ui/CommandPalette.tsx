// Slot: CommandPalette (KEYS-9, KEYS-10, KEYS-11). Reads the one action registry; has no command list of its own.
// Opens on the `pg:palette` event (fired by openPalette(), which the `palette.open` action calls). Until that action
// is registered, a fallback Cmd/Ctrl+K listener keeps the palette reachable.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { detectPlatform, getAction, listActions, runAction, shortcutLabels, subscribeActions } from '../core/actions';
import { fuzzyRank } from '../core/fuzzy';
import type { Action } from '../core/types';
import type { SlotProps } from './slotProps';
import '../styles/palette.css';

const OPEN_EVENT = 'pg:palette';
const RECENTS_KEY = 'pg.recents';
const MAX_RECENTS = 5;
const MAX_RESULTS = 50;
const GROUPS = ['Tools', 'Edit', 'View', 'Arrange', 'Share', 'Agents', 'Help'];

/** Open the palette from anywhere (the `palette.open` action calls this). */
export function openPalette() { window.dispatchEvent(new Event(OPEN_EVENT)); }

let memoryRecents: string[] = [];
function loadRecents(): string[] {
  try { const v = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]'); if (Array.isArray(v)) return v.filter(x => typeof x === 'string'); } catch { /* private mode */ }
  return memoryRecents;
}
function saveRecent(id: string) {
  const next = [id, ...loadRecents().filter(x => x !== id)].slice(0, MAX_RECENTS);
  memoryRecents = next;
  try { localStorage.setItem(RECENTS_KEY, JSON.stringify(next)); } catch { /* in-memory fallback */ }
}

interface Row { action: Action; indices: number[]; reason: string | null; recent: boolean }

function disabledReason(a: Action): string | null {
  try { const w = a.when ? a.when() : true; return w === true ? null : (w || 'Unavailable right now'); } catch { return 'Unavailable right now'; }
}

export function buildRows(query: string, actions: readonly Action[], recents: readonly string[]): Row[] {
  const q = query.trim();
  const rec = (id: string) => { const i = recents.indexOf(id); return i < 0 ? 99 : i; };
  const mk = (action: Action, indices: number[], recent: boolean): Row => ({ action, indices, reason: disabledReason(action), recent });
  if (!q) {
    const recentRows = recents.map(id => actions.find(a => a.id === id)).filter((a): a is Action => !!a && a.id !== 'palette.open').map(a => mk(a, [], true));
    const rest = actions.filter(a => a.id !== 'palette.open' && !recents.includes(a.id))
      .sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || a.title.localeCompare(b.title))
      .map(a => mk(a, [], false));
    return [...recentRows, ...rest];
  }
  return fuzzyRank(q, actions.filter(a => a.id !== 'palette.open'), a => [a.title, a.group], (a, b) => rec(a.id) - rec(b.id) || a.title.localeCompare(b.title))
    .slice(0, MAX_RESULTS).map(r => mk(r.item, r.field === 0 ? r.indices : [], false));
}

function Highlight({ text, indices }: { text: string; indices: number[] }) {
  if (!indices.length) return <>{text}</>;
  const set = new Set(indices);
  return <>{[...text].map((ch, i) => set.has(i) ? <mark key={i} className="pg-pal-hit">{ch}</mark> : <Fragment key={i}>{ch}</Fragment>)}</>;
}

export function CommandPalette(_props: SlotProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);
  const [tick, setTick] = useState(0);
  const returnTo = useRef<HTMLElement | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const platform = useMemo(() => detectPlatform(), []);

  useEffect(() => {
    const show = () => {
      setOpen(o => {
        if (!o) { returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setQuery(''); setSel(0); }
        return true;
      });
    };
    // Fallback until `palette.open` is registered; the dispatcher handles Cmd+K itself afterwards.
    const onKey = (e: KeyboardEvent) => {
      if (getAction('palette.open') || e.defaultPrevented || e.isComposing) return;
      const mod = platform === 'mac' ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
      if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') { e.preventDefault(); show(); }
    };
    window.addEventListener(OPEN_EVENT, show);
    window.addEventListener('keydown', onKey, true);
    const unsub = subscribeActions(() => setTick(t => t + 1));
    return () => { window.removeEventListener(OPEN_EVENT, show); window.removeEventListener('keydown', onKey, true); unsub(); };
  }, [platform]);

  useEffect(() => { if (open) input.current?.focus(); }, [open]);

  const rows = useMemo(() => (open ? buildRows(query, listActions(), loadRecents()) : []), [open, query, tick]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setSel(s => Math.min(s, Math.max(rows.length - 1, 0))); }, [rows.length]);
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [sel, rows]);

  function close() {
    setOpen(false);
    const el = returnTo.current;
    returnTo.current = null;
    // Focus returns to the board (or whatever had focus), after the palette unmounts.
    queueMicrotask(() => {
      const target = el && el.isConnected ? el : document.querySelector<HTMLElement>('[data-pg-ctx="canvas"]');
      target?.focus?.({ preventScroll: true });
    });
  }

  function run(row: Row | undefined) {
    if (!row || row.reason) return;                           // disabled rows only show their reason
    const id = row.action.id;
    saveRecent(id);
    close();
    setTimeout(() => { runAction(id); }, 0);                  // after focus is back on the board
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.nativeEvent.isComposing) return;
    const mod = platform === 'mac' ? e.metaKey : e.ctrlKey;
    if (e.key === 'Escape' || (mod && e.key.toLowerCase() === 'k')) { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => (rows.length ? (s + 1) % rows.length : 0)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => (rows.length ? (s - 1 + rows.length) % rows.length : 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); run(rows[sel]); }
    else if (e.key === 'Tab') e.preventDefault();
  }

  if (!open) return null;
  let lastHeader = '';
  return (
    <div className="pg-pal-scrim" onPointerDown={e => { if (e.target === e.currentTarget) close(); }}>
      <div className="pg-pal" data-pg-ctx="palette" role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={onKeyDown}>
        <input ref={input} className="pg-pal-input" role="combobox" aria-expanded="true" aria-controls="pg-pal-list" aria-activedescendant={rows[sel] ? `pg-pal-${rows[sel].action.id}` : undefined}
          placeholder="Type a command…" value={query} onChange={e => { setQuery(e.target.value); setSel(0); }} spellCheck={false} autoComplete="off" />
        <div className="pg-pal-list" id="pg-pal-list" role="listbox" ref={list}>
          {rows.length === 0 && <div className="pg-pal-empty">No matching commands</div>}
          {rows.map((r, i) => {
            const header = query.trim() ? '' : r.recent ? 'Recent' : r.action.group;
            const showHeader = header !== '' && header !== lastHeader;
            if (header) lastHeader = header;
            const keys = shortcutLabels(r.action, platform);
            return (
              <Fragment key={r.action.id}>
                {showHeader && <div className="pg-pal-head">{header}</div>}
                <div id={`pg-pal-${r.action.id}`} role="option" aria-selected={i === sel} aria-disabled={!!r.reason}
                  className="pg-pal-row" data-sel={i === sel} data-disabled={!!r.reason}
                  onPointerMove={() => setSel(i)} onClick={() => run(r)}>
                  <span className="pg-pal-title"><Highlight text={r.action.title} indices={r.indices} />
                    {query.trim() && <span className="pg-pal-group">{r.action.group}</span>}</span>
                  {r.reason ? <span className="pg-pal-reason">{r.reason}</span>
                    : keys.length > 0 && <span className="pg-pal-keys">{keys.map(k => <kbd key={k}>{k}</kbd>)}</span>}
                </div>
              </Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}
