// Shared number field for inspector sections (PROPS-7, PROPS-8, PROPS-26).
//   <NumberField board={board} sp={sp} prop="w" label="W" unit="px" min={1} />
// Enter/blur commit, Esc reverts, arrows step (Shift x10, Alt x0.1), drag the label to scrub,
// typing previews live as ONE undo entry, arithmetic ('100/2+8', '+10', '50%') evaluates per shape.
import { useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react';
import type { BoardKit } from '../../core/commands';
import { evalNumber, formatNumber } from '../../core/numexpr';
import type { Command, Gesture, Shape, ShapeProps } from '../../core/types';
import { useFieldFlash } from './useSelectionProps';
import type { SelectionProps } from './useSelectionProps';

type NumKey = { [K in keyof ShapeProps]-?: ShapeProps[K] extends number | undefined ? K : never }[keyof ShapeProps];

export interface NumberFieldProps {
  board: BoardKit;
  sp: SelectionProps;
  /** Numeric shape prop this field edits. */
  prop: NumKey;
  /** Short label (or icon node); dragging it scrubs the value. */
  label?: React.ReactNode;
  /** Accessible name when `label` is an icon. */
  ariaLabel?: string;
  /** Suffix shown after the number, e.g. 'px', 'deg', '%'. Display only. */
  unit?: string;
  min?: number;
  max?: number;
  /** Arrow/scrub step (default 1). */
  step?: number;
  /** Decimal places kept (default 2). */
  decimals?: number;
  /** Display scale: field shows value*scale (e.g. 100 for opacity 0..1). Commits divide by it. */
  scale?: number;
  /** Patch written for one shape (default `{[prop]: value}`); use for lock ratio and the like. */
  toPatch?: (value: number, shape: Shape) => Partial<ShapeProps>;
  disabled?: boolean;
  /** Undo label (default 'Edit <prop>'). */
  undoLabel?: string;
  className?: string;
  /** Runs after a committed edit (e.g. re-measure auto-sized text). */
  afterCommit?: () => void;
}

const clamp = (v: number, lo?: number, hi?: number) => Math.min(hi ?? Infinity, Math.max(lo ?? -Infinity, v));
const ownValue = (s: Shape, prop: NumKey) => (s[prop] as number | undefined) ?? 0;

export function NumberField(props: NumberFieldProps) {
  const { board, sp, prop, label, ariaLabel, unit, min, max, step = 1, decimals = 2, scale = 1, toPatch, disabled, className } = props;
  const id = useId();
  const value = sp.get(prop);
  const flash = useFieldFlash(board, sp, prop);
  const shown = (v: number | undefined) => (v === undefined ? '' : formatNumber(v * scale, decimals));
  const live = !value.mixed ? shown(value.value as number | undefined) : '';

  const [draft, setDraft] = useState<string | null>(null); // non-null while the user has typed
  const [bad, setBad] = useState(false);
  const draftRef = useRef<string | null>(null); // mirrors `draft` synchronously (Esc then blur must not commit)
  const gesture = useRef<Gesture | null>(null);
  const raf = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const lbl = props.undoLabel ?? `Edit ${prop}`;
  const coalesce = `field:${prop}:${sp.ids.join(',')}`;

  // Latest props for handlers that outlive a render (rAF, pointer capture).
  const latest = useRef({ sp, toPatch });
  latest.current = { sp, toPatch };

  useEffect(() => () => { cancelAnimationFrame(raf.current); gesture.current?.abort(); gesture.current = null; }, []);
  useEffect(() => { if (!sp.ids.length) { gesture.current?.abort(); gesture.current = null; setDraftBoth(null); } }, [sp.ids.length]);

  /** Commands that set every selected shape from `next(shape)`; null when any shape is unusable. */
  function commands(next: (s: Shape) => number | null): Command[] | null {
    const { sp: cur, toPatch: tp } = latest.current;
    const cmds: Command[] = [];
    for (const s of cur.shapes) {
      const v = next(s);
      if (v === null) return null;
      const stored = clamp(Math.round((v / scale) * 1e6) / 1e6, min !== undefined ? min / scale : undefined, max !== undefined ? max / scale : undefined);
      cmds.push({ t: 'shape.update', ids: [s.id], patch: tp ? tp(stored, s) : ({ [prop]: stored } as Partial<ShapeProps>) });
    }
    return cmds.length ? cmds : null;
  }

  function preview(cmds: Command[]) {
    if (!gesture.current) gesture.current = board.gesture(board.me, lbl, { coalesceKey: coalesce });
    gesture.current.update(cmds);
  }
  function finish(commit: boolean) {
    cancelAnimationFrame(raf.current);
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (commit) { g.commit(); props.afterCommit?.(); } else g.abort();
  }

  const evalFor = (text: string) => (s: Shape): number | null => {
    const cur = ownValue(s, prop) * scale;
    const r = evalNumber(text, cur, { min, max, decimals });
    return r;
  };

  const setDraftBoth = (v: string | null) => { draftRef.current = v; setDraft(v); };

  function onChange(text: string) {
    setDraftBoth(text);
    setBad(false);
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      // Live preview from the original values: the gesture re-plans from its base each frame.
      const cmds = commands(evalFor(text));
      if (cmds) preview(cmds);
    });
  }

  function commit() {
    const typed = draftRef.current;
    if (typed === null) return finish(true);
    const cmds = commands(evalFor(typed));
    if (!cmds) {
      finish(false);
      setBad(true);
      setTimeout(() => setBad(false), 400);
    } else {
      cancelAnimationFrame(raf.current);
      preview(cmds);
      finish(true);
    }
    setDraftBoth(null);
  }
  function revert() {
    finish(false);
    setDraftBoth(null);
    setBad(false);
  }

  /** Step every shape by delta display units (one undo entry per press, coalesced). */
  function nudge(delta: number) {
    const cmds = commands((s) => clamp(ownValue(s, prop) * scale + delta, min, max));
    if (!cmds) return;
    finish(true);
    preview(cmds);
    finish(true);
    setDraftBoth(null);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
    if (e.key === 'Enter') { e.preventDefault(); commit(); input.current?.select(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); revert(); input.current?.blur(); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const dir = e.key === 'ArrowUp' ? 1 : -1;
      const typed = draftRef.current;
      if (typed !== null) { // apply the typed text first, then step from there
        const cmds = commands(evalFor(typed));
        if (cmds) { preview(cmds); finish(true); }
        setDraftBoth(null);
      }
      nudge(dir * step * mult);
    }
    // Tab falls through: the browser moves focus and blur commits (PROPS-26).
  }

  // Scrub by dragging the label (PROPS-9). Starts from each shape's own value.
  const scrub = useRef<{ x: number; start: Map<string, number> } | null>(null);
  function onLabelDown(e: PointerEvent<HTMLElement>) {
    if (disabled || e.button !== 0 || !sp.shapes.length) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    finish(false);
    scrub.current = { x: e.clientX, start: new Map(sp.shapes.map((s) => [s.id, ownValue(s, prop) * scale])) };
  }
  function onLabelMove(e: PointerEvent<HTMLElement>) {
    const sc = scrub.current;
    if (!sc) return;
    const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
    const delta = (e.clientX - sc.x) * step * mult;
    const cmds = commands((s) => {
      const r = Math.round((clamp((sc.start.get(s.id) ?? 0) + delta, min, max)) * 10 ** decimals) / 10 ** decimals;
      return r;
    });
    if (cmds) preview(cmds);
  }
  function onLabelUp(e: PointerEvent<HTMLElement>) {
    if (!scrub.current) return;
    scrub.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* already released */ }
    finish(true);
  }

  const typing = draft !== null;
  const text = typing ? draft : live;
  const isMixed = value.mixed && !typing;
  const wrap: CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, borderRadius: 4,
    border: `1px solid ${bad ? 'var(--pg-danger, var(--pg-accent))' : 'var(--pg-line)'}`,
    background: 'var(--pg-surface, var(--pg-bg))', padding: '0 6px', height: 24,
    ...flash.style,
  };
  return (
    <div className={`pg-numfield ${flash.className} ${className ?? ''}`.trim()} style={wrap} data-agent={flash.agent ?? undefined}>
      {label !== undefined && (
        <span
          role="presentation" title={ariaLabel} data-scrub
          style={{ cursor: disabled ? 'default' : 'ew-resize', color: 'var(--pg-muted)', userSelect: 'none', touchAction: 'none', flex: 'none' }}
          onPointerDown={onLabelDown} onPointerMove={onLabelMove} onPointerUp={onLabelUp} onPointerCancel={onLabelUp}
        >{label}</span>
      )}
      <input
        ref={input} id={id} type="text" inputMode="decimal" autoComplete="off" spellCheck={false}
        aria-label={ariaLabel ?? (typeof label === 'string' ? label : prop)}
        className={isMixed ? 'pg-mixed' : undefined}
        style={{ flex: 1, minWidth: 0, width: '100%', border: 0, outline: 0, background: 'transparent', color: 'var(--pg-ink)', font: 'inherit', textAlign: 'right' }}
        value={text} placeholder={isMixed ? 'Mixed' : undefined} disabled={disabled}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => onChange(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
      {unit && !isMixed && <span style={{ color: 'var(--pg-muted)', flex: 'none' }}>{unit}</span>}
    </div>
  );
}
