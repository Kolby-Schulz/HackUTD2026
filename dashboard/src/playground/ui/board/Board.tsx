// The board viewport (CANVAS-15, D5): dot grid, world layer with nested shape DOM, and a
// screen-space overlay layer for selection, hover, cursors, pins and popovers.
//
// The camera lives in core/camera.ts. One scheduler subscriber (the painter) writes the world
// transform and every screen-space overlay position once per frame, so wheel / pan / zoom cause
// no React render of the board. Pointer input goes to the gesture pipeline; every document
// change goes through board.gesture / board.exec.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { BoardKit } from '../../core/commands';
import type { CameraStore } from '../../core/camera';
import { scheduler } from '../../core/raf';
import type { FrameSub } from '../../core/raf';
import { useChildren } from '../../core/react';
import type { Cam } from '../../core/types';
import { createPipeline, shapeAt } from '../gestures/pipeline';
import { enterAt } from '../gestures/select';
import type { PointerInfo } from '../gestures/pipeline';
import { trackSpace } from '../gestures/pan';
import { startEditing } from '../gestures/text';
import { Claims } from '../overlays/Claims';
import { Hover } from '../overlays/Hover';
import type { DescribeTarget } from '../overlays/Hover';
import { Marquee } from '../overlays/Marquee';
import { Measure } from '../overlays/Measure';
import { OffscreenChips } from '../overlays/OffscreenChips';
import { Readout } from '../overlays/Readout';
import { RemoteSelections } from '../overlays/RemoteSelections';
import { SelectionBox } from '../overlays/SelectionBox';
import { SmartGuides } from '../overlays/SmartGuides';
import { BoardEnvContext, useBoardEnv } from './context';
import { DotGrid } from './DotGrid';
import { isVisible } from './culling';
import { ShapeView } from './ShapeView';
import { setActiveBoard } from './state';
import type { BoardEnv, Painter, UiStore } from './state';
import { attachWheel } from './wheel';
import '../../styles/board.css';

/** Elements inside the board that handle their own pointer input (popover, pins, toolbar, editors). */
const OWN_INPUT = '[data-pg-ui], textarea, input, select, .pg-pop, .pg-pin, .pg-toolbar';

/** The paint frame. Registered with the scheduler while the board is mounted (StrictMode safe). */
function createPainter(camera: CameraStore, world: () => HTMLElement | null): Painter & { start(): void; stop(): void } {
  const fns = new Set<(cam: Cam) => void>();
  const frame = () => {
    const cam = camera.getCam();
    const w = world();
    if (w) {
      w.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})`;
      w.style.setProperty('--pg-zi', String(1 / cam.z));
    }
    for (const f of [...fns]) {
      try { f(cam); } catch (e) { console.error('[board] painter failed', e); }
    }
  };
  let sub: FrameSub | null = null;
  return {
    add(fn) { fns.add(fn); return () => { fns.delete(fn); }; },
    wake: () => sub?.wake(),
    start() { sub ??= scheduler.register(frame, 1); frame(); },
    stop() { sub?.dispose(); sub = null; },
  };
}

/** Top-level shapes; each ShapeView renders its own subtree. */
function RootShapes() {
  const env = useBoardEnv();
  const ids = useChildren(env.board.doc, null);
  return <>{ids.filter(isVisible).map((id) => <ShapeView key={id} id={id} depth={0} />)}</>;
}

export function Board(props: {
  board: BoardKit;
  camera: CameraStore;
  ui: UiStore;
  /** Label + colour for the comment-hover outline ("Layer → Agent"). */
  describeTarget?: DescribeTarget;
  /** Shell content drawn in the screen-space overlay layer (cursors, pins, popover, toolbar). */
  children?: ReactNode;
}) {
  const viewRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const [env] = useState(() => {
    const painter = createPainter(props.camera, () => worldRef.current);
    const e: BoardEnv & { painter: typeof painter } = {
      board: props.board, camera: props.camera, ui: props.ui, paint: painter, painter,
      pointer: { x: 0, y: 0, inside: false }, pendingText: null,
      cancelGesture: () => false,
    };
    return e;
  });
  const [pipeline] = useState(() => createPipeline(env));
  env.cancelGesture = pipeline.cancel;

  useEffect(() => {
    const view = viewRef.current!;
    const { board, camera, ui, paint } = env;
    setActiveBoard(env);
    env.painter.start();
    const measure = () => camera.setViewRect(view.getBoundingClientRect());
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(view);
    const offs = [
      camera.subscribe(() => paint.wake()),
      board.doc.subscribe(() => paint.wake()),
      board.presence.subscribe(() => paint.wake()),
      attachWheel(view, camera),
      trackSpace(ui),
      ui.subscribe(() => {
        const s = ui.get();
        view.classList.toggle('panning', s.space || s.panning || s.tool === 'hand');
        view.classList.toggle('commenting', s.tool === 'comment');
      }),
    ];
    paint.wake();
    return () => {
      ro.disconnect();
      offs.forEach((f) => f());
      pipeline.cancel();
      env.painter.stop();
      setActiveBoard(null);
    };
  }, [env, pipeline]);

  const info = (e: React.PointerEvent | React.MouseEvent): PointerInfo => {
    const t = e.target as HTMLElement;
    return {
      clientX: e.clientX, clientY: e.clientY,
      world: env.camera.toWorld(e.clientX, e.clientY),
      button: e.button, shift: e.shiftKey, alt: e.altKey, mod: e.metaKey || e.ctrlKey,
      handle: t.closest<HTMLElement>('[data-handle]')?.dataset.handle,
    };
  };
  const track = (e: React.PointerEvent) => {
    const r = viewRef.current!.getBoundingClientRect();
    env.pointer.x = e.clientX - r.left;
    env.pointer.y = e.clientY - r.top;
    env.pointer.inside = true;
    const w = env.camera.toWorld(e.clientX, e.clientY);
    env.board.presence.publish({ actor: env.board.me, x: w.x, y: w.y, down: (e.buttons & 1) === 1, tool: env.ui.get().tool });
    env.paint.wake();
  };

  return (
    <BoardEnvContext.Provider value={env}>
      <div
        ref={viewRef}
        className="pg-view"
        data-pg-ctx="canvas"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest(OWN_INPUT)) return;
          // commit an open text editor before a new gesture starts (its blur handler commits)
          const active = document.activeElement as HTMLElement | null;
          if (active && active !== document.body && active.closest('.pg')) active.blur();
          viewRef.current!.setPointerCapture(e.pointerId);
          track(e);
          pipeline.down(info(e));
        }}
        onPointerMove={(e) => { track(e); pipeline.move(info(e)); }}
        onPointerUp={(e) => { track(e); pipeline.up(info(e)); }}
        onPointerCancel={() => { pipeline.cancel(); }}
        onPointerEnter={(e) => track(e)}
        onPointerLeave={() => { env.pointer.inside = false; env.ui.set({ hover: null }); env.paint.wake(); }}
        // keep focus where the board put it (a fresh text editor) and stop middle-button autoscroll
        onMouseDown={(e) => { if (!(e.target as HTMLElement).closest(OWN_INPUT)) e.preventDefault(); }}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest(OWN_INPUT)) return;
          if (env.ui.get().tool !== 'select') return;
          const id = shapeAt(env, info(e).world, true);
          const s = id ? env.board.doc.getState().shapes.get(id) : undefined;
          if (s?.kind === 'text') startEditing(env, s.id);
          else enterAt(env, info(e));
        }}
      >
        <DotGrid />
        <div ref={worldRef} className="pg-world">
          <RootShapes />
        </div>
        <div className="pg-overlays">
          <RemoteSelections />
          <Claims />
          <SelectionBox />
          <Hover describe={props.describeTarget} />
          <Marquee />
          <SmartGuides />
          <Measure />
          <Readout />
          <OffscreenChips />
          {props.children}
        </div>
      </div>
    </BoardEnvContext.Provider>
  );
}
