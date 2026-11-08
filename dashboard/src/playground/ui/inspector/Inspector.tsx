// Slot: Inspector (properties of the selection). Mounted at the top of the right panel; each section
// is its own file in ./sections, so section owners never touch this one. This shell decides which
// sections show for the selection (PROPS-1); sections read values through useSelectionProps (PROPS-10).
import { useChildren, useDoc } from '../../core/react';
import type { SlotProps } from '../slotProps';
import { AlignSection } from './sections/Align';
import { EffectsSection } from './sections/Effects';
import { FillSection } from './sections/Fill';
import { LayerSection } from './sections/Layer';
import { LayoutSection } from './sections/Layout';
import { StrokeSection } from './sections/Stroke';
import { TextSection } from './sections/Text';
import { useSelectionProps } from './useSelectionProps';
import '../../styles/inspector.css';

/** Which sections apply to a set of kinds (pure; exported for tests). */
export function sectionsFor(kinds: ReadonlySet<string>) {
  const any = kinds.size > 0;
  const onlyGroups = any && [...kinds].every((k) => k === 'group');
  return {
    align: any, layout: any, layer: any,
    text: kinds.has('text'),                 // mixed kinds: shown when at least one is text
    paint: any && !onlyGroups,               // fill / stroke / effects
  };
}

function BoardInfo({ board }: SlotProps) {
  const meta = useDoc(board.doc).meta;
  const count = useChildren(board.doc, null).length;
  return (
    <section className="pg-insp-sec" aria-label="Board">
      <h3 className="pg-insp-h">Page</h3>
      <dl className="pg-insp-info">
        <dt>Name</dt><dd>{meta.name}</dd>
        <dt>Background</dt>
        <dd><span className="pg-insp-sw" style={{ background: meta.background ?? 'var(--pg-bg)' }} />{meta.background ?? 'Default'}</dd>
        <dt>Top-level layers</dt><dd>{count}</dd>
      </dl>
      <p className="pg-insp-hint">Select a layer to edit its properties.</p>
    </section>
  );
}

function Header({ sp }: { sp: ReturnType<typeof useSelectionProps> }) {
  const n = sp.shapes.length;
  const name = n === 1 ? sp.shapes[0]!.name : `${n} layers`;
  const kinds = [...sp.kinds];
  return (
    <div className="pg-insp-top">
      <span className="pg-insp-name" title={name}>{name}</span>
      <span className="pg-insp-kind">{kinds.length === 1 ? kinds[0] : 'mixed'}</span>
    </div>
  );
}

export function Inspector(props: SlotProps) {
  const sp = useSelectionProps(props.board);
  if (!sp.shapes.length) return <div className="pg-insp"><BoardInfo {...props} /></div>;
  const show = sectionsFor(sp.kinds);
  return (
    <div className="pg-insp">
      <Header sp={sp} />
      {show.align && <AlignSection {...props} />}
      {show.layout && <LayoutSection {...props} />}
      {show.layer && <LayerSection {...props} />}
      {show.text && <TextSection {...props} />}
      {show.paint && <FillSection {...props} />}
      {show.paint && <StrokeSection {...props} />}
      {show.paint && <EffectsSection {...props} />}
    </div>
  );
}
