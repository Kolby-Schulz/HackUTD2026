// Gesture modes against a real board (no DOM): every change goes through board.gesture / exec,
// one drag = one undo entry, Escape restores, frames carry their children.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setMeasureEnv } from '../../render/measure';
import { createBoard } from '../../core/commands';
import { createCameraStore } from '../../core/camera';
import { opId } from '../../core/ids';
import { createFakeFrameSource, createScheduler } from '../../core/raf';
import type { Shape } from '../../core/types';
import { createUiStore, selectedIds } from '../board/state';
import type { BoardEnv } from '../board/state';
import { startCreate } from './create';
import { startMove } from './move';
import { cornerBox, startResize } from './resize';
import { createPipeline } from './pipeline';
import type { PointerInfo } from './pipeline';
import { commitText, placeText } from './text';
import { commentClick } from './comment';

beforeEach(() => setMeasureEnv({ lineWidth: (l) => l.length * 10, wrap: (t) => [t] }));
afterEach(() => setMeasureEnv(null));

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

describe('create', () => {
  it('drag sizes a rect, selects it, returns to Move, and is one undo entry', () => {
    const env = makeEnv();
    env.ui.set({ tool: 'rect' });
    const m = startCreate(env, pi(10, 10), 'rect');
    m.move(pi(40, 30));
    m.up(pi(60, 40));
    const [s] = live(env);
    expect(s).toMatchObject({ kind: 'rect', x: 10, y: 10, w: 50, h: 30, parent: null, createdBy: 'human-test' });
    expect(selectedIds(env.board)).toEqual([s.id]);
    expect(env.ui.get().tool).toBe('select');
    expect(env.board.undo('human-test')).toBe(true);
    expect(live(env)).toHaveLength(0);
  });

  it('a click makes the default size; a frame gets 320 x 240', () => {
    const env = makeEnv();
    const m = startCreate(env, pi(5, 5), 'frame');
    m.up(pi(6, 6));
    expect(live(env)[0]).toMatchObject({ kind: 'frame', w: 320, h: 240, clip: true });
  });

  it('drawing inside a frame nests the shape with local coordinates', () => {
    const env = makeEnv();
    const { frame } = frameWithChild(env);
    const m = startCreate(env, pi(150, 150), 'ellipse');
    m.up(pi(190, 170));
    const e = live(env).find((s) => s.kind === 'ellipse')!;
    expect(e).toMatchObject({ parent: frame, x: 50, y: 50, w: 40, h: 20 });
  });

  it('Escape (cancel) leaves nothing behind', () => {
    const env = makeEnv();
    const m = startCreate(env, pi(0, 0), 'rect');
    m.move(pi(50, 50));
    m.cancel();
    expect(live(env)).toHaveLength(0);
  });
});

describe('move', () => {
  it('moving a frame moves its children (they are local) and undoes in one step', () => {
    const env = makeEnv();
    const { frame, child } = frameWithChild(env);
    env.board.selection.set('human-test', [frame]);
    const m = startMove(env, pi(150, 150))!;
    m.move(pi(160, 155));
    m.move(pi(200, 180));
    m.up(pi(210, 190));
    expect(get(env, frame)).toMatchObject({ x: 160, y: 140 });
    expect(get(env, child)).toMatchObject({ x: 20, y: 30 });
    env.board.undo('human-test');
    expect(get(env, frame)).toMatchObject({ x: 100, y: 100 });
  });

  it('cancel restores the start position; a click without motion records nothing', () => {
    const env = makeEnv();
    const { frame } = frameWithChild(env);
    env.board.selection.set('human-test', [frame]);
    const m = startMove(env, pi(150, 150))!;
    m.move(pi(300, 300));
    expect(get(env, frame).x).toBe(250);
    m.cancel();
    expect(get(env, frame).x).toBe(100);
    const click = startMove(env, pi(150, 150))!;
    click.up(pi(150, 150));
    expect(env.board.undo('human-test')).toBe(false);
  });
});

describe('resize', () => {
  it('cornerBox keeps the opposite corner fixed and normalises flips', () => {
    expect(cornerBox({ x: 0, y: 0, w: 100, h: 50 }, 'se', 120, 80)).toEqual({ x: 0, y: 0, w: 120, h: 80 });
    expect(cornerBox({ x: 0, y: 0, w: 100, h: 50 }, 'nw', 10, 20)).toEqual({ x: 10, y: 20, w: 90, h: 30 });
    expect(cornerBox({ x: 0, y: 0, w: 100, h: 50 }, 'nw', 150, 70)).toEqual({ x: 100, y: 50, w: 50, h: 20 });
  });

  it('resizes a child in its parent space', () => {
    const env = makeEnv();
    const { child } = frameWithChild(env);
    env.board.selection.set('human-test', [child]);
    const m = startResize(env, pi(170, 170, { handle: 'se' }))!;
    m.up(pi(200, 210));
    expect(get(env, child)).toMatchObject({ x: 20, y: 30, w: 80, h: 80 });
  });
});

describe('undo is per actor', () => {
  it("Cmd+Z undoes the human's last action and leaves agent work intact", () => {
    const env = makeEnv();
    const { frame } = frameWithChild(env);
    startCreate(env, pi(600, 600), 'rect').up(pi(600, 600));
    expect(live(env)).toHaveLength(3);
    env.board.undo('human-test');
    expect(live(env)).toHaveLength(2);
    expect(get(env, frame).deleted).toBeUndefined();
  });
});

describe('text', () => {
  it('place + type is one undo entry; empty text leaves nothing', () => {
    const env = makeEnv();
    placeText(env, { x: 10, y: 20 });
    const id = env.ui.get().editing!;
    expect(id).toBeTruthy();
    commitText(env, id, 'Hello');
    expect(get(env, id)).toMatchObject({ kind: 'text', text: 'Hello', name: 'Hello', x: 10, y: 10 });
    expect(env.ui.get().editing).toBeNull();
    env.board.undo('human-test');
    expect(live(env)).toHaveLength(0);

    placeText(env, { x: 0, y: 0 });
    commitText(env, env.ui.get().editing!, '   ');
    expect(live(env)).toHaveLength(0);
  });

  it('editing an existing text updates it, clearing it deletes it', () => {
    const env = makeEnv();
    placeText(env, { x: 0, y: 0 });
    const id = env.ui.get().editing!;
    commitText(env, id, 'One');
    commitText(env, id, 'Two');
    expect(get(env, id).text).toBe('Two');
    commitText(env, id, '');
    expect(get(env, id).deleted).toBe(true);
  });
});

describe('pipeline', () => {
  it('hand tool pans the camera; Escape puts it back', () => {
    const env = makeEnv();
    const p = createPipeline(env);
    env.ui.set({ tool: 'hand' });
    p.down(pi(0, 0));
    p.move(pi(30, 40));
    expect(env.camera.getCam()).toMatchObject({ x: 30, y: 40 });
    expect(p.cancel()).toBe(true);
    expect(env.camera.getCam()).toMatchObject({ x: 0, y: 0 });
  });

  it('select tool: click selects the topmost child, drag moves it, empty canvas clears', async () => {
    const env = makeEnv();
    const { child } = frameWithChild(env);
    await settle();
    const p = createPipeline(env);
    p.down(pi(130, 140));
    expect(selectedIds(env.board)).toEqual([child]);
    p.move(pi(140, 150));
    p.up(pi(140, 150));
    expect(get(env, child)).toMatchObject({ x: 30, y: 40 });
    p.down(pi(900, 900));
    p.up(pi(900, 900));
    expect(selectedIds(env.board)).toEqual([]);
  });

  it('comment tool opens the popover on the layer under the pointer', async () => {
    const env = makeEnv();
    const { frame } = frameWithChild(env);
    await settle();
    commentClick(env, pi(300, 250));
    expect(env.ui.get().pop).toEqual({ shapeId: frame, wx: 300, wy: 250 });
    commentClick(env, pi(900, 900));
    expect(env.ui.get().pop).toBeNull();
  });
});

describe('draw modifiers (WP-20)', () => {
  it('click makes a 100 x 100 rect at the pointer', () => {
    const env = makeEnv();
    startCreate(env, pi(30, 40), 'rect').up(pi(30, 40));
    expect(live(env)[0]).toMatchObject({ x: 30, y: 40, w: 100, h: 100 });
  });
  it('Shift makes a square, Alt grows from the centre', () => {
    const env = makeEnv();
    const m = startCreate(env, pi(100, 100), 'rect');
    m.up(pi(160, 130, { shift: true }));
    expect(live(env)[0]).toMatchObject({ x: 100, y: 100, w: 60, h: 60 });
    const env2 = makeEnv();
    const m2 = startCreate(env2, pi(100, 100), 'ellipse');
    m2.up(pi(120, 110, { alt: true }));
    expect(live(env2)[0]).toMatchObject({ x: 80, y: 90, w: 40, h: 20 });
  });
});
