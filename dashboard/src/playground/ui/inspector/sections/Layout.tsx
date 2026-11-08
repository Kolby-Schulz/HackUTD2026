// Inspector section "Layout" (PROPS-2, PROPS-3, PROPS-5): X/Y, W/H with lock ratio, corner radius.
// X/Y are shown in the shape's PARENT space (what the store holds), like Figma: relative to the parent frame,
// absolute for page-root layers. A rotated shape shows its unrotated box origin, not the rotated bounding box.
import type { CSSProperties } from 'react';
import type { Shape, ShapeProps } from '../../../core/types';
import type { SlotProps } from '../../slotProps';
import { NumberField } from '../NumberField';
import { mixedValue, useSelectionProps } from '../useSelectionProps';
import type { SelectionProps } from '../useSelectionProps';

const MIN_SIZE = 0.01;
const row: CSSProperties = { display: 'grid', gap: 6, alignItems: 'center', marginBottom: 6 };

/** W/H patch: with lockRatio the other side follows the ratio of the shape's current (gesture-base) box. */
export function sizePatch(s: Shape, side: 'w' | 'h', value: number): Partial<ShapeProps> {
  const v = Math.max(MIN_SIZE, value);
  const patch: Partial<ShapeProps> = { [side]: v };
  if (s.lockRatio && s.w > 0 && s.h > 0) {
    if (side === 'w') patch.h = Math.max(MIN_SIZE, (v * s.h) / s.w);
    else patch.w = Math.max(MIN_SIZE, (v * s.w) / s.h);
  }
  // Text (TEXT-4): editing W fixes the width (height still follows the content), editing H fixes the box.
  if (s.kind === 'text') patch.textMode = side === 'w' ? (s.textMode === 'fixed' ? 'fixed' : 'auto-h') : 'fixed';
  return patch;
}

/** Selection view where radius is always a single number (the tl value), so NumberField can edit it. */
function withRadius(sp: SelectionProps): { sp: SelectionProps; arrays: boolean } {
  const shapes = sp.shapes.map((s) => (Array.isArray(s.radius) ? { ...s, radius: s.radius[0] } : { ...s, radius: s.radius ?? 0 }));
  const arrays = sp.shapes.some((s) => Array.isArray(s.radius));
  return {
    arrays,
    sp: { ...sp, shapes, get: (key) => (key === 'radius' && arrays ? { mixed: true } : mixedValue(shapes, key)) },
  };
}

const LockIcon = ({ on }: { on: boolean }) => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden>
    {on
      ? <path d="M6.5 9.5a2.5 2.5 0 0 0 3.5 0l2-2a2.5 2.5 0 0 0-3.5-3.5l-.5.5M9.5 6.5a2.5 2.5 0 0 0-3.5 0l-2 2a2.5 2.5 0 0 0 3.5 3.5l.5-.5" />
      : <path d="M6.5 9.5a2.5 2.5 0 0 0 3.5 0M5 7 4 8a2.5 2.5 0 0 0 3.5 3.5L8 11M11 9l1-1A2.5 2.5 0 0 0 8.500 4.500L8 5" />}
  </svg>
);

export function LayoutSection({ board }: SlotProps) {
  const raw = useSelectionProps(board);
  if (!raw.shapes.length) return null;
  const { sp } = withRadius(raw);
  const lock = sp.get('lockRatio');
  const locked = !lock.mixed && !!lock.value;
  const hasRadius = sp.shapes.some((s) => s.kind === 'rect' || s.kind === 'frame');
  const toggleLock = () => { sp.set({ lockRatio: lock.mixed ? true : !lock.value }, 'Toggle lock ratio'); };

  return (
    <section className="pg-insp-sec" aria-label="Layout">
      <h3 className="pg-insp-h">Layout</h3>
      <div style={{ ...row, gridTemplateColumns: '1fr 1fr' }}>
        <NumberField board={board} sp={sp} prop="x" label="X" ariaLabel="X position" decimals={2} undoLabel="Set X" />
        <NumberField board={board} sp={sp} prop="y" label="Y" ariaLabel="Y position" decimals={2} undoLabel="Set Y" />
      </div>
      <div style={{ ...row, gridTemplateColumns: '1fr 1fr 24px' }}>
        <NumberField board={board} sp={sp} prop="w" label="W" ariaLabel="Width" min={MIN_SIZE} undoLabel="Set width"
          toPatch={(v, s) => sizePatch(s, 'w', v)} />
        <NumberField board={board} sp={sp} prop="h" label="H" ariaLabel="Height" min={MIN_SIZE} undoLabel="Set height"
          toPatch={(v, s) => sizePatch(s, 'h', v)} />
        <button
          type="button" aria-pressed={locked} aria-label="Lock aspect ratio" title={locked ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
          onClick={toggleLock}
          style={{
            height: 24, width: 24, display: 'grid', placeItems: 'center', border: 0, borderRadius: 4, cursor: 'pointer',
            background: locked ? 'var(--pg-hover)' : 'transparent', color: locked ? 'var(--pg-accent)' : 'var(--pg-muted)',
          }}
        ><LockIcon on={locked} /></button>
      </div>
      {hasRadius && (
        <div style={{ ...row, gridTemplateColumns: '1fr 1fr', marginBottom: 0 }}>
          <NumberField
            board={board} sp={sp} prop={'radius' as 'x'} min={0} undoLabel="Set corner radius" ariaLabel="Corner radius"
            label={<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden><path d="M3 13V8a5 5 0 0 1 5-5h5" /></svg>}
          />
        </div>
      )}
    </section>
  );
}
