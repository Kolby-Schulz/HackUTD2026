// Inspector section "Export" (WP-64 seam): PNG of the selection at 1x / 2x / 3x.
import { exportSelection } from '../../../actions/share';
import type { SlotProps } from '../../slotProps';

export function ExportSection({ board }: SlotProps) {
  return (
    <section className="pg-insp-sec" aria-label="Export">
      <h3 className="pg-insp-h">Export</h3>
      <div role="group" aria-label="Export as PNG" style={{ display: 'flex', gap: 6 }}>
        {([1, 2, 3] as const).map((s) => (
          <button key={s} type="button" className="pg-share" title={`Export selection as PNG at ${s}x`} onClick={() => void exportSelection(board, s)}>
            PNG {s}x
          </button>
        ))}
      </div>
    </section>
  );
}
