import { describe, expect, it, vi } from 'vitest';
import { createBoard } from './commands';
import { createToasts } from './toast';
import { createDispatcher } from './keys';
import { createRuntime } from '../agents/runtime';
import { fakeClock } from '../agents/fakes.test';
import { alignSelection } from '../actions/align';
import { setOpacity } from '../actions/layers';
import '../actions/index';
import { listActions } from './actions';

const mk = (id: string, x: number) => ({ t: 'shape.create' as const, kind: 'rect' as const, id, props: { name: id, x, y: 0, w: 10, h: 10 } });

describe('status.changed', () => {
  it('status.set emits status.changed with who and state', () => {
    const board = createBoard({ me: 'human-1' });
    board.actors.spawn({ id: 'agent-1', kind: 'agent', name: 'A' });
    const got: unknown[] = [];
    board.subscribe({ kinds: ['status.changed'] }, (e) => got.push(e));
    board.exec({ actor: 'agent-1', opId: 's1', commands: [{ t: 'status.set', state: 'thinking', detail: 'x' }] });
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ t: 'status.changed', who: 'agent-1', actor: 'agent-1', state: 'thinking' });
  });
});

describe('Tx.sel and undo selection', () => {
  it('records before/after and undo / redo restore the selection', () => {
    const board = createBoard({ me: 'human-1' });
    board.exec({ actor: 'human-1', opId: 'a', commands: [mk('a', 0), mk('b', 50)] });
    board.selection.set('human-1', ['a']);
    // delete b while b is selected: the selection moves to b first
    board.selection.set('human-1', ['b']);
    const r = board.exec({ actor: 'human-1', opId: 'd', commands: [{ t: 'shape.delete', ids: ['b'] }, { t: 'selection.set', ids: [] }] });
    expect(board.selection.get('human-1').ids).toEqual([]);
    const tx = board.undoManager; void tx;
    expect(r.ok).toBe(true);
    board.undo('human-1');
    expect(board.selection.get('human-1').ids).toEqual(['b']);
    board.redo('human-1');
    expect(board.selection.get('human-1').ids).toEqual([]);
  });
  it('a gesture restores the selection it started from', () => {
    const board = createBoard({ me: 'human-1' });
    board.exec({ actor: 'human-1', opId: 'a', commands: [mk('a', 0)] });
    board.selection.set('human-1', ['a']);
    const g = board.gesture('human-1', 'Move');
    g.update([{ t: 'shape.translate', ids: ['a'], dx: 5, dy: 0 }]);
    g.commit();
    board.selection.set('human-1', []);
    board.undo('human-1');
    expect(board.selection.get('human-1').ids).toEqual(['a']);
  });
});

describe('align shortcut and opacity', () => {
  it('Alt+A aligns in one undo entry', () => {
    const board = createBoard({ me: 'human-1' });
    board.exec({ actor: 'human-1', opId: 'a', commands: [mk('a', 0), mk('b', 50), mk('c', 90)] });
    board.selection.set('human-1', ['a', 'b', 'c']);
    expect(alignSelection(board, 'left')).toBe(true);
    const xs = () => ['a', 'b', 'c'].map((id) => board.doc.getState().shapes.get(id)!.x);
    expect(xs()).toEqual([0, 0, 0]);
    board.undo('human-1');
    expect(xs()).toEqual([0, 50, 90]);
  });
  it('opacity helper is one undo entry; keys 1-9 and 0 exist and skip text fields', () => {
    const board = createBoard({ me: 'human-1' });
    board.exec({ actor: 'human-1', opId: 'a', commands: [mk('a', 0), mk('b', 50)] });
    expect(setOpacity(board, ['a', 'b'], 0.3)).toBe(true);
    expect(board.doc.getState().shapes.get('b')!.opacity).toBe(0.3);
    board.undo('human-1');
    expect(board.doc.getState().shapes.get('b')!.opacity ?? 1).toBe(1);

    const ran = vi.fn();
    const acts = listActions().filter((a) => a.id.startsWith('layers.opacity')).map((a) => ({ ...a, run: ran }));
    expect(acts).toHaveLength(10);
    const key = (ctx: 'text-edit' | 'canvas') => createDispatcher({ getContext: () => ctx, getActions: () => acts, platform: 'mac' })
      .handle({ key: '5', code: 'Digit5', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, preventDefault() {} });
    expect(key('text-edit')).toBeNull();
    expect(ran).not.toHaveBeenCalled();
    expect(key('canvas')?.id).toBe('layers.opacity5');
    expect(ran).toHaveBeenCalledTimes(1);
  });
});

describe('toast pause / resume / sticky', () => {
  it('pause stops the countdown, resume restarts it; sticky never expires', () => {
    vi.useFakeTimers();
    let t = 0;
    const ts = createToasts(() => t);
    const id = ts.show('hi', { ttlMs: 1000 })!;
    const sticky = ts.show('keep', { sticky: true })!;
    t = 400; vi.advanceTimersByTime(400);
    ts.pause(id);
    t = 5000; vi.advanceTimersByTime(4600);
    expect(ts.getToasts().map((x) => x.id)).toContain(id);
    ts.resume(id);
    t = 5500; vi.advanceTimersByTime(500);
    expect(ts.getToasts().map((x) => x.id)).toContain(id);       // at least 1 s after resume
    t = 6100; vi.advanceTimersByTime(600);
    expect(ts.getToasts().map((x) => x.id)).toEqual([sticky]);
    t = 99999; vi.advanceTimersByTime(99999);
    expect(ts.getToasts().map((x) => x.id)).toEqual([sticky]);
    vi.useRealTimers();
  });
});

describe('restored board: occupied slots', () => {
  it('occupy() keeps resumed agents out of cells that hold saved frames', async () => {
    const board = createBoard({ me: 'human-1' });
    // a saved frame filling cell 0 and half of cell 1
    board.exec({ actor: 'human-1', opId: 'f', commands: [{ t: 'shape.create', kind: 'frame', id: 'f', props: { name: 'f', x: 20, y: 40, w: 700, h: 300 } }] });
    const rt = createRuntime({ board, clock: fakeClock(), seed: 1, frameMs: 20, animate: false });
    rt.occupy(board.doc.getState());
    const id = rt.spawn();
    void id;
    const roots = () => [...board.doc.getState().shapes.values()].filter((s) => s.id !== 'f' && s.parent === null && !s.deleted);
    for (let i = 0; i < 400 && !roots().length; i++) await new Promise((r) => setTimeout(r, 25));
    rt.reset();
    const st = board.doc.getState();
    const built = [...st.shapes.values()].filter((s) => s.id !== 'f' && s.parent === null && !s.deleted);
    expect(built.length).toBeGreaterThan(0);
    const saved = { x: 20, y: 40, w: 700, h: 300 };
    for (const [sid, s] of st.shapes) {
      if (sid === 'f' || s.deleted || s.parent !== null) continue;
      const overlap = s.x < saved.x + saved.w && s.x + s.w > saved.x && s.y < saved.y + saved.h && s.y + s.h > saved.y;
      expect(overlap).toBe(false);
    }
  }, 20000);
});
