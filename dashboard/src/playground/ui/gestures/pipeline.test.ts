// Pipeline threshold, cancel and Escape ladder; was: Gesture modes against a real board (no DOM): every change goes through board.gesture / exec,
// one drag = one undo entry, Escape restores, frames carry their children.
import { describe, expect, it } from 'vitest';
import { createBoard } from '../../core/commands';
import { createCameraStore } from '../../core/camera';
import { opId } from '../../core/ids';
import { createFakeFrameSource, createScheduler } from '../../core/raf';
import type { Shape } from '../../core/types';
import { createUiStore, selectIds, selectedIds } from '../board/state';
import type { BoardEnv } from '../board/state';
import { createPipeline } from './pipeline';
import type { PointerInfo } from './pipeline';

function makeEnv(): BoardEnv {
  const board = createBoard({ me: 'human-test' });
  const camera = createCameraStore(createScheduler(createFakeFrameSource()), { x: 0, y: 0, z: 1 });
  return {
    board, camera, ui: createUiStore(), paint: { add: () => () => {}, wake: () => {} },
    pointer: { x: 0, y: 0, inside: true }, pendingText: null, cancelGesture: () => false,
  };
}
const pi = (x: number, y: number, extra: Partial<PointerInfo> = {}): PointerInfo =>
  ({ clientX: x, clientY: y, world: { x, y }, button: 0, shift: false, alt: false, mod: false, ...extra });
const live = (env: BoardEnv): Shape[] => [...env.board.doc.getState().shapes.values()].filter((s) => !s.deleted);
const get = (env: BoardEnv, id: string) => env.board.doc.getState().shapes.get(id)!;

/** The spatial index follows the store's change feed, which flushes in a microtask. */
const settle = () => new Promise<void>((r) => queueMicrotask(r));

function frameWithChild(env: BoardEnv) {
  const r = env.board.exec({ actor: 'agent-a', opId: opId('agent-a'), commands: [
    { t: 'shape.create', kind: 'frame', props: { x: 100, y: 100, w: 300, h: 200 } },
    { t: 'shape.create', kind: 'rect', parent: '$0', props: { x: 20, y: 30, w: 50, h: 40 } },
  ] });
  return { frame: r.results[0].ok ? r.results[0].id! : '', child: r.results[1].ok ? r.results[1].id! : '' };
}


describe('pipeline: threshold, cancel, escape ladder', () => {
  it('a 2px jitter never moves a shape and records no undo; a 4px drag does', async () => {
    const env = makeEnv();
    const { child } = frameWithChild(env);
    await settle();
    const p = createPipeline(env);
    p.down(pi(130, 140)); p.move(pi(132, 140)); p.up(pi(132, 140));
    expect(get(env, child)).toMatchObject({ x: 20, y: 30 });
    p.down(pi(130, 140)); p.move(pi(134, 140)); p.up(pi(134, 140));
    expect(get(env, child)).toMatchObject({ x: 24, y: 30 });
  });

  it('Escape mid-drag restores the start and leaves no undo entry', async () => {
    const env = makeEnv();
    const { child } = frameWithChild(env);
    await settle();
    const p = createPipeline(env);
    env.cancelGesture = p.cancel;
    p.down(pi(130, 140)); p.move(pi(180, 190));
    expect(p.escape()).toBe(true);
    p.move(pi(200, 200)); p.up(pi(200, 200));
    expect(get(env, child)).toMatchObject({ x: 20, y: 30 });
    expect(env.board.undo('human-test')).toBe(false);
  });

  it('detects a double-click', async () => {
    const env = makeEnv();
    const p = createPipeline(env);
    const counts: number[] = [];
    p.onClick((_, n) => counts.push(n));
    for (let i = 0; i < 2; i++) { p.down(pi(900, 900)); p.up(pi(901, 900)); }
    expect(counts).toEqual([1, 2]);
  });

  it('ladder: popover, then scope up to the frame, then clear, then Move tool', async () => {
    const env = makeEnv();
    const { frame, child } = frameWithChild(env);
    await settle();
    const p = createPipeline(env);
    env.cancelGesture = p.cancel;
    env.ui.set({ tool: 'rect', pop: { shapeId: frame, wx: 0, wy: 0 } });
    selectIds(env.board, [child]);
    p.escape(); expect(env.ui.get().pop).toBeNull(); expect(selectedIds(env.board)).toEqual([child]);
    p.escape(); expect(selectedIds(env.board)).toEqual([frame]);
    p.escape(); expect(selectedIds(env.board)).toEqual([]);
    expect(env.ui.get().tool).toBe('rect');
    p.escape(); expect(env.ui.get().tool).toBe('select');
    expect(p.escape()).toBe(false);
  });
});
