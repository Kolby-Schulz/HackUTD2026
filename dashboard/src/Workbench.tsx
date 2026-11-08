// The whole dashboard on one screen, laid out like an editor workbench: title bar,
// Agents side bar, Code map editor, bottom panel (Savings / Problems), Chat, status bar.
// The side bar, chat and panel resize by dragging their edge and collapse like VS Code: drag
// past the minimum, double-click the edge, press Enter on it, or use the title bar buttons.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

export type PaneId = 'side' | 'chat' | 'panel';
interface Layout { size: Record<PaneId, number>; open: Record<PaneId, boolean> }

const DEFAULT: Layout = { size: { side: 290, chat: 380, panel: 230 }, open: { side: true, chat: true, panel: true } };
const MIN: Record<PaneId, number> = { side: 220, chat: 280, panel: 130 };
const MAX: Record<PaneId, number> = { side: 560, chat: 680, panel: 600 };
const KEY = 'insync.workbench.layout';

function load(): Layout {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Layout | null;
    if (raw?.size && raw.open) return { size: { ...DEFAULT.size, ...raw.size }, open: { ...DEFAULT.open, ...raw.open } };
  } catch { /* no storage: defaults are fine */ }
  return DEFAULT;
}

export function useLayout() {
  const [layout, setLayout] = useState<Layout>(load);
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(layout)); } catch { /* private window */ }
  }, [layout]);
  const resize = useCallback((p: PaneId, px: number) => setLayout((l) => {
    // dragging well below the minimum collapses the pane, like VS Code
    if (px < MIN[p] * 0.6) return { ...l, open: { ...l.open, [p]: false } };
    return { size: { ...l.size, [p]: Math.round(Math.min(MAX[p], Math.max(MIN[p], px))) }, open: { ...l.open, [p]: true } };
  }), []);
  const toggle = useCallback((p: PaneId, on?: boolean) => setLayout((l) => ({ ...l, open: { ...l.open, [p]: on ?? !l.open[p] } })), []);
  return { layout, resize, toggle };
}

/** A draggable edge between two panes. `sign` is +1 when dragging right/down grows the pane. */
export function Sash({ dir, label, size, sign, onSize, onToggle }: {
  dir: 'v' | 'h'; label: string; size: number; sign: 1 | -1; onSize: (px: number) => void; onToggle: () => void;
}) {
  const start = useRef<{ pos: number; size: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const pos = (e: React.PointerEvent) => (dir === 'v' ? e.clientX : e.clientY);
  return (
    <div
      className={`sash ${dir}${dragging ? ' dragging' : ''}`}
      role="separator" aria-orientation={dir === 'v' ? 'vertical' : 'horizontal'} aria-label={label} aria-valuenow={size}
      tabIndex={0} title="Drag to resize · double-click to collapse"
      onPointerDown={(e) => {
        e.preventDefault(); // no text selection while dragging; focus the edge for the keyboard instead
        e.currentTarget.focus();
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { pos: pos(e), size };
        setDragging(true);
        document.querySelector('.wb')?.classList.add('resizing');
      }}
      onPointerMove={(e) => { if (start.current) onSize(start.current.size + sign * (pos(e) - start.current.pos)); }}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        start.current = null;
        setDragging(false);
        document.querySelector('.wb')?.classList.remove('resizing');
      }}
      onDoubleClick={onToggle}
      onKeyDown={(e) => {
        const grow: Record<string, number> = dir === 'v' ? { ArrowRight: 1, ArrowLeft: -1 } : { ArrowDown: 1, ArrowUp: -1 };
        const step = grow[e.key];
        if (step) { e.preventDefault(); onSize(size + sign * step * 16); }
        if (e.key === 'Enter') { e.preventDefault(); onToggle(); }
      }}
    />
  );
}

export const ICON = {
  agents: <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.7" /><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M16 4.8a3.4 3.4 0 0 1 0 6.4M18.5 14.8c1.6.8 2.6 2.6 3 5.2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>,
  map: <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="6" height="5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.7" /><rect x="15" y="4" width="6" height="5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.7" /><rect x="9" y="15" width="6" height="5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.7" /><path d="M6 9v3h12V9M12 12v3" fill="none" stroke="currentColor" strokeWidth="1.7" /></svg>,
  chat: <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11h-9l-4.5 3.5V16H4z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>,
  panel: <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4" width="17" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="1.7" /><path d="M3.5 14.5h17" stroke="currentColor" strokeWidth="1.7" /><path d="M7 17.5h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>,
  chevron: <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>,
  close: <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>,
};

/** One collapsible pane with a head row and a close button, like a VS Code view container. */
export function PaneHead({ title, children, onClose }: { title: string; children?: ReactNode; onClose: () => void }) {
  return (
    <div className="pane-head">
      <span className="hd grow">{title}</span>
      {children}
      <button type="button" className="iconbtn" aria-label={`Hide ${title.toLowerCase()}`} title="Hide" onClick={onClose}>{ICON.close}</button>
    </div>
  );
}
