// Self-contained pieces of #/variants: segmented control, overlay comparison, name and width dialogs.
import { useRef, useState } from 'react';
import type { ComponentType, CSSProperties, ReactNode } from 'react';
import { COLORS } from './constants.ts';
import type { Graph } from './model.ts';
import { Frame, NodeView } from './NodeView.tsx';
import type { Zoom } from './NodeView.tsx';
import type { Screen } from './registry.ts';
import type { BoardRef, NodeId, SlotId } from './types.ts';
import { matchSlots } from './boards.ts';
import type { BoardData, FrameInfo } from './boards.ts';
import { Dialog } from './ui.tsx';

export function Seg<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: [T, ReactNode][]; label?: string }) {
  return (
    <div className="vx-seg" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{text}</button>
      ))}
    </div>
  );
}

/** A and B stacked in one frame at the same scale: drag the line to swipe, or fade B over A. */
export function OverlayPane(p: {
  a: NodeId; b: NodeId; graph: Graph; screen: Screen; comp: (v: NodeId, s: SlotId) => ComponentType | undefined; width: number; zoom: Zoom; isolate: SlotId | null;
  state: { kind: 'swipe' | 'onion'; pos: number; top: number }; onState: (s: { kind: 'swipe' | 'onion'; pos: number; top: number }) => void;
  titleOf: (id: NodeId) => string; onScale: (s: number) => void; pct: string;
}) {
  const { kind, pos } = p.state;
  const stack = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const setPos = (clientX: number) => {
    const r = stack.current?.getBoundingClientRect();
    if (!r) return;
    p.onState({ ...p.state, pos: Math.round(Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100))) });
  };
  const layer = (id: NodeId, i: number, style?: CSSProperties) => (
    <div className="vx-layer" style={style}>
      <Frame width={p.width} zoom={p.zoom} onScale={i === 0 ? p.onScale : undefined}>
        <NodeView screen={p.screen} graph={p.graph} nodeId={id} comp={p.comp} isolate={p.isolate} color={COLORS[i]} picked={new Set()} />
      </Frame>
    </div>
  );
  return (
    <section className="vx-pane overlay" aria-label="Overlay comparison">
      <div className="vx-pane-head">
        <span className="vx-badge" style={{ background: COLORS[0] }}>A</span>
        <span className="vx-pane-title ellipsis">{p.titleOf(p.a)}</span>
        <span className="vx-vs">vs</span>
        <span className="vx-badge" style={{ background: COLORS[1] }}>B</span>
        <span className="vx-pane-title ellipsis">{p.titleOf(p.b)}</span>
        <div className="vx-grow" />
        <span className="vx-zoom">{p.pct}</span>
        <Seg label="Overlay style" value={kind} onChange={(k) => p.onState({ ...p.state, kind: k })} options={[['swipe', 'Swipe'], ['onion', 'Onion skin']]} />
        <label className="vx-slider">
          <span className="vx-sr">{kind === 'swipe' ? 'Swipe position' : 'Opacity of B'}</span>
          <input type="range" min={0} max={100} value={pos} onChange={(e) => p.onState({ ...p.state, pos: Number(e.target.value) })} />
          <span className="vx-zoom">{pos}%</span>
        </label>
      </div>
      <div className="vx-crumbs">
        <span>{kind === 'swipe' ? 'Drag across the design to move the line: A on the left, B on the right.' : 'B is drawn over A. Use the slider to fade between them.'}</span>
      </div>
      <div className="vx-canvas-area">
        <div
          ref={stack}
          className={`vx-stack${kind === 'swipe' ? ' swipe' : ''}`}
          onPointerDown={(e) => { if (kind !== 'swipe') return; dragging.current = true; (e.target as Element).setPointerCapture?.(e.pointerId); setPos(e.clientX); }}
          onPointerMove={(e) => { if (dragging.current) setPos(e.clientX); }}
          onPointerUp={() => { dragging.current = false; }}
        >
          {layer(p.a, 0)}
          {layer(p.b, 1, kind === 'swipe' ? { clipPath: `inset(0 0 0 ${pos}%)` } : { opacity: pos / 100 })}
          {kind === 'swipe' && (
            <div className="vx-swipe-line" style={{ left: `${pos}%` }} aria-hidden="true">
              <span style={{ background: COLORS[0] }}>A</span><span style={{ background: COLORS[1] }}>B</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export function NameDialog(p: {
  heading: string; defaultTitle: string; placeholder?: string; confirm: string; children?: ReactNode;
  onCancel: () => void; onConfirm: (title: string, note: string) => void;
}) {
  const [title, setTitle] = useState(p.defaultTitle);
  const [note, setNote] = useState('');
  return (
    <Dialog heading={p.heading} onClose={p.onCancel}>
      <form className="vx-form" onSubmit={(e) => { e.preventDefault(); p.onConfirm(title, note); }}>
        <label>Name<input autoFocus value={title} placeholder={p.placeholder} onChange={(e) => setTitle(e.target.value)} /></label>
        <label>Why (optional)<textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What this decides, or what to try next" /></label>
        {p.children}
        <div className="vx-dialog-actions">
          <button type="button" className="vx-btn" onClick={p.onCancel}>Cancel</button>
          <button type="submit" className="vx-btn primary">{p.confirm}</button>
        </div>
      </form>
    </Dialog>
  );
}

export function WidthDialog(p: { pane: string; initial: number; onCancel: () => void; onConfirm: (w: number) => void }) {
  const [v, setV] = useState(String(p.initial));
  const n = Math.round(Number(v));
  const ok = Number.isFinite(n) && n >= 240 && n <= 2560;
  return (
    <Dialog heading={`Width of pane ${p.pane}`} onClose={p.onCancel} width={340}>
      <form className="vx-form" onSubmit={(e) => { e.preventDefault(); if (ok) p.onConfirm(n); }}>
        <label>Width in pixels<input autoFocus inputMode="numeric" value={v} onChange={(e) => setV(e.target.value)} aria-describedby="vx-w-help" aria-invalid={!ok} /></label>
        <p id="vx-w-help" className={`vx-note${ok ? '' : ' err'}`}>{ok ? 'Between 240 and 2560. Other panes keep their width.' : 'Enter a number between 240 and 2560.'}</p>
        <div className="vx-dialog-actions">
          <button type="button" className="vx-btn" onClick={p.onCancel}>Cancel</button>
          <button type="submit" className="vx-btn primary" disabled={!ok}>Set width</button>
        </div>
      </form>
    </Dialog>
  );
}

/** Lists the playground board's top-level frames: link one live, or copy it in as a frozen design. */
export function ImportDialog(p: {
  board: BoardData | null; frames: FrameInfo[]; linked: Map<string, BoardRef>; slots: Record<SlotId, string>;
  onLink: (f: FrameInfo, mode: 'live' | 'copy') => void; onShow: (id: NodeId) => void; onClose: () => void;
}) {
  return (
    <Dialog heading="Bring in from the playground" onClose={p.onClose} width={560}>
      {!p.board ? (
        <div className="vx-import-empty">
          <p>There’s no playground board saved in this browser yet.</p>
          <p className="vx-note">Open the playground, draw or ask agents for a few frames, then come back. Frames appear here as soon as the board saves.</p>
          <div className="vx-dialog-actions">
            <button type="button" className="vx-btn" onClick={p.onClose}>Close</button>
            <a className="vx-btn primary" href="#/playground">Open the playground</a>
          </div>
        </div>
      ) : (
        <>
          <p className="vx-note">
            <b>Link</b> keeps a frame in sync with the board. <b>Copy</b> freezes it as it is now and saves it with the designs. Name a frame’s
            layers after this screen’s parts ({Object.values(p.slots).join(', ')}) to mix them part by part; otherwise the frame is compared as a whole page.
          </p>
          {p.frames.length === 0 ? (
            <p className="vx-import-empty">The board “{p.board.name}” has no frames yet.</p>
          ) : (
            <ul className="vx-import">
              {p.frames.map((f) => {
                const parts = Object.keys(matchSlots(p.board!, f.id, p.slots)).map((s) => p.slots[s]);
                const ref = p.linked.get(f.id);
                return (
                  <li key={f.id}>
                    <div className="vx-import-main">
                      <b className="ellipsis">{f.name}</b>
                      <span className="vx-note">
                        <span className="mono">{f.w}×{f.h}</span> · {f.layers} layer{f.layers === 1 ? '' : 's'} · {parts.length ? `Parts: ${parts.join(', ')}` : 'Whole page'}
                      </span>
                    </div>
                    {ref ? (
                      <button className="vx-btn ghost" onClick={() => p.onShow(ref.id)}>{ref.mode === 'live' ? 'Linked' : 'Copied'} · Show</button>
                    ) : (
                      <>
                        <button className="vx-btn" onClick={() => p.onLink(f, 'copy')}>Copy</button>
                        <button className="vx-btn primary" onClick={() => p.onLink(f, 'live')}>Link live</button>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <div className="vx-dialog-actions"><button type="button" className="vx-btn" onClick={p.onClose}>Done</button></div>
        </>
      )}
    </Dialog>
  );
}
