// Text tool: click = auto-width, drag = fixed-width box, human edits pin agent text.
import { describe, expect, it } from 'vitest';
import { createBoard } from '../../core/commands';
import { createCameraStore } from '../../core/camera';
import { opId } from '../../core/ids';
import { createFakeFrameSource, createScheduler } from '../../core/raf';
import { createUiStore } from '../board/state';
import type { BoardEnv } from '../board/state';
import type { PointerInfo } from './pipeline';
import { commitText, startTextTool } from './text';

function makeEnv(): BoardEnv {
  const board = createBoard({ me: 'human-test' });
  const camera = createCameraStore(createScheduler(createFakeFrameSource()), { x: 0, y: 0, z: 1 });
  return { board, camera, ui: createUiStore(), paint: { add: () => () => {}, wake: () => {} }, pointer: { x: 0, y: 0, inside: true }, pendingText: null, cancelGesture: () => false };
}
const pi = (x: number, y: number): PointerInfo => ({ clientX: x, clientY: y, world: { x, y }, button: 0, shift: false, alt: false, mod: false });
const get = (env: BoardEnv, id: string) => env.board.doc.getState().shapes.get(id)!;

describe('text tool', () => {
  it('click places auto-width text', () => {
    const env = makeEnv();
    startTextTool(env, pi(10, 20)).up(pi(10, 20));
    const id = env.ui.get().editing!;
    commitText(env, id, 'Hi');
    expect(get(env, id)).toMatchObject({ textMode: 'auto-w', text: 'Hi' });
  });
  it('drag makes a fixed-width box, any direction', () => {
    const env = makeEnv();
    startTextTool(env, pi(200, 50)).up(pi(100, 90));
    const id = env.ui.get().editing!;
    commitText(env, id, 'Long');
    expect(get(env, id)).toMatchObject({ textMode: 'auto-h', x: 100, y: 50, w: 100 });
  });
  it('human edit of agent text sets humanEdited; of own text does not', () => {
    const env = makeEnv();
    const r = env.board.exec({ actor: 'agent-a', opId: opId('agent-a'), commands: [{ t: 'shape.create', kind: 'text', props: { text: 'Helo', w: 50, h: 20 } }] });
    const id = r.results[0].ok ? r.results[0].id! : '';
    commitText(env, id, 'Hello');
    expect(get(env, id)).toMatchObject({ text: 'Hello', humanEdited: true });
    startTextTool(env, pi(0, 0)).up(pi(0, 0));
    const mine = env.ui.get().editing!;
    commitText(env, mine, 'a');
    commitText(env, mine, 'b');
    expect(get(env, mine).humanEdited).toBeUndefined();
  });
});
