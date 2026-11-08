// Slot: Tooltip (SHELL-11). One delegated tooltip for the whole page. Mark any element with
//   data-tip-action="tool.rect"  -> label + shortcut read from the action registry (never hard-coded)
//   data-tip="Plain text"        -> text only
// 500 ms show delay, instant when moving between tooltips, hides on press / Esc / scroll, none on touch.
// Also shows on keyboard focus (:focus-visible) and is linked with aria-describedby while visible.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { detectPlatform, getAction, shortcutLabels, type Platform } from '../../core/actions';
import type { SlotProps } from '../slotProps';

export interface TipContent { label: string; keys: string[]; reason?: string }

/** Pure: what a tooltip for a registry action shows (title, shortcut labels, and why it is unavailable). */
export function tipForAction(id: string, platform: Platform = detectPlatform()): TipContent | null {
  const a = getAction(id);
  if (!a) return null;
  const when = a.when ? a.when() : true;
  return { label: a.title, keys: shortcutLabels(a, platform), reason: when === true ? undefined : when };
}

// ---- reduced motion (SHELL-17): live value of prefers-reduced-motion ----
const MQ = '(prefers-reduced-motion: reduce)';
const mq = () => (typeof matchMedia === 'function' ? matchMedia(MQ) : null);
function subscribeMotion(cb: () => void) {
  const m = mq();
  m?.addEventListener?.('change', cb);
  return () => m?.removeEventListener?.('change', cb);
}
/** True while the OS asks for reduced motion; updates live. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeMotion, () => !!mq()?.matches, () => false);
}

const SHOW_DELAY = 500;
const GRACE_MS = 300;      // moving to a neighbouring control within this window shows its tip at once
const tipTarget = (n: EventTarget | null) => (n instanceof Element ? n.closest<HTMLElement>('[data-tip-action], [data-tip]') : null);

function contentOf(el: HTMLElement): TipContent | null {
  const id = el.dataset.tipAction;
  if (id) return tipForAction(id);
  return el.dataset.tip ? { label: el.dataset.tip, keys: [] } : null;
}

interface Shown { el: HTMLElement; tip: TipContent }

export function Tooltip(_props: SlotProps) {
  const [shown, setShown] = useState<Shown | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const id = 'pg-tooltip';

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastHidden = 0;
    let current: HTMLElement | null = null;
    const hide = () => {
      clearTimeout(timer);
      current?.removeAttribute('aria-describedby');
      current = null;
      setShown((s) => { if (s) lastHidden = Date.now(); return null; });
      setPos(null);
    };
    const show = (el: HTMLElement) => {
      const tip = contentOf(el);
      if (!tip) return;
      current?.removeAttribute('aria-describedby');
      current = el;
      el.setAttribute('aria-describedby', id);
      setPos(null);
      setShown({ el, tip });
    };
    const arm = (el: HTMLElement, instant: boolean) => {
      clearTimeout(timer);
      if (instant || Date.now() - lastHidden < GRACE_MS) show(el);
      else timer = setTimeout(() => show(el), SHOW_DELAY);
    };
    const onOver = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const el = tipTarget(e.target);
      if (el === current) return;
      if (!el) { hide(); return; }
      if (current) { hide(); arm(el, true); } else arm(el, false);
    };
    const onOut = (e: PointerEvent) => { if (!tipTarget(e.relatedTarget)) hide(); };
    const onFocus = (e: FocusEvent) => {
      const el = tipTarget(e.target);
      if (el && el.matches(':focus-visible')) arm(el, true);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') hide(); };
    const opts = { capture: true } as const;
    document.addEventListener('pointerover', onOver, opts);
    document.addEventListener('pointerout', onOut, opts);
    document.addEventListener('pointerdown', hide, opts);
    document.addEventListener('focusin', onFocus, opts);
    document.addEventListener('focusout', hide, opts);
    document.addEventListener('keydown', onKey, opts);
    window.addEventListener('scroll', hide, opts);
    window.addEventListener('blur', hide);
    return () => {
      clearTimeout(timer);
      current?.removeAttribute('aria-describedby');
      document.removeEventListener('pointerover', onOver, opts);
      document.removeEventListener('pointerout', onOut, opts);
      document.removeEventListener('pointerdown', hide, opts);
      document.removeEventListener('focusin', onFocus, opts);
      document.removeEventListener('focusout', hide, opts);
      document.removeEventListener('keydown', onKey, opts);
      window.removeEventListener('scroll', hide, opts);
      window.removeEventListener('blur', hide);
    };
  }, []);

  // Place above the target, flip below when there is no room, clamp to the viewport.
  useLayoutEffect(() => {
    if (!shown || !boxRef.current) return;
    const r = shown.el.getBoundingClientRect();
    const b = boxRef.current.getBoundingClientRect();
    const gap = 8, m = 6;
    let top = r.top - b.height - gap;
    if (top < m) top = r.bottom + gap;
    const left = Math.min(Math.max(m, r.left + r.width / 2 - b.width / 2), window.innerWidth - b.width - m);
    setPos({ left, top });
  }, [shown]);

  if (!shown) return null;
  const { tip } = shown;
  return (
    <div ref={boxRef} id={id} role="tooltip"
      style={{
        position: 'fixed', left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden',
        zIndex: 60, pointerEvents: 'none', maxWidth: 280, display: 'flex', alignItems: 'center', gap: 8,
        padding: '5px 9px', borderRadius: 7, background: 'var(--pg-ink)', color: 'var(--pg-white)',
        fontSize: 12, lineHeight: 1.3, boxShadow: 'var(--pg-shadow-pop)',
        transition: reduced ? 'none' : 'opacity 80ms linear',
      }}>
      <span>{tip.reason ? `${tip.label} (${tip.reason})` : tip.label}</span>
      {tip.keys.map((k) => (
        <kbd key={k} style={{ font: 'inherit', fontSize: 11, padding: '1px 5px', borderRadius: 4, background: 'var(--pg-ink-soft)', color: 'var(--pg-white)' }}>{k}</kbd>
      ))}
    </div>
  );
}
