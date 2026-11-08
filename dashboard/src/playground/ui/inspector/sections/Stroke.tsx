// Inspector section "Stroke" (PROPS-16). Rows: swatch, hex, opacity, eye, minus, then weight and align (inside / center / outside).
// Colours are stored as '#rrggbb' or '#rrggbbaa'. Picker drags preview live and commit as ONE undo entry (Esc reverts).
// Also exports the small shared row pieces (ColorSwatch, NumInput, styles) used by Effects.tsx.
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { cssRgba, parseColor, toHex, toHexA } from '../../../core/color';
import { evalNumber, formatNumber } from '../../../core/numexpr';
import type { Command, Shape, Stroke } from '../../../core/types';
import type { SlotProps } from '../../slotProps';
import { ColorPicker, useColorGesture } from '../ColorPicker';
import type { ColorValue } from '../ColorPicker';
import { useFieldFlash, useSelectionProps } from '../useSelectionProps';
import type { SelectionProps } from '../useSelectionProps';
import { parseHexInput, parsePercent } from './Fill';

type Board = SlotProps['board'];

export const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, height: 28, position: 'relative' };
export const box: CSSProperties = { display: 'flex', alignItems: 'center', gap: 4, height: 24, padding: '0 6px', minWidth: 0, border: '1px solid var(--pg-line)', borderRadius: 4, background: 'var(--pg-panel)' };
export const bare: CSSProperties = { flex: 1, minWidth: 0, width: '100%', border: 0, outline: 0, background: 'transparent', color: 'var(--pg-ink)', font: 'inherit' };
export const iconBtn: CSSProperties = { flex: 'none', width: 22, height: 22, border: 0, borderRadius: 4, background: 'transparent', color: 'var(--pg-muted)', cursor: 'pointer', font: 'inherit', lineHeight: 1 };
const checker = 'repeating-conic-gradient(var(--pg-line) 0% 25%, var(--pg-panel) 0% 50%) 0 0 / 8px 8px';

export const upd = (id: string, patch: Partial<Shape>): Command => ({ t: 'shape.update', ids: [id], patch });
let seq = 0;
export const opId = (p: string) => `${p}-${Date.now().toString(36)}-${seq++}`;

/** Stored colour string to picker value. */
export function toValue(color: string): ColorValue {
  const c = parseColor(color) ?? { r: 0, g: 0, b: 0, a: 1 };
  return { color: toHex(c), opacity: c.a };
}
/** Picker value to stored colour string (alpha only when below 1). */
export function fromValue(v: ColorValue): string {
  const c = parseColor(v.color) ?? { r: 0, g: 0, b: 0, a: 1 };
  return toHexA({ ...c, a: v.opacity });
}

const keys = (commit: () => void, reset: () => void) => (e: KeyboardEvent<HTMLInputElement>) => {
  if (e.key === 'Enter') { e.preventDefault(); commit(); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); reset(); e.currentTarget.blur(); }
};

/** Number input for a nested value. value null = mixed. Enter/blur commits (arithmetic ok), Esc reverts, arrows step. */
export function NumInput({ label, value, onCommit, min, max, step = 1, width }: {
  label: string; value: number | null; onCommit: (n: number) => void; min?: number; max?: number; step?: number; width?: number | string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const n = evalNumber(draft, value ?? 0);
    setDraft(null);
    if (n !== null) onCommit(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n)));
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const d = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : e.altKey ? 0.1 : 1);
      const n = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, Math.round(((value ?? 0) + d) * 1e4) / 1e4));
      setDraft(null);
      onCommit(n);
    } else keys(commit, () => setDraft(null))(e);
  };
  return (
    <label style={{ ...box, width, flex: width ? 'none' : 1 }}>
      <span style={{ color: 'var(--pg-muted)' }} aria-hidden>{label}</span>
      <input
        aria-label={label} inputMode="decimal" autoComplete="off" style={{ ...bare, textAlign: 'right' }}
        className={value === null && draft === null ? 'pg-mixed' : undefined} placeholder={value === null ? 'Mixed' : undefined}
        value={draft ?? (value === null ? '' : formatNumber(value, 2))}
        onFocus={(e) => e.currentTarget.select()} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={onKey}
      />
    </label>
  );
}

/** Swatch button that opens the colour picker in a popover. Live preview, one undo entry, Esc reverts. */
export function ColorSwatch({ board, value, apply, label, gestureKey }: {
  board: Board; value: ColorValue | null; apply: (v: ColorValue) => Command[]; label: string; gestureKey: string;
}) {
  const gesture = useColorGesture(board, apply, `Change ${label.toLowerCase()}`, gestureKey);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const swatch = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (pop.current?.contains(t) || swatch.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  }, [open]);
  const cur: ColorValue = value ?? { color: '#000000', opacity: 1 };
  const toggle = () => {
    const r = swatch.current?.getBoundingClientRect();
    if (r) setPos({ top: Math.max(8, Math.min(r.top, window.innerHeight - 330)), right: window.innerWidth - r.left + 12 });
    setOpen((o) => !o);
  };
  return (
    <>
      <button
        ref={swatch} type="button" aria-label={`${label} colour`} aria-expanded={open} onClick={toggle}
        style={{ flex: 'none', width: 16, height: 16, padding: 0, borderRadius: 3, border: '1px solid var(--pg-line-strong)', cursor: 'pointer',
          background: value ? `linear-gradient(${cssRgba(cur.color, cur.opacity)}, ${cssRgba(cur.color, cur.opacity)}), ${checker}` : checker }}
      />
      {open && (
        <div ref={pop} style={{ position: 'fixed', top: pos.top, right: pos.right, zIndex: 50 }}>
          <ColorPicker
            value={cur} onPreview={gesture.onPreview} onCommit={gesture.onCommit} onCancel={gesture.onCancel}
            agentColors={board.actors.list().filter((a) => a.kind !== 'human').map((a) => a.color)}
          />
        </div>
      )}
    </>
  );
}

/** Shared by Stroke and Effects: add button header. */
export function SectionHead({ title, addLabel, onAdd }: { title: string; addLabel: string; onAdd: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <h3 className="pg-insp-h" style={{ margin: 0 }}>{title}</h3>
      <button type="button" style={iconBtn} aria-label={addLabel} title={addLabel} onClick={onAdd}>+</button>
    </div>
  );
}

const ALIGNS = [['inside', 'Inside'], ['center', 'Center'], ['outside', 'Outside']] as const;
const DEFAULT_STROKE: Stroke = { color: '#000000', width: 1, align: 'inside' };

function StrokeRow({ sp, board, shapes, index, stroke, mixed }: {
  sp: SelectionProps; board: Board; shapes: readonly Shape[]; index: number | null; stroke: Stroke | null; mixed: boolean;
}) {
  const flash = useFieldFlash(board, sp, 'strokes');
  const [hex, setHex] = useState<string | null>(null);
  const [pct, setPct] = useState<string | null>(null);
  const val = stroke ? toValue(stroke.color) : null;
  const run = (commands: Command[], label: string) => board.exec({ actor: board.me, opId: opId('stroke'), commands, label });
  /** Edit stroke `index` on every shape (mixed row: replace all strokes with one built from `patch`). */
  const edit = (patch: Partial<Stroke>, label: string): Command[] =>
    shapes.map((s) => upd(s.id, { strokes: index === null
      ? [{ ...DEFAULT_STROKE, ...patch }]
      : (s.strokes ?? []).map((k, j) => (j === index ? { ...k, ...patch } : k)) }));
  const removeAll = (label: string) => run(shapes.map((s) => upd(s.id, { strokes: index === null ? [] : (s.strokes ?? []).filter((_, j) => j !== index) })), label);
  const commitHex = () => {
    if (hex === null) return;
    const v = parseHexInput(hex, val?.opacity ?? 1);
    setHex(null);
    if (v) run(edit({ color: fromValue(v) }, ''), 'Change stroke colour');
  };
  const commitPct = () => {
    if (pct === null) return;
    const o = parsePercent(pct);
    setPct(null);
    if (o !== null && val) run(edit({ color: fromValue({ color: val.color, opacity: o }) }, ''), 'Change stroke opacity');
  };
  const hidden = !!stroke?.hidden;
  return (
    <div className={flash.className} style={{ ...flash.style, opacity: hidden ? 0.5 : 1 }} data-agent={flash.agent ?? undefined}>
      <div style={row}>
        <ColorSwatch
          board={board} value={val} label="Stroke" gestureKey={`strokes:${index}:${sp.ids.join(',')}`}
          apply={(v) => edit({ color: fromValue(v) }, '')}
        />
        <div style={{ ...box, flex: 1 }}>
          <input
            aria-label="Stroke hex" spellCheck={false} autoComplete="off" style={{ ...bare, textTransform: 'uppercase' }}
            className={mixed && hex === null ? 'pg-mixed' : undefined} placeholder={mixed ? 'Mixed' : undefined}
            value={hex ?? (val ? val.color.slice(1).toUpperCase() : '')}
            onFocus={(e) => e.currentTarget.select()} onChange={(e) => setHex(e.target.value)} onBlur={commitHex}
            onKeyDown={keys(commitHex, () => setHex(null))}
          />
        </div>
        <div style={{ ...box, width: 58 }}>
          <input
            aria-label="Stroke opacity" inputMode="decimal" autoComplete="off" style={{ ...bare, textAlign: 'right' }}
            value={pct ?? (val ? String(Math.round(val.opacity * 100)) : '')} placeholder={mixed ? '–' : undefined}
            onFocus={(e) => e.currentTarget.select()} onChange={(e) => setPct(e.target.value)} onBlur={commitPct}
            onKeyDown={keys(commitPct, () => setPct(null))}
          />
          <span style={{ color: 'var(--pg-muted)' }}>%</span>
        </div>
        {index !== null && (
          <button type="button" style={iconBtn} aria-label={hidden ? 'Show stroke' : 'Hide stroke'} aria-pressed={hidden} title={hidden ? 'Show' : 'Hide'}
            onClick={() => run(edit({ hidden: !hidden }, ''), hidden ? 'Show stroke' : 'Hide stroke')}>{hidden ? '◌' : '◉'}</button>
        )}
        <button type="button" style={iconBtn} aria-label="Remove stroke" title="Remove" onClick={() => removeAll('Remove stroke')}>−</button>
      </div>
      {index !== null && stroke && (
        <div style={row}>
          <NumInput label="W" width={64} min={0} max={500} step={1} value={stroke.width} onCommit={(n) => run(edit({ width: n }, ''), 'Change stroke weight')} />
          <div role="group" aria-label="Stroke align" style={{ display: 'flex', gap: 2, flex: 1 }}>
            {ALIGNS.map(([a, text]) => {
              const on = (stroke.align ?? 'inside') === a;
              return (
                <button
                  key={a} type="button" aria-pressed={on} title={text}
                  onClick={() => !on && run(edit({ align: a }, ''), `Stroke ${a}`)}
                  style={{ flex: 1, height: 24, padding: 0, border: '1px solid var(--pg-line)', borderRadius: 4, cursor: 'pointer', font: 'inherit', fontSize: 11,
                    background: on ? 'var(--pg-accent)' : 'var(--pg-panel)', color: on ? 'var(--pg-on-accent, #fff)' : 'var(--pg-ink-body)' }}
                >{text}</button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function StrokeSection({ board }: SlotProps) {
  const sp = useSelectionProps(board);
  const shapes = sp.shapes.filter((s) => s.kind !== 'group');
  if (!shapes.length) return null;
  const first = shapes[0]!.strokes ?? [];
  const uniform = shapes.every((s) => JSON.stringify(s.strokes ?? []) === JSON.stringify(first));
  const add = () => board.exec({
    actor: board.me, opId: opId('stroke-add'), label: 'Add stroke',
    commands: shapes.map((s) => upd(s.id, { strokes: [...(uniform ? s.strokes ?? [] : []), { ...DEFAULT_STROKE }] })),
  });
  return (
    <div className="pg-insp-sec">
      <SectionHead title="Stroke" addLabel="Add stroke" onAdd={add} />
      {!uniform && <StrokeRow sp={sp} board={board} shapes={shapes} index={null} stroke={null} mixed />}
      {uniform && first.length === 0 && <p className="pg-insp-hint" style={{ margin: '4px 0 0' }}>No stroke</p>}
      {uniform && first.map((k, i) => <StrokeRow key={i} sp={sp} board={board} shapes={shapes} index={i} stroke={k} mixed={false} />)}
    </div>
  );
}
