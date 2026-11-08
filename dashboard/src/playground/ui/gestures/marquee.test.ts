import { describe, expect, it } from 'vitest';
import { createBoard } from '../../core/commands';
import { createCameraStore } from '../../core/camera';
import { opId } from '../../core/ids';
import { createFakeFrameSource, createScheduler } from '../../core/raf';
import { createUiStore, selectedIds } from '../board/state';
import type { BoardEnv } from '../board/state';
import { marqueeOf, startMarquee } from './marquee';
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
const settle = () => new Promise<void>((r) => queueMicrotask(r));

async function scene(env: BoardEnv) {
  const r = env.board.exec({ actor: 'agent-a', opId: opId('agent-a'), commands: [
    { t: 'shape.create', kind: 'rect', props: { x: 0, y: 0, w: 50, h: 50 } },
    { t: 'shape.create', kind: 'rect', props: { x: 100, y: 0, w: 50, h: 50 } },
    { t: 'shape.create', kind: 'rect', props: { x: 400, y: 400, w: 50, h: 50 } },
    { t: 'shape.create', kind: 'frame', props: { x: 0, y: 200, w: 300, h: 150 } },
    { t: 'shape.create', kind: 'rect', parent: '$3', props: { x: 20, y: 20, w: 40, h: 40 } },
  ] });
  await settle();
  return r.results.map((x) => (x.ok ? x.id! : ''));
}

describe('marquee', () => {
  it('selects the top-level layers it touches, live, and publishes the rect', async () => {
    const env = makeEnv();
    const [a, b, c] = await scene(env);
    const m = startMarquee(env, pi(-10, -10))!;
    m.move(pi(30, 30));
    expect(selectedIds(env.board)).toEqual([a]);
    expect(marqueeOf(env).get()).toEqual({ x: -10, y: -10, w: 40, h: 40 });
    m.move(pi(120, 30));
    expect([...selectedIds(env.board)].sort()).toEqual([a, b].sort());
    m.up(pi(120, 30));
    expect(marqueeOf(env).get()).toBeNull();
    expect(selectedIds(env.board)).not.toContain(c);
  });

  it('does not pick a frame whose interior it merely overlaps, nor its children from outside', async () => {
    const env = makeEnv();
    await scene(env);
    // starts at root (outside the frame), ends inside its interior: crosses the frame edge
    const m = startMarquee(env, pi(-20, 190))!;
    m.move(pi(10, 230));
    expect(selectedIds(env.board).length).toBe(1);   // crossed the edge: the frame, never the nested child
    const env2 = makeEnv();
    const ids = await scene(env2);
    // wholly inside the frame, starting in it: scope = frame, picks its child only
    const m2 = startMarquee(env2, pi(10, 210))!;
    m2.move(pi(80, 270));
    expect(selectedIds(env2.board)).toEqual([ids[4]]);
  });

  it('selects a frame it fully encloses', async () => {
    const env = makeEnv();
    const ids = await scene(env);
    const m = startMarquee(env, pi(-10, 190))!;
    m.move(pi(320, 360));
    expect(selectedIds(env.board)).toContain(ids[3]);
  });

  it('Shift adds to the selection held at the start; Escape restores it', async () => {
    const env = makeEnv();
    const [a, b, c] = await scene(env);
    env.board.exec({ actor: env.board.me, opId: opId(env.board.me), commands: [{ t: 'selection.set', ids: [c] }] });
    const m = startMarquee(env, pi(-10, -10, { shift: true }))!;
    m.move(pi(30, 30, { shift: true }));
    expect([...selectedIds(env.board)].sort()).toEqual([a, c].sort());
    m.cancel();
    expect(selectedIds(env.board)).toEqual([c]);
    expect(marqueeOf(env).get()).toBeNull();
    expect(b).toBeTruthy();
  });
});
