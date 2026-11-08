// WP-74: rotate gesture, angle snapping and angle-aware cursors.
import { describe, expect, it } from 'vitest';
import { createBoard } from '../../core/commands';
import { createCameraStore } from '../../core/camera';
import { opId } from '../../core/ids';
import { createFakeFrameSource, createScheduler } from '../../core/raf';
import { createUiStore, selectIds } from '../board/state';
import type { BoardEnv } from '../board/state';
import type { PointerInfo } from './pipeline';
import { isRotateHandle, pointerAngle, resizeCursor, rotateCursor, snapAngle, startRotate } from './rotate';

function makeEnv(): BoardEnv {
  const board = createBoard({ me: 'human-test' });
  const camera = createCameraStore(createScheduler(createFakeFrameSource()), { x: 0, y: 0, z: 1 });
  return { board, camera, ui: createUiStore(), paint: { add: () => () => {}, wake: () => {} },
    pointer: { x: 0, y: 0, inside: true }, pendingText: null, cancelGesture: () => false };
}
const pi = (x: number, y: number, extra: Partial<PointerInfo> = {}): PointerInfo =>
  ({ clientX: x, clientY: y, world: { x, y }, button: 0, shift: false, alt: false, mod: false, handle: 'rot-se', ...extra });
const mk = (env: BoardEnv, ...boxes: number[][]) => env.board.exec({ actor: 'agent-a', opId: opId('agent-a'),
  commands: boxes.map(([x, y, w, h]) => ({ t: 'shape.create', kind: 'rect', props: { x, y, w, h } }) as const) })
  .results.map((r) => (r.ok ? r.id! : ''));
const get = (env: BoardEnv, id: string) => env.board.doc.getState().shapes.get(id)!;

describe('angles', () => {
  it('pointer angle is clockwise from east', () => {
    expect(pointerAngle({ x: 0, y: 0 }, { x: 1, y: 0 })).toBe(0);
    expect(pointerAngle({ x: 0, y: 0 }, { x: 0, y: 1 })).toBe(90);
  });
  it('shift snaps to 15, magnet snaps to 90s within 3', () => {
    expect(snapAngle(22, true)).toBe(15);
    expect(snapAngle(23, true)).toBe(30);
    expect(snapAngle(88, false)).toBe(90);
    expect(snapAngle(86, false)).toBe(86);
    expect(snapAngle(181, false)).toBe(180);
    expect(snapAngle(190, true)).toBe(-165);
  });
  it('recognises rotate handles', () => {
    expect(isRotateHandle('rot-nw')).toBe(true);
    expect(isRotateHandle('nw')).toBe(false);
  });
});

describe('cursors', () => {
  it('resize cursor turns with the shape', () => {
    expect(resizeCursor('nw', 0)).toBe('nwse-resize');
    expect(resizeCursor('nw', 45)).toBe('ns-resize');
    expect(resizeCursor('n', 90)).toBe('ew-resize');
    expect(resizeCursor('e', 45)).toBe('nwse-resize');
  });
  it('rotate cursor has a keyword fallback', () => expect(rotateCursor('ne', 30)).toMatch(/^url\(.*\) 12 12, grab$/));
});

describe('startRotate', () => {
  it('rotates one shape about its centre, shift snaps, one undo entry', () => {
    const env = makeEnv();
    const [a] = mk(env, [0, 0, 100, 100]);
    selectIds(env.board, [a]);
    const m = startRotate(env, pi(150, 50))!;           // east of centre (50,50)
    m.move(pi(50, 150, { shift: true }));               // south: +90
    m.up(pi(50, 150, { shift: true }));
    expect(get(env, a).rotation).toBeCloseTo(90);
    expect(get(env, a).x).toBeCloseTo(0);
    expect(env.board.undo(env.board.me)).toBe(true);
    expect(get(env, a).rotation ?? 0).toBe(0);
  });
  it('shift lands on multiples of 15', () => {
    const env = makeEnv();
    const [a] = mk(env, [0, 0, 100, 100]);
    selectIds(env.board, [a]);
    const m = startRotate(env, pi(150, 50))!;
    const t = (30 * Math.PI) / 180;
    const q = pi(50 + 100 * Math.cos(t) + 3, 50 + 100 * Math.sin(t), { shift: true });
    m.move(q);
    m.up(q);
    expect(get(env, a).rotation).toBe(30);
  });
  it('rotates a group about the union centre and cancel restores', () => {
    const env = makeEnv();
    const [a, b] = mk(env, [0, 0, 20, 20], [180, 0, 20, 20]);   // union centre (100,10)
    selectIds(env.board, [a, b]);
    const m = startRotate(env, pi(200, 10))!;
    m.move(pi(100, 110, { shift: true }));                       // +90
    expect(get(env, a).rotation).toBeCloseTo(90);
    expect(get(env, a).x + 10).toBeCloseTo(100);                 // centre (10,10) -> (100,-80)
    expect(get(env, a).y + 10).toBeCloseTo(-80);
    m.cancel();
    expect(get(env, a).x).toBe(0);
    expect(get(env, a).rotation ?? 0).toBe(0);
  });
  it('ignores non-rotate handles', () => {
    const env = makeEnv();
    const [a] = mk(env, [0, 0, 10, 10]);
    selectIds(env.board, [a]);
    expect(startRotate(env, pi(0, 0, { handle: 'se' }))).toBeNull();
  });
});
