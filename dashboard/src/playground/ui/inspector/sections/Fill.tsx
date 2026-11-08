// Inspector section "Fill" (PROPS-11) and "Text colour" (TEXT-9).
// Solid fill rows: swatch (opens the picker in a small popover), hex, opacity %, eye, minus; plus adds a fill.
// Text layers drive their glyph colour from `color`. Dragging in the picker previews live and commits as ONE undo entry.
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { cssRgba, parseColor, toHex } from '../../../core/color';
import type { Command, Paint, Shape } from '../../../core/types';
import type { SlotProps } from '../../slotProps';
import { ColorPicker, useColorGesture } from '../ColorPicker';
import type { ColorValue } from '../ColorPicker';
import { useFieldFlash, useSelectionProps } from '../useSelectionProps';
import type { SelectionProps } from '../useSelectionProps';

/** Parse hex field text ('f24e1e', '#abc', 8 digits with alpha). Null when invalid. `opacity` is set only for 8 digits. */
export function parseHexInput(text: string, fallbackOpacity = 1): ColorValue | null {
  const t = text.trim().replace(/^#/, '');
  if (!/^[0-9a-f]{3,8}$/i.test(t) || t.length === 5 || t.length === 7) return null;
  const c = parseColor(t);
  if (!c) return null;
  return { color: toHex(c), opacity: t.length === 4 || t.length === 8 ? c.a : fallbackOpacity };
}

/** Opacity percent text ('50', '50%') to 0..1, clamped. Null when invalid. */
export function parsePercent(text: string): number | null {
  const n = Number(text.trim().replace(/%$/, ''));
  return text.trim() === '' || !Number.isFinite(n) ? null : Math.min(1, Math.max(0, n / 100));
}

const paintValue = (p: Paint): ColorValue => ({ color: p.color, opacity: p.opacity ?? 1 });
const withValue = (p: Paint, v: ColorValue): Paint => {
  const { opacity: _drop, ...rest } = p;
  return { ...rest, color: v.color, ...(v.opacity < 1 ? { opacity: v.opacity } : {}) };
};
const upd = (id: string, patch: Partial<Shape>): Command => ({ t: 'shape.update', ids: [id], patch });

const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, height: 28, position: 'relative' };
const box: CSSProperties = { display: 'flex', alignItems: 'center', gap: 4, height: 24, padding: '0 6px', minWidth: 0, border: '1px solid var(--pg-line)', borderRadius: 4, background: 'var(--pg-panel)' };
const bare: CSSProperties = { flex: 1, minWidth: 0, width: '100%', border: 0, outline: 0, background: 'transparent', color: 'var(--pg-ink)', font: 'inherit' };
const iconBtn: CSSProperties = { flex: 'none', width: 22, height: 22, border: 0, borderRadius: 4, background: 'transparent', color: 'var(--pg-muted)', cursor: 'pointer', font: 'inherit', lineHeight: 1 };
const checker = 'repeating-conic-gradient(var(--pg-line) 0% 25%, var(--pg-panel) 0% 50%) 0 0 / 8px 8px';

interface RowProps {
  sp: SelectionProps;
  board: SlotProps['board'];
  /** Current value; null = mixed across the selection. */
  value: ColorValue | null;
  hidden?: boolean;
  /** Commands that set this row's colour on every affected shape. */
  apply: (v: ColorValue) => Command[];
  label: string;
  flashKey: 'fills' | 'color';
  withOpacity?: boolean;
  onToggle?: () => void;
  onRemove?: () => void;
}

function PaintRow({ sp, board, value, hidden, apply, label, flashKey, withOpacity = true, onToggle, onRemove }: RowProps) {
  const flash = useFieldFlash(board, sp, flashKey);
  const gesture = useColorGesture(board, apply, `Change ${label.toLowerCase()}`, `${flashKey}:${sp.ids.join(',')}`);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const [hex, setHex] = useState<string | null>(null);
  const [pct, setPct] = useState<string | null>(null);
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

  const cur: ColorValue = value ?? { color: '#d9d9d9', opacity: 1 };
  const exec = (v: ColorValue) => {
    board.exec({ actor: board.me, opId: `fill-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, commands: apply(v), label: `Change ${label.toLowerCase()}` });
  };
  const openPicker = () => {
    const r = swatch.current?.getBoundingClientRect();
    if (r) setPos({ top: Math.max(8, Math.min(r.top, window.innerHeight - 330)), right: window.innerWidth - r.left + 12 });
    setOpen((o) => !o);
  };
  const commitHex = () => {
    if (hex === null) return;
    const v = parseHexInput(hex, cur.opacity);
    setHex(null);
    if (v) exec(v);
  };
  const commitPct = () => {
    if (pct === null) return;
    const o = parsePercent(pct);
    setPct(null);
    if (o !== null) exec({ color: cur.color, opacity: o });
  };
  const keys = (commit: () => void, reset: () => void) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); reset(); e.currentTarget.blur(); }
  };

  const transparent = !value || value.opacity === 0;
  return (
    <div className={flash.className} style={{ ...row, ...flash.style, opacity: hidden ? 0.5 : 1 }} data-agent={flash.agent ?? undefined}>
      <button
        ref={swatch} type="button" aria-label={`${label} colour`} aria-expanded={open} onClick={openPicker}
        style={{ flex: 'none', width: 16, height: 16, padding: 0, borderRadius: 3, border: '1px solid var(--pg-line-strong)', cursor: 'pointer',
          background: value && !transparent ? `linear-gradient(${cssRgba(cur.color, cur.opacity)}, ${cssRgba(cur.color, cur.opacity)}), ${checker}` : checker }}
      />
      <div style={{ ...box, flex: 1 }}>
        <input
          aria-label={`${label} hex`} spellCheck={false} autoComplete="off" style={{ ...bare, textTransform: 'uppercase' }}
          className={!value && hex === null ? 'pg-mixed' : undefined} placeholder={value ? undefined : 'Mixed'}
          value={hex ?? (value ? cur.color.slice(1).toUpperCase() : '')}
          onFocus={(e) => e.currentTarget.select()} onChange={(e) => setHex(e.target.value)} onBlur={commitHex}
          onKeyDown={keys(commitHex, () => setHex(null))}
        />
      </div>
      {withOpacity && (
        <div style={{ ...box, width: 58 }}>
          <input
            aria-label={`${label} opacity`} inputMode="decimal" autoComplete="off" style={{ ...bare, textAlign: 'right' }}
            value={pct ?? (value ? String(Math.round(cur.opacity * 100)) : '')} placeholder={value ? undefined : '–'}
            onFocus={(e) => e.currentTarget.select()} onChange={(e) => setPct(e.target.value)} onBlur={commitPct}
            onKeyDown={keys(commitPct, () => setPct(null))}
          />
          <span style={{ color: 'var(--pg-muted)' }}>%</span>
        </div>
      )}
      {onToggle && <button type="button" style={iconBtn} aria-label={hidden ? 'Show fill' : 'Hide fill'} aria-pressed={!!hidden} title={hidden ? 'Show' : 'Hide'} onClick={onToggle}>{hidden ? '◌' : '◉'}</button>}
      {onRemove && <button type="button" style={iconBtn} aria-label="Remove fill" title="Remove" onClick={onRemove}>−</button>}
      {open && (
        <div ref={pop} style={{ position: 'fixed', top: pos.top, right: pos.right, zIndex: 50 }}>
          <ColorPicker
            value={cur}
            onPreview={(v) => gesture.onPreview(withOpacity ? v : { ...v, opacity: 1 })}
            onCommit={(v) => gesture.onCommit(withOpacity ? v : { ...v, opacity: 1 })}
            onCancel={gesture.onCancel}
            agentColors={board.actors.list().filter((a) => a.kind !== 'human').map((a) => a.color)}
          />
        </div>
      )}
    </div>
  );
}

const sameFills = (shapes: readonly Shape[]) => shapes.every((s) => JSON.stringify(s.fills) === JSON.stringify(shapes[0]!.fills));

function FillBlock({ sp, board, shapes }: { sp: SelectionProps; board: SlotProps['board']; shapes: readonly Shape[] }) {
  const uniform = sameFills(shapes);
  const fills = uniform ? shapes[0]!.fills : [];
  const setAll = (make: (s: Shape) => Paint[], label: string) =>
    board.exec({ actor: board.me, opId: `fills-${Date.now().toString(36)}`, commands: shapes.map((s) => upd(s.id, { fills: make(s) })), label });
  const addFill = () => setAll((s) => [...(uniform ? s.fills : []), { type: 'solid', color: '#d9d9d9' }], 'Add fill');
  return (
    <div className="pg-insp-sec">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 className="pg-insp-h" style={{ margin: 0 }}>Fill</h3>
        <button type="button" style={iconBtn} aria-label="Add fill" title="Add fill" onClick={addFill}>+</button>
      </div>
      {!uniform && (
        <PaintRow
          sp={sp} board={board} value={null} label="Fill" flashKey="fills"
          apply={(v) => shapes.map((s) => upd(s.id, { fills: [withValue({ type: 'solid', color: v.color }, v)] }))}
          onRemove={() => setAll(() => [], 'Remove fill')}
        />
      )}
      {uniform && fills.length === 0 && <p className="pg-insp-hint" style={{ margin: '4px 0 0' }}>No fill</p>}
      {uniform && fills.map((p, i) => (
        <PaintRow
          key={i} sp={sp} board={board} value={paintValue(p)} hidden={p.hidden} label="Fill" flashKey="fills"
          apply={(v) => shapes.map((s) => upd(s.id, { fills: s.fills.map((f, j) => (j === i ? withValue(f, v) : f)) }))}
          onToggle={() => setAll((s) => s.fills.map((f, j) => (j === i ? { ...f, hidden: !f.hidden } : f)), p.hidden ? 'Show fill' : 'Hide fill')}
          onRemove={() => setAll((s) => s.fills.filter((_, j) => j !== i), 'Remove fill')}
        />
      ))}
    </div>
  );
}

const TEXT_DEFAULT = '#1c1917';

function TextColourBlock({ sp, board, shapes }: { sp: SelectionProps; board: SlotProps['board']; shapes: readonly Shape[] }) {
  const first = shapes[0]!.color ?? TEXT_DEFAULT;
  const mixed = shapes.some((s) => (s.color ?? TEXT_DEFAULT) !== first);
  return (
    <div className="pg-insp-sec">
      <h3 className="pg-insp-h">Text colour</h3>
      <PaintRow
        sp={sp} board={board} label="Text colour" flashKey="color" withOpacity={false}
        value={mixed ? null : { color: toHex(parseColor(first) ?? { r: 28, g: 25, b: 23 }), opacity: 1 }}
        apply={(v) => shapes.map((s) => upd(s.id, { color: v.color }))}
      />
    </div>
  );
}

export function FillSection({ board }: SlotProps) {
  const sp = useSelectionProps(board);
  const text = sp.shapes.filter((s) => s.kind === 'text');
  const other = sp.shapes.filter((s) => s.kind !== 'text' && s.kind !== 'group');
  return (
    <>
      {other.length > 0 && <FillBlock sp={sp} board={board} shapes={other} />}
      {text.length > 0 && <TextColourBlock sp={sp} board={board} shapes={text} />}
    </>
  );
}
