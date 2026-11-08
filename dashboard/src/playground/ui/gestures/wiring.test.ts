// WP-60 / WP-74 wiring: text resize sets the mode, text commit and handle double-click are one undo entry,
// the pipeline starts a rotate from a rot- handle.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBoard } from '../../core/commands';
import { createCameraStore } from '../../core/camera';
import { opId } from '../../core/ids';
import { createFakeFrameSource, createScheduler } from '../../core/raf';
import { setMeasureEnv } from '../../render/measure';
import { createUiStore } from '../board/state';
import type { BoardEnv } from '../board/state';
import { createPipeline } from './pipeline';
import type { PointerInfo } from './pipeline';
import { startResize } from './resize';
import { commitText, resetTextHandle } from './text';

beforeEach(() => setMeasureEnv({
  lineWidth: (l) => l.length * 10,
  wrap: (t, _s, w) => { const per = Math.max(1, Math.floor(w / 10)); const out: string[] = []; for (let i = 0; i < t.length; i += per) out.push(t.slice(i, i + per)); return out.length ? out : ['']; },
}));
afterEach(() => setMeasureEnv(null));

function makeEnv(): BoardEnv {
  const board = createBoard({ me: 'human-test' });
  const camera = createCameraStore(createScheduler(createFakeFrameSource()), { x: 0, y: 0, z: 1 });
  return { board, camera, ui: createUiStore(), paint: { add: () => () => {}, wake: () => {} }, pointer: { x: 0, y: 0, inside: true }, pendingText: null, cancelGesture: () => false };
}
const pi = (x: number, y: number, extra: Partial<PointerInfo> = {}): PointerInfo =>
  ({ clientX: x, clientY: y, world: { x, y }, button: 0, shift: false, alt: false, mod: false, ...extra });
function text(env: BoardEnv, props: object) {
  const r = env.board.exec({ actor: env.board.me, opId: opId(env.board.me), commands: [{ t: 'shape.create', kind: 'text', props: { text: 'ab', w: 100, h: 20, fontSize: 10, ...props } }] });
  const id = r.results[0].ok ? r.results[0].id! : '';
  env.board.selection.set(env.board.me, [id]);
  return id;
}
const get = (env: BoardEnv, id: string) => env.board.doc.getState().shapes.get(id)!;

describe('text resize mode', () => {
  it('a side handle gives auto-h, a corner gives fixed, in the same undo entry', () => {
    const env = makeEnv();
    const id = text(env, { textMode: 'auto-w' });
    startResize(env, pi(100, 10, { handle: 'e' }))!.up(pi(150, 10));
    expect(get(env, id)).toMatchObject({ textMode: 'auto-h', w: 150 });
    startResize(env, pi(150, 20, { handle: 'se' }))!.up(pi(170, 40));
    expect(get(env, id).textMode).toBe('fixed');
    env.board.undo('human-test');
    expect(get(env, id).textMode).toBe('auto-h');
  });
});

describe('text commit', () => {
  it('folds the fitted size into one undo entry', () => {
    const env = makeEnv();
    const id = text(env, { textMode: 'auto-w', text: 'a', w: 10 });
    commitText(env, id, 'abcdef');
    expect(get(env, id)).toMatchObject({ text: 'abcdef', w: 60 });
    env.board.undo('human-test');
    expect(get(env, id)).toMatchObject({ text: 'a', w: 10 });
  });
  it('handle double-click resets to auto width, fitted', () => {
    const env = makeEnv();
    const id = text(env, { textMode: 'fixed', text: 'abc', w: 200 });
    resetTextHandle(env);
    expect(get(env, id)).toMatchObject({ textMode: 'auto-w', w: 30 });
  });
});

describe('pipeline rotate', () => {
  it('a rot- handle rotates instead of resizing', () => {
    const env = makeEnv();
    const id = text(env, { textMode: 'fixed', x: 0, y: 0, w: 100, h: 100 });
    const pl = createPipeline(env);
    pl.down(pi(110, 50, { handle: 'rot-ne' }));
    pl.move(pi(50, 110, { handle: 'rot-ne' }));
    pl.up(pi(50, 110));
    expect(get(env, id).rotation).toBeCloseTo(90, 0);
    expect(get(env, id).textMode).toBe('fixed');
  });
});
