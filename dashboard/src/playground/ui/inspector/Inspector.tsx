// Slot: Inspector (properties of the selection). Mounted at the top of the right panel; each section
// is its own file in ./sections, so section owners never touch this one. Empty in WP-12.
import type { SlotProps } from '../slotProps';
import { AlignSection } from './sections/Align';
import { EffectsSection } from './sections/Effects';
import { FillSection } from './sections/Fill';
import { LayerSection } from './sections/Layer';
import { LayoutSection } from './sections/Layout';
import { StrokeSection } from './sections/Stroke';
import { TextSection } from './sections/Text';

export function Inspector(props: SlotProps) {
  return (
    <>
      <AlignSection {...props} />
      <LayoutSection {...props} />
      <LayerSection {...props} />
      <TextSection {...props} />
      <FillSection {...props} />
      <StrokeSection {...props} />
      <EffectsSection {...props} />
    </>
  );
}
