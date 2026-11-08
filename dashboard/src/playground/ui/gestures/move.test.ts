// WP-18: reparent by drag and axis lock for the move gesture.
import { describe, expect, it } from 'vitest';
import { createBoard } from '../../core/commands';
import { createCameraStore } from '../../core/camera';
import { opId } from '../../core/ids';
import { createFakeFrameSource, createScheduler } from '../../core/raf';
import { createUiStore } from '../board/state';
import type { BoardEnv } from '../board/state';
import { lockAxis, startMove } from './move';
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
const get = (env: BoardEnv, id: string) => env.board.doc.getState().shapes.get(id)!;
function frameWithChild(env: BoardEnv) {
  const r = env.board.exec({ actor: 'agent-a', opId: opId('agent-a'), commands: [
    { t: 'shape.create', kind: 'frame', props: { x: 100, y: 100, w: 300, h: 200 } },
    { t: 'shape.create', kind: 'rect', parent: '$0', props: { x: 20, y: 30, w: 50, h: 40 } },
  ] });
  return { frame: r.results[0].ok ? r.results[0].id! : '', child: r.results[1].ok ? r.results[1].id! : '' };
}
function looseRect(env: BoardEnv): string {
  const r = env.board.exec({ actor: 'agent-a', opId: opId('agent-a'), commands: [{ t: 'shape.create', kind: 'rect', props: { x: 0, y: 0, w: 20, h: 20 } }] });
  return r.results[0].ok ? r.results[0].id! : '';
}

describe('move reparent and axis lock', () => {
  it('lockAxis keeps the dominant axis, x on a tie', () => {
    expect(lockAxis(5, -3)).toEqual({ x: 5, y: 0 });
    expect(lockAxis(2, -9)).toEqual({ x: 0, y: -9 });
    expect(lockAxis(4, 4)).toEqual({ x: 4, y: 0 });
  });

  it('dragging a child out of its frame reparents it to root, world position kept; undo restores', () => {
    const env = makeEnv();
    const { frame, child } = frameWithChild(env);
    env.board.selection.set('human-test', [child]);
    const m = startMove(env, pi(130, 140))!;
    m.move(pi(530, 140));
    m.up(pi(530, 140));
    expect(get(env, child)).toMatchObject({ parent: null, x: 520, y: 130 });
    expect(get(env, frame).x).toBe(100);
    env.board.undo('human-test');
    expect(get(env, child)).toMatchObject({ parent: frame, x: 20, y: 30 });
  });

  it('dropping a root rect on a frame makes it a child; Mod prevents reparenting', () => {
    const env = makeEnv();
    const { frame } = frameWithChild(env);
    const rect = looseRect(env);
    env.board.selection.set('human-test', [rect]);
    const m = startMove(env, pi(10, 10))!;
    m.move(pi(210, 210));
    m.up(pi(210, 210));
    expect(get(env, rect)).toMatchObject({ parent: frame, x: 100, y: 100 });
    const m2 = startMove(env, pi(210, 210))!;
    m2.move(pi(700, 700, { mod: true }));
    m2.up(pi(700, 700, { mod: true }));
    expect(get(env, rect).parent).toBe(frame);
  });

  it('a frame is never dropped into itself', () => {
    const env = makeEnv();
    const { frame } = frameWithChild(env);
    env.board.selection.set('human-test', [frame]);
    const m = startMove(env, pi(150, 150))!;
    m.move(pi(160, 160));
    m.up(pi(160, 160));
    expect(get(env, frame)).toMatchObject({ parent: null, x: 110, y: 110 });
  });

  it('Shift locks to the dominant axis and can be released mid-drag', () => {
    const env = makeEnv();
    const rect = looseRect(env);
    env.board.selection.set('human-test', [rect]);
    const m = startMove(env, pi(10, 10))!;
    m.move(pi(80, 30, { shift: true }));
    expect(get(env, rect)).toMatchObject({ x: 70, y: 0 });
    m.move(pi(80, 30));
    expect(get(env, rect)).toMatchObject({ x: 70, y: 20 });
    m.up(pi(80, 30, { shift: true }));
    expect(get(env, rect)).toMatchObject({ x: 70, y: 0 });
  });

  it('a human drag takes over an agent soft lock', () => {
    const env = makeEnv();
    const rect = looseRect(env);
    env.board.locks.acquire(rect, 'agent-a');
    env.board.selection.set('human-test', [rect]);
    startMove(env, pi(10, 10))!.cancel();
    expect(env.board.locks.list()).toEqual([]);
  });
});
