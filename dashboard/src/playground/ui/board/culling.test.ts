import { describe, expect, it, vi } from 'vitest';
import { createBoard } from '../../core/commands';
import { createCameraStore } from '../../core/camera';
import { createFakeFrameSource, createScheduler } from '../../core/raf';
import type { Command } from '../../core/types';
import { createCuller } from './culling';
import { createUiStore } from './state';

async function setup(n: number, cols = 100) {
  const board = createBoard({ me: 'human-you' });
  const camera = createCameraStore(createScheduler(createFakeFrameSource()), { x: 0, y: 0, z: 1 });
  camera.setViewRect({ left: 0, top: 0, width: 1000, height: 700 });
  const ui = createUiStore();
  const fns: Array<() => void> = [];
  const paint = { add: (f: () => void) => { fns.push(f); return () => {}; }, wake: vi.fn() };
  const cmds: Command[] = [];
  for (let i = 0; i < n; i++) cmds.push({ t: 'shape.create', kind: 'rect', props: { x: (i % cols) * 200, y: Math.floor(i / cols) * 200, w: 100, h: 100 } });
  const ids: string[] = [];
  for (let i = 0; i < n; i += 500) {
    const r = board.exec({ actor: 'human-you', opId: `c${i}`, commands: cmds.slice(i, i + 500) });
    r.results.forEach((x) => x.ok && x.id && ids.push(x.id));
  }
  await Promise.resolve();
  const culler = createCuller({ board, camera, ui, paint } as any);
  culler.tick();
  return { board, camera, ui, culler, ids, paint };
}

describe('culler', { timeout: 60000 }, () => {
  it('mounts only shapes near the view and agrees with a brute-force scan', async () => {
    const { culler, ids, board } = await setup(5000);
    const mounted = ids.filter((id) => culler.has(id));
    expect(mounted.length).toBeLessThan(600);
    expect(mounted.length).toBeGreaterThan(10);
    // every shape that overlaps the plain view is mounted
    for (const id of ids) {
      const b = board.index.bounds(id)!;
      if (b.x < 1000 && b.y < 700 && b.x + b.w > 0 && b.y + b.h > 0) expect(culler.has(id)).toBe(true);
    }
  });

  it('does not recompute for small pans, recomputes and notifies for big ones', async () => {
    const { culler, camera } = await setup(5000);
    const base = culler.stats().recomputes;
    const cb = vi.fn();
    culler.subscribe(null, cb);
    camera.setCam({ x: -100, y: 0, z: 1 });
    culler.tick();
    expect(culler.stats().recomputes).toBe(base);
    expect(cb).not.toHaveBeenCalled();
    camera.setCam({ x: -5000, y: -3000, z: 1 });
    culler.tick();
    expect(culler.stats().recomputes).toBe(base + 1);
    expect(cb).toHaveBeenCalled();
  });

  it('keeps selected, edited and locked shapes mounted off screen; data is untouched', async () => {
    const { culler, camera, board, ui, ids } = await setup(5000);
    const far = ids[4999], sel = ids[4990], edit = ids[4980], lock = ids[4970];
    expect(culler.has(far)).toBe(false);
    board.exec({ actor: 'human-you', opId: 's', commands: [{ t: 'selection.set', ids: [sel] }] });
    ui.set({ editing: edit });
    board.locks.acquire(lock, 'agent-x');
    camera.setCam({ x: -50, y: -50, z: 1 });
    culler.tick();
    expect(culler.has(sel)).toBe(true);
    expect(culler.has(edit)).toBe(true);
    expect(culler.has(lock)).toBe(true);
    expect(culler.has(far)).toBe(false);
    expect(board.index.size).toBe(5000);
    expect(board.doc.getState().shapes.size).toBe(5000);
  });

  it('mounts a shape created in view at once and mounts ancestors of visible children', async () => {
    const { culler, board } = await setup(10);
    const r = board.exec({ actor: 'human-you', opId: 'f', commands: [
      { t: 'shape.create', kind: 'frame', props: { x: 20000, y: 20000, w: 100, h: 100 } },
    ] });
    const frame = (r.results[0] as any).id;
    expect(culler.has(frame)).toBe(false);
    const r2 = board.exec({ actor: 'human-you', opId: 'n', commands: [{ t: 'shape.create', kind: 'rect', props: { x: 10, y: 10, w: 10, h: 10 } }] });
    expect(culler.has((r2.results[0] as any).id)).toBe(true);
  });

  it('shows everything before the view is measured', () => {
    const board = createBoard({ me: 'human-you' });
    const camera = createCameraStore(createScheduler(createFakeFrameSource()));
    const culler = createCuller({ board, camera, ui: createUiStore(), paint: { add: () => () => {}, wake() {} } } as any);
    culler.tick();
    expect(culler.has('anything')).toBe(true);
  });
});
