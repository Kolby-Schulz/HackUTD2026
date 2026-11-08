// Floating tool palette at the bottom of the board, plus the controls hint.
import type { Tool, UiStore } from '../board/state';
import { TOOL_KEYS } from '../../actions/tools';
import { runAction } from '../../core/actions';
import { BUBBLE } from '../constants';
import { useUi } from '../hooks';
import '../../styles/toolbar.css';

const TOOLS: { id: Tool; label: string; icon: string }[] = [
  { id: 'select', label: 'Move', icon: 'M5 3l14 8-6.5 1.5L10 19z' },
  { id: 'frame', label: 'Frame', icon: 'M8 3v18M16 3v18M3 8h18M3 16h18' },
  { id: 'rect', label: 'Rectangle', icon: 'M4 5h16v14H4z' },
  { id: 'ellipse', label: 'Ellipse', icon: 'M12 4a8 8 0 1 0 0 16 8 8 0 1 0 0-16z' },
  { id: 'text', label: 'Text', icon: 'M5 5h14M12 5v14M9 19h6' },
  { id: 'comment', label: 'Comment: point at a layer, the note goes to its agent', icon: BUBBLE },
  { id: 'hand', label: 'Hand', icon: 'M8 13V6a1.5 1.5 0 0 1 3 0v5m0-6a1.5 1.5 0 0 1 3 0v6m0-5a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-3l-2.5-4.5a1.5 1.5 0 0 1 2.5-1.5L8 15' },
];

/** Switch tool and drop any popover or hover state tied to the old one. */
export const pickTool = (ui: UiStore, t: Tool) => ui.set({ tool: t, pop: null, hover: null });

export function Toolbar({ ui }: { ui: UiStore }) {
  const tool = useUi(ui, 'tool');
  return (
    <>
      <div className="pg-toolbar">
        {TOOLS.map((t) => (
          <button key={t.id} className={tool === t.id ? 'on' : ''} title={`${t.label} (${TOOL_KEYS[t.id].toUpperCase()})`} aria-label={t.label} aria-pressed={tool === t.id} onClick={() => { if (runAction(`tool.${t.id}`) !== true) pickTool(ui, t.id); }}>
            <svg viewBox="0 0 24 24" width="18" height="18"><path d={t.icon} /></svg>
          </button>
        ))}
      </div>
      <div className="pg-hint">Scroll to pan · ⌘/Ctrl + scroll to zoom · Space-drag to pan · Shift+1 fit</div>
    </>
  );
}
