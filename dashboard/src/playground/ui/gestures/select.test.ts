import { describe, expect, it } from 'vitest';
import { createBoard } from '../../core/commands';
import { createCameraStore } from '../../core/camera';
import { opId } from '../../core/ids';
import { createFakeFrameSource, createScheduler } from '../../core/raf';
import { createUiStore, selectedIds } from '../board/state';
import type { BoardEnv } from '../board/state';
import type { PointerInfo } from './pipeline';
import { enterAt, selectAt } from './select';

function makeEnv(): BoardEnv {
  const board = createBoard({ me: 'human-test' });
  const camera = createCameraStore(createScheduler(createFakeFrameSource()), { x: 0, y: 0, z: 1 });
  return { board, camera, ui: createUiStore(), paint: { add: () => () => {}, wake: () => {} },
    pointer: { x: 0, y: 0, inside: true }, pendingText: null, cancelGesture: () => false };
}
const pi = (x: number, y: number, extra: Partial<PointerInfo> = {}): PointerInfo =>
  ({ clientX: x, clientY: y, world: { x, y }, button: 0, shift: false, alt: false, mod: false, ...extra });
const settle = () => new Promise<void>((r) => queueMicrotask(r));
const ok = (r: { ok: boolean; id?: string }) => (r.ok ? r.id! : '');

// frame(0,0,400x300) > group(10,10) > rect a (0,0,50x50), rect b (60,0,50x50); sibling ellipse e (200,100,100x100)
async function scene() {
  const env = makeEnv();
  const r = env.board.exec({ actor: 'agent-a', opId: opId('agent-a'), commands: [
    { t: 'shape.create', kind: 'frame', props: { x: 0, y: 0, w: 400, h: 300 } },
    { t: 'shape.create', kind: 'rect', parent: '$0', props: { x: 10, y: 10, w: 50, h: 50 } },
    { t: 'shape.create', kind: 'rect', parent: '$0', props: { x: 70, y: 10, w: 50, h: 50 } },
    { t: 'shape.create', kind: 'ellipse', parent: '$0', props: { x: 200, y: 100, w: 100, h: 100 } },
    { t: 'shape.create', kind: 'rect', props: { x: 500, y: 0, w: 50, h: 50 } },
  ] });
  const [frame, a, b, e, free] = r.results.map(ok);
  const g = env.board.exec({ actor: 'agent-a', opId: opId('agent-a'), commands: [{ t: 'shape.group', ids: [a, b] }] });
  const group = ok(g.results[0]);
  await settle();
  return { env, frame, a, b, e, free, group };
}

describe('click select', () => {
  it('plain click climbs groups; mod-click picks the leaf; ellipse corner falls through', async () => {
    const { env, frame, a, group, e } = await scene();
    selectAt(env, pi(20, 20));
    expect(selectedIds(env.board)).toEqual([group]);
    selectAt(env, pi(20, 20, { mod: true }));
    expect(selectedIds(env.board)).toEqual([a]);
    selectAt(env, pi(202, 102)); // inside the ellipse box, outside its curve: the frame is underneath
    expect(selectedIds(env.board)).toEqual([frame]);
    selectAt(env, pi(250, 150));
    expect(selectedIds(env.board)).toEqual([e]);
  });

  it('shift toggles and keeps selection on empty canvas', async () => {
    const { env, free, e } = await scene();
    selectAt(env, pi(250, 150));
    selectAt(env, pi(520, 20, { shift: true }));
    expect(selectedIds(env.board)).toEqual([e, free]);
    selectAt(env, pi(250, 150, { shift: true }));
    expect(selectedIds(env.board)).toEqual([free]);
    selectAt(env, pi(900, 900, { shift: true }));
    expect(selectedIds(env.board)).toEqual([free]);
  });

  it('double-click enters a group, then clicks pick its children; outside climbs the scope', async () => {
    const { env, a, b, group, e, frame } = await scene();
    selectAt(env, pi(20, 20));
    expect(enterAt(env, pi(20, 20))).toBe(true);
    expect(selectedIds(env.board)).toEqual([a]);
    expect(env.board.selection.get('human-test').scope).toBe(group);
    selectAt(env, pi(90, 20));
    expect(selectedIds(env.board)).toEqual([b]);
    selectAt(env, pi(250, 150)); // leaves the group
    expect(selectedIds(env.board)).toEqual([e]);
    expect(env.board.selection.get('human-test').scope).toBe(frame);
  });

  it('double-click text starts editing; rect enters nothing', async () => {
    const { env, free } = await scene();
    selectAt(env, pi(520, 20));
    expect(enterAt(env, pi(520, 20))).toBe(false);
    const t = ok(env.board.exec({ actor: 'agent-a', opId: opId('agent-a'), commands: [
      { t: 'shape.create', kind: 'text', props: { x: 600, y: 0, w: 100, h: 24, text: 'hi' } }] }).results[0]);
    await settle();
    expect(enterAt(env, pi(620, 10))).toBe(true);
    expect(env.ui.get().editing).toBe(t);
    expect(free).toBeTruthy();
  });
});
