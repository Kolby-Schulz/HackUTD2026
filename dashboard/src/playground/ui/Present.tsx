// Slot: Present (SHARE-11). Renders the click-catcher + "2 / 5" counter while presenting, handles keys,
// fullscreen exit, window resize and new-frame toasts. Chrome hiding is CSS (styles/present.css) via .pg[data-present].
import { useEffect, useRef, useState } from 'react';
import { useStoreValue } from '../core/react';
import { toast } from '../core/toast';
import {
  FS_EVENT, presentGo, presentNext, presentPrev, presentStore, presentToggleCursors, showFrame, stopPresent,
} from '../actions/present';
import type { SlotProps } from './slotProps';
import '../styles/present.css';

export function Present({ board }: SlotProps) {
  const st = useStoreValue(presentStore.subscribe, presentStore.get);
  const { active, index, ids } = st;
  const [faded, setFaded] = useState(false);
  const known = useRef<Set<string>>(new Set());
  const catcher = useRef<HTMLDivElement>(null);

  // Keys: window capture, registered once. While presenting it owns the keyboard (stops the global dispatcher).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!presentStore.get().active) return;
      const eat = () => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
      if ((e.metaKey || e.ctrlKey) && e.altKey && e.code === 'KeyP') { eat(); stopPresent(); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      if (k === 'Escape') { eat(); stopPresent(); }
      else if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(k)) { eat(); presentNext(); }
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(k)) { eat(); presentPrev(); }
      else if (k === 'Home') { eat(); presentGo(0); }
      else if (k === 'End') { eat(); presentGo(presentStore.get().ids.length - 1); }
      else if (/^[1-9]$/.test(k)) { eat(); presentGo(Number(k) - 1); }
      else if (k === 'n' || k === 'N') { eat(); presentToggleCursors(); }
      else eat();                                             // nothing else edits the board while presenting
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // Browser Esc leaves fullscreen without a keydown: that ends the presentation too.
  useEffect(() => {
    let sawFs = false;
    const onFs = () => {
      if (document.fullscreenElement) sawFs = true;
      else if (sawFs && presentStore.get().active) { sawFs = false; stopPresent(); }
      else sawFs = false;
    };
    document.addEventListener(FS_EVENT, onFs);
    return () => document.removeEventListener(FS_EVENT, onFs);
  }, []);

  // Window / board resize while presenting re-fits the current frame (no ease).
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const refit = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => showFrame(presentStore.get().index, true)); };
    window.addEventListener('resize', refit);
    const view = document.querySelector('.pg-view');
    const ro = typeof ResizeObserver !== 'undefined' && view ? new ResizeObserver(refit) : null;
    if (ro && view) ro.observe(view);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', refit); ro?.disconnect(); };
  }, [active]);

  // Frames agents add (or remove) while presenting join the sequence live, with a toast.
  useEffect(() => {
    if (!active) return;
    known.current = new Set(presentStore.get().ids);
    const sync = () => {
      const s = board.doc.getState();
      const frames = [...(s.children.get(null) ?? [])].map((id) => s.shapes.get(id)).filter((x) => x && x.kind === 'frame' && !x.deleted && !x.hidden);
      let changed = false;
      for (const f of frames) {
        if (f && !known.current.has(f.id)) { known.current.add(f.id); changed = true; if (known.current.size > 1) toast(`New frame: ${f.name}`, { key: `present.new.${f.id}`, ttlMs: 2500 }); }
      }
      if (changed || frames.length !== presentStore.get().ids.length) showFrame(presentStore.get().index, true);
    };
    const off = board.doc.subscribe(() => sync());
    return () => { off(); };
  }, [active, board]);

  // Counter shows on every step and fades after 2 s.
  useEffect(() => {
    if (!active) return;
    setFaded(false);
    const t = setTimeout(() => setFaded(true), 2000);
    return () => clearTimeout(t);
  }, [active, index, ids.length]);

  // Keep keyboard focus on the catcher in the 'dialog' focus context, so the global dispatcher ignores board shortcuts.
  useEffect(() => { if (active) catcher.current?.focus(); }, [active]);

  if (!active) return null;
  const name = ids.length ? board.doc.getState().shapes.get(ids[index])?.name : undefined;
  return (
    <div
      ref={catcher}
      className="pg-present"
      data-pg-ctx="dialog"
      tabIndex={-1}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { if (e.shiftKey) presentPrev(); else presentNext(); }}
      onContextMenu={(e) => { e.preventDefault(); presentPrev(); }}
    >
      <div className={'pg-present-count' + (faded ? ' faded' : '')} role="status" aria-live="polite">
        {ids.length ? `${index + 1} / ${ids.length}` : 'No frames'}
        {name && <span className="pg-present-name">{name}</span>}
      </div>
    </div>
  );
}
