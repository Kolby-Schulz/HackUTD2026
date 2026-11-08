// Inspector section "Typography" (TEXT-5..8): font family, size, weight, line height, letter spacing,
// horizontal/vertical alignment and text mode for text layers. Colour lives in the Fill section.
// Every control writes through sp.set / NumberField, so one committed edit = one undo entry; Mixed shows as a blank
// select option / 'Mixed' placeholder; useFieldFlash tints a field when an agent changes it.
import type { CSSProperties, ReactNode } from 'react';
import type { Shape, ShapeProps } from '../../../core/types';
import type { SlotProps } from '../../slotProps';
import { NumberField } from '../NumberField';
import { mixedValue, useFieldFlash, useSelectionProps } from '../useSelectionProps';
import type { SelectionProps } from '../useSelectionProps';

const SYSTEM = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
/** Local/system stacks only: no web-font downloads. */
export const FONTS: { label: string; value: string }[] = [
  { label: 'System UI', value: SYSTEM },
  { label: 'Inter', value: 'Inter, ' + SYSTEM },
  { label: 'Roboto', value: 'Roboto, ' + SYSTEM },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Times', value: '"Times New Roman", Times, serif' },
  { label: 'Menlo (mono)', value: 'Menlo, Consolas, monospace' },
];
export const WEIGHTS: [number, string][] = [
  [100, 'Thin'], [200, 'Extra Light'], [300, 'Light'], [400, 'Regular'], [500, 'Medium'],
  [600, 'Semi Bold'], [700, 'Bold'], [800, 'Extra Bold'], [900, 'Black'],
];
const H_ALIGN: ['left' | 'center' | 'right' | 'justify', string, string][] = [
  ['left', 'Align left', 'M2 3h12M2 6.5h8M2 10h12M2 13.5h8'], ['center', 'Align centre', 'M2 3h12M4 6.5h8M2 10h12M4 13.5h8'],
  ['right', 'Align right', 'M2 3h12M6 6.5h8M2 10h12M6 13.5h8'], ['justify', 'Justify', 'M2 3h12M2 6.5h12M2 10h12M2 13.5h8'],
];
const V_ALIGN: ['top' | 'middle' | 'bottom', string, string][] = [
  ['top', 'Align top', 'M2 2.5h12M5 5.5v8M11 5.5v5'], ['middle', 'Align middle', 'M2 8h12M5 3v10M11 5v6'],
  ['bottom', 'Align bottom', 'M2 13.5h12M5 2.5v8M11 5.500v5'],
];
const MODES: ['auto-w' | 'auto-h' | 'fixed', string, string][] = [
  ['auto-w', 'Auto width', 'M2 8h12M2 5.500v5M14 5.500v5'], ['auto-h', 'Auto height', 'M8 2v12M5.500 2h5M5.500 14h5'],
  ['fixed', 'Fixed size', 'M3 3h10v10H3z'],
];

const row: CSSProperties = { display: 'grid', gap: 6, alignItems: 'center', marginBottom: 6 };
const selectStyle: CSSProperties = {
  width: '100%', minWidth: 0, height: 24, borderRadius: 4, border: '1px solid var(--pg-line)',
  background: 'var(--pg-surface, var(--pg-bg))', color: 'var(--pg-ink)', font: 'inherit', padding: '0 4px',
};
const MIXED = '__mixed__';

/** Line height is stored as px or 'auto' (1.2 x size); show 'auto' as that px value so NumberField can step it. */
function withLineHeight(sp: SelectionProps): SelectionProps {
  const px = (s: Shape): Shape =>
    s.lineHeight === undefined || s.lineHeight === 'auto' ? { ...s, lineHeight: Math.round((s.fontSize ?? 16) * 1.2 * 100) / 100 } : s;
  const shapes = sp.shapes.map(px);
  return { ...sp, shapes, get: (key) => mixedValue(shapes, key) };
}

function SelectField<T extends string | number>(props: {
  sp: SelectionProps; board: SlotProps['board']; prop: keyof ShapeProps; label: string; undo: string;
  options: { value: T; label: string }[]; fallback?: T;
}) {
  const { sp, board, prop, label, undo, options, fallback } = props;
  const flash = useFieldFlash(board, sp, prop);
  const v = sp.get(prop);
  const cur = v.mixed ? MIXED : String(v.value ?? fallback ?? '');
  const known = options.some((o) => String(o.value) === cur);
  return (
    <select
      aria-label={label} value={cur} className={flash.className} style={{ ...selectStyle, ...flash.style }} data-agent={flash.agent ?? undefined}
      onChange={(e) => {
        const o = options.find((x) => String(x.value) === e.target.value);
        if (o) sp.set({ [prop]: o.value } as Partial<ShapeProps>, undo);
      }}
    >
      {v.mixed && <option value={MIXED} disabled>Mixed</option>}
      {!v.mixed && !known && <option value={cur}>{cur || 'Custom'}</option>}
      {options.map((o) => <option key={String(o.value)} value={String(o.value)} style={prop === 'fontFamily' ? { fontFamily: String(o.value) } : undefined}>{o.label}</option>)}
    </select>
  );
}

function IconGroup<T extends string>(props: {
  sp: SelectionProps; board: SlotProps['board']; prop: 'textAlign' | 'textVAlign' | 'textMode'; items: [T, string, string][]; undo: string; fallback: T;
}) {
  const { sp, board, prop, items, undo, fallback } = props;
  const flash = useFieldFlash(board, sp, prop);
  const v = sp.get(prop);
  const cur = v.mixed ? null : ((v.value as T | undefined) ?? fallback);
  return (
    <div role="group" aria-label={undo} className={flash.className} style={{ display: 'flex', gap: 2, ...flash.style }} data-agent={flash.agent ?? undefined}>
      {items.map(([val, title, d]) => (
        <button
          key={val} type="button" title={title} aria-label={title} aria-pressed={cur === val}
          onClick={() => sp.set({ [prop]: val } as Partial<ShapeProps>, undo)}
          style={{
            width: 26, height: 24, display: 'grid', placeItems: 'center', border: 0, borderRadius: 4, cursor: 'pointer',
            background: cur === val ? 'var(--pg-hover)' : 'transparent', color: cur === val ? 'var(--pg-accent)' : 'var(--pg-muted)',
          }}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden><path d={d} /></svg>
        </button>
      ))}
    </div>
  );
}

const Label = ({ children }: { children: ReactNode }) => <span style={{ color: 'var(--pg-muted)' }}>{children}</span>;

export function TextSection({ board }: SlotProps) {
  const raw = useSelectionProps(board);
  const texts = raw.shapes.filter((s) => s.kind === 'text');
  if (!texts.length || texts.length !== raw.shapes.length) return null;
  const sp = withLineHeight(raw);
  const autoLh = raw.shapes.some((s) => s.lineHeight !== undefined && s.lineHeight !== 'auto') ? raw.get('lineHeight') : null;
  const isAuto = !autoLh; // every shape on 'auto'
  return (
    <section className="pg-insp-sec" aria-label="Typography">
      <h3 className="pg-insp-h">Typography</h3>
      <div style={{ ...row, gridTemplateColumns: '1fr' }}>
        <SelectField sp={raw} board={board} prop="fontFamily" label="Font family" undo="Set font family" fallback={SYSTEM}
          options={FONTS.map((f) => ({ value: f.value, label: f.label }))} />
      </div>
      <div style={{ ...row, gridTemplateColumns: '1fr 1fr' }}>
        <NumberField board={board} sp={sp} prop="fontSize" label="Aa" ariaLabel="Font size" min={1} max={999} decimals={1} undoLabel="Set font size" />
        <SelectField sp={raw} board={board} prop="fontWeight" label="Font weight" undo="Set font weight" fallback={400}
          options={WEIGHTS.map(([value, label]) => ({ value, label }))} />
      </div>
      <div style={{ ...row, gridTemplateColumns: '1fr 1fr' }}>
        <NumberField board={board} sp={sp} prop={'lineHeight' as 'x'} label={<Label>LH</Label>} ariaLabel="Line height" unit="px" min={0} decimals={1} undoLabel="Set line height" />
        <NumberField board={board} sp={sp} prop="letterSpacing" label={<Label>LS</Label>} ariaLabel="Letter spacing" unit="px" min={-100} max={100} decimals={2} undoLabel="Set letter spacing" />
      </div>
      {!isAuto && (
        <button type="button" onClick={() => raw.set({ lineHeight: 'auto' }, 'Set line height auto')}
          style={{ border: 0, background: 'transparent', color: 'var(--pg-accent)', cursor: 'pointer', font: 'inherit', padding: 0, marginBottom: 6 }}>
          Reset line height to Auto
        </button>
      )}
      <div style={{ ...row, gridTemplateColumns: '1fr 1fr' }}>
        <IconGroup sp={raw} board={board} prop="textAlign" items={H_ALIGN} undo="Set text alignment" fallback="left" />
        <IconGroup sp={raw} board={board} prop="textVAlign" items={V_ALIGN} undo="Set vertical alignment" fallback="top" />
      </div>
      <div style={{ ...row, gridTemplateColumns: '1fr', marginBottom: 0 }}>
        <IconGroup sp={raw} board={board} prop="textMode" items={MODES} undo="Set text mode" fallback="auto-w" />
      </div>
    </section>
  );
}
