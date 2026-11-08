// Inspector section "Layer" (PROPS-18, PROPS-19): opacity %, visibility, and Clip content for frames.
import { useEffect, useRef } from 'react';
import { opId } from '../../../core/ids';
import type { SlotProps } from '../../slotProps';
import { NumberField } from '../NumberField';
import { mixedValue, useSelectionProps } from '../useSelectionProps';

export function LayerSection({ board }: SlotProps) {
  const raw = useSelectionProps(board);
  const clipBox = useRef<HTMLInputElement>(null);
  // Unset opacity means 1, unset clip means true for frames: give the field and checkbox real values.
  const shapes = raw.shapes.map((s) => ({ ...s, opacity: s.opacity ?? 1 }));
  const sp = { ...raw, shapes, get: ((key: Parameters<typeof raw.get>[0]) => mixedValue(shapes, key)) as typeof raw.get };

  const frames = raw.shapes.filter((s) => s.kind === 'frame');
  const clipOn = frames.filter((f) => f.clip !== false).length;
  const clipMixed = clipOn > 0 && clipOn < frames.length;
  useEffect(() => { if (clipBox.current) clipBox.current.indeterminate = clipMixed; }, [clipMixed]);

  if (!raw.shapes.length) return null;
  const hiddenCount = raw.shapes.filter((s) => s.hidden).length;
  const allHidden = hiddenCount === raw.shapes.length;
  const setClip = (clip: boolean) => {
    board.exec({
      actor: board.me, opId: opId(board.me), label: 'Toggle clip content',
      commands: [{ t: 'shape.update', ids: frames.map((f) => f.id), patch: { clip } }],
    });
  };

  return (
    <section className="pg-insp-sec" aria-label="Layer">
      <h3 className="pg-insp-h">Layer</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 24px', gap: 6, alignItems: 'center' }}>
        <NumberField board={board} sp={sp} prop="opacity" label="Opacity" ariaLabel="Layer opacity" unit="%" scale={100} min={0} max={100}
          decimals={1} step={1} undoLabel="Set opacity" />
        <button
          type="button" aria-pressed={allHidden} aria-label={allHidden ? 'Show layer' : 'Hide layer'} title={allHidden ? 'Show layer' : 'Hide layer'}
          onClick={() => { sp.set({ hidden: !allHidden }, allHidden ? 'Show layers' : 'Hide layers'); }}
          style={{
            height: 24, width: 24, display: 'grid', placeItems: 'center', border: 0, borderRadius: 4, cursor: 'pointer',
            background: allHidden ? 'var(--pg-hover)' : 'transparent', color: hiddenCount ? 'var(--pg-accent)' : 'var(--pg-muted)',
          }}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden>
            <path d="M1.5 8S4 3.500 8 3.500 14.500 8 14.500 8 12 12.500 8 12.500 1.500 8 1.500 8z" />
            {allHidden ? <path d="M2.500 2.500l11 11" /> : <circle cx="8" cy="8" r="2" />}
          </svg>
        </button>
      </div>
      {frames.length > 0 && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, cursor: 'pointer', color: 'var(--pg-ink-body)' }}>
          <input ref={clipBox} type="checkbox" checked={clipOn === frames.length} onChange={(e) => setClip(e.target.checked)} />
          Clip content
        </label>
      )}
    </section>
  );
}
