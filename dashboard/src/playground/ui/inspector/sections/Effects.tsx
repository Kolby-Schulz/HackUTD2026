// Inspector section "Effects" (PROPS-21): stacked drop shadows, inner shadows and layer blur.
// Each row: swatch, type, eye, minus; then X / Y / Blur / Spread fields. Renders via box-shadow (render/style.ts).
import type { Command, Effect, Shape } from '../../../core/types';
import type { SlotProps } from '../../slotProps';
import { useFieldFlash, useSelectionProps } from '../useSelectionProps';
import type { SelectionProps } from '../useSelectionProps';
import { ColorSwatch, NumInput, SectionHead, box, fromValue, iconBtn, opId, row, toValue, upd } from './Stroke';

type Board = SlotProps['board'];
const DEFAULT_DROP: Effect = { type: 'drop', x: 0, y: 4, blur: 4, spread: 0, color: '#00000040' };
const LABEL = { drop: 'Drop shadow', inner: 'Inner shadow', blur: 'Layer blur' } as const;
const defaultFor = (type: Effect['type']): Effect => (type === 'blur' ? { type, x: 0, y: 0, blur: 4, color: '#000000' } : { ...DEFAULT_DROP, type });

function EffectRow({ sp, board, shapes, index, effect }: {
  sp: SelectionProps; board: Board; shapes: readonly Shape[]; index: number; effect: Effect;
}) {
  const flash = useFieldFlash(board, sp, 'effects');
  const hidden = !!effect.hidden;
  const run = (commands: Command[], label: string) => board.exec({ actor: board.me, opId: opId('effect'), commands, label });
  const edit = (patch: Partial<Effect>): Command[] =>
    shapes.map((s) => upd(s.id, { effects: (s.effects ?? []).map((e, j) => (j === index ? { ...e, ...patch } : e)) }));
  const num = (key: 'x' | 'y' | 'blur' | 'spread', label: string, min?: number) => (
    <NumInput label={label} min={min} max={500} value={effect[key] ?? 0} onCommit={(n) => run(edit({ [key]: n }), `Change ${LABEL[effect.type].toLowerCase()} ${label}`)} />
  );
  return (
    <div className={flash.className} style={{ ...flash.style, opacity: hidden ? 0.5 : 1, paddingBottom: 4 }} data-agent={flash.agent ?? undefined}>
      <div style={row}>
        {effect.type !== 'blur' && (
          <ColorSwatch board={board} value={toValue(effect.color)} label="Shadow" gestureKey={`effects:${index}:${sp.ids.join(',')}`} apply={(v) => edit({ color: fromValue(v) })} />
        )}
        <div style={{ ...box, flex: 1, padding: 0 }}>
          <select
            aria-label="Effect type" value={effect.type}
            onChange={(e) => {
              const t = e.target.value as Effect['type'];
              run(edit({ ...defaultFor(t), ...(t !== 'blur' && effect.type !== 'blur' ? { x: effect.x, y: effect.y, blur: effect.blur, spread: effect.spread, color: effect.color } : {}), hidden: effect.hidden }), `Change to ${LABEL[t].toLowerCase()}`);
            }}
            style={{ flex: 1, minWidth: 0, height: 22, border: 0, outline: 0, background: 'transparent', color: 'var(--pg-ink)', font: 'inherit' }}
          >
            {(Object.keys(LABEL) as Effect['type'][]).map((t) => <option key={t} value={t}>{LABEL[t]}</option>)}
          </select>
        </div>
        <button type="button" style={iconBtn} aria-label={hidden ? 'Show effect' : 'Hide effect'} aria-pressed={hidden} title={hidden ? 'Show' : 'Hide'}
          onClick={() => run(edit({ hidden: !hidden }), hidden ? 'Show effect' : 'Hide effect')}>{hidden ? '◌' : '◉'}</button>
        <button type="button" style={iconBtn} aria-label="Remove effect" title="Remove"
          onClick={() => run(shapes.map((s) => upd(s.id, { effects: (s.effects ?? []).filter((_, j) => j !== index) })), 'Remove effect')}>−</button>
      </div>
      {effect.type === 'blur' ? (
        <div style={row}>{num('blur', 'Blur', 0)}</div>
      ) : (
        <>
          <div style={row}>{num('x', 'X')}{num('y', 'Y')}</div>
          <div style={row}>{num('blur', 'B', 0)}{num('spread', 'S')}</div>
        </>
      )}
    </div>
  );
}

export function EffectsSection({ board }: SlotProps) {
  const sp = useSelectionProps(board);
  const shapes = sp.shapes.filter((s) => s.kind !== 'group');
  if (!shapes.length) return null;
  const first = shapes[0]!.effects ?? [];
  const uniform = shapes.every((s) => JSON.stringify(s.effects ?? []) === JSON.stringify(first));
  const run = (commands: Command[], label: string) => board.exec({ actor: board.me, opId: opId('effect'), commands, label });
  const add = () => run(shapes.map((s) => upd(s.id, { effects: [...(uniform ? s.effects ?? [] : []), { ...DEFAULT_DROP }] })), 'Add drop shadow');
  return (
    <div className="pg-insp-sec">
      <SectionHead title="Effects" addLabel="Add effect" onAdd={add} />
      {!uniform && (
        <div style={row}>
          <span className="pg-mixed" style={{ flex: 1 }}>Mixed effects</span>
          <button type="button" style={iconBtn} aria-label="Remove effects" title="Remove all" onClick={() => run(shapes.map((s) => upd(s.id, { effects: [] })), 'Remove effects')}>−</button>
        </div>
      )}
      {uniform && first.length === 0 && <p className="pg-insp-hint" style={{ margin: '4px 0 0' }}>No effects</p>}
      {uniform && first.map((e, i) => <EffectRow key={i} sp={sp} board={board} shapes={shapes} index={i} effect={e} />)}
    </div>
  );
}
