import { beforeEach, describe, expect, it } from 'vitest';
import { createBoard } from './commands';
import type { BoardKit } from './commands';
import { createDevtools } from './devtools';
import { resetSeqs } from './ids';
import { absRect } from './tree';
import type { BoardEvent, Command, ExecResult, Result } from './types';
const rid = (r: Result): string => (r.ok ? r.id! : '');

const H = 'human-you';
const A = 'agent-k3f9';
let b: BoardKit;
let n = 0;
const run = (actor: string, commands: Command[], o: { atomic?: boolean; opId?: string } = {}): ExecResult =>
  b.exec({ actor, opId: o.opId ?? `op-${++n}`, commands, ...(o.atomic ? { atomic: true } : {}) });
const sh = (id: string) => b.doc.getState().shapes.get(id)!;
const live = () => [...b.doc.getState().shapes.values()].filter((s) => !s.deleted);
const rectCmd = (x: number, y: number, w = 10, h = 10): Command => ({ t: 'shape.create', kind: 'rect', props: { x, y, w, h } });

beforeEach(() => { resetSeqs(); n = 0; b = createBoard(); b.actors.spawn({ id: A, kind: 'agent', name: 'A' }); });

describe('exec', () => {
  it('frame + 10 children via $0 is one change and one tx', async () => {
    let changes = 0;
    b.doc.subscribe(() => changes++);
    const cmds: Command[] = [{ t: 'shape.create', kind: 'frame', props: { w: 500, h: 500 } }];
    for (let i = 0; i < 10; i++) cmds.push({ t: 'shape.create', kind: 'rect', props: { x: i * 20, y: 0 }, parent: '$0' });
    const r = run(A, cmds);
    await Promise.resolve();
    expect(r.ok).toBe(true);
    expect(changes).toBe(1);
    const frame = r.results[0];
    expect(frame.ok && b.doc.getState().children.get(frame.id!)!.length).toBe(10);
    expect(b.doc.log().filter((e) => e.tx === r.tx).length).toBe(11);
    expect(b.undo(A)).toBe(true);
    expect(live().length).toBe(0);
  });

  it('atomic batch rolls back on an invalid command; opId resend is a no-op duplicate', () => {
    const r = run(H, [rectCmd(0, 0), { t: 'shape.update', ids: ['nope'], patch: { x: 1 } }], { atomic: true });
    expect(r.ok).toBe(false);
    expect(r.results[1]).toMatchObject({ ok: false, error: 'not_found' });
    expect(live().length).toBe(0);
    const ok = run(H, [rectCmd(0, 0)], { opId: 'same' });
    const again = run(H, [rectCmd(0, 0)], { opId: 'same' });
    expect(again.duplicate).toBe(true);
    expect(again.tx).toBe(ok.tx);
    expect(live().length).toBe(1);
  });

  it('non-atomic is best effort', () => {
    const r = run(H, [rectCmd(0, 0), { t: 'shape.delete', ids: ['nope'] }, rectCmd(5, 5)]);
    expect(r.ok).toBe(false);
    expect(r.results.map((x) => x.ok)).toEqual([true, false, true]);
    expect(live().length).toBe(2);
  });

  it('rejects bad input without throwing', () => {
    const r = run(H, [{ t: 'shape.create', kind: 'rect', props: { x: NaN } }, { t: 'shape.update', ids: ['x'], patch: { parent: 'y' } as any }, { t: 'bogus' } as any]);
    expect(r.results.every((x) => !x.ok)).toBe(true);
    expect(run(H, Array(501).fill(rectCmd(0, 0))).ok).toBe(false);
  });

  it('events: one created event per batch with causedBy = opId', () => {
    const seen: BoardEvent[] = [];
    b.subscribe({}, (e) => seen.push(e));
    run(H, [rectCmd(0, 0), rectCmd(1, 1)], { opId: 'ev1' });
    expect(seen.map((e) => e.t)).toEqual(['shape.created']);
    expect(seen[0].causedBy).toBe('ev1');
  });
});

describe('structure', () => {
  it('reparent keepWorld keeps absolute position', () => {
    const r = run(H, [
      { t: 'shape.create', kind: 'frame', props: { x: 100, y: 100, w: 300, h: 300 } },
      { t: 'shape.create', kind: 'rect', props: { x: 150, y: 160, w: 20, h: 20 } },
      { t: 'shape.reparent', ids: ['$1'], parent: '$0', keepWorld: true },
    ]);
    expect(r.ok).toBe(true);
    const id = rid(r.results[1]);
    expect(sh(id).parent).toBe(rid(r.results[0]));
    expect([sh(id).x, sh(id).y]).toEqual([50, 60]);
    expect(absRect(b.doc.getState(), id)).toMatchObject({ x: 150, y: 160 });
  });

  it('group box is the union; ungroup restores world positions', () => {
    const r = run(H, [rectCmd(0, 0), rectCmd(20, 30), { t: 'shape.group', ids: ['$0', '$1'] }]);
    const [a, c, g] = r.results.map(rid);
    expect(sh(g)).toMatchObject({ kind: 'group', x: 0, y: 0, w: 30, h: 40 });
    expect(sh(c)).toMatchObject({ parent: g, x: 20, y: 30 });
    run(H, [{ t: 'shape.update', ids: [g], patch: { x: 100 } }]);
    run(H, [{ t: 'shape.ungroup', ids: [g] }]);
    expect(sh(g).deleted).toBe(true);
    expect([sh(a).parent, sh(a).x, sh(c).x]).toEqual([null, 100, 120]);
  });

  it('delete removes the subtree; duplicate clones it; reorder changes paint order', () => {
    const r = run(H, [{ t: 'shape.create', kind: 'frame', props: {} }, { t: 'shape.create', kind: 'rect', props: {}, parent: '$0' }]);
    const [f, k] = r.results.map(rid);
    const d = run(H, [{ t: 'shape.duplicate', ids: [f], offset: { x: 5, y: 5 } }]);
    const f2 = rid(d.results[0]);
    expect(b.doc.getState().children.get(f2)!.length).toBe(1);
    expect(b.doc.getState().children.get(null)).toEqual([f, f2]);
    run(H, [{ t: 'shape.reorder', ids: [f], to: 'front' }]);
    expect(b.doc.getState().children.get(null)).toEqual([f2, f]);
    run(H, [{ t: 'shape.delete', ids: [f] }]);
    expect(sh(k).deleted).toBe(true);
    expect(b.doc.getState().children.get(null)).toEqual([f2]);
  });

  it('translate moves roots only; resize sets the box', () => {
    const r = run(H, [{ t: 'shape.create', kind: 'frame', props: { x: 10, y: 10 } }, { t: 'shape.create', kind: 'rect', props: { x: 1, y: 1 }, parent: '$0' }]);
    const [f, k] = r.results.map(rid);
    run(H, [{ t: 'shape.translate', ids: [f, k], dx: 5, dy: 5 }, { t: 'shape.resize', id: k, box: { x: 0, y: 0, w: 7, h: 8 } }]);
    expect([sh(f).x, sh(k).x, sh(k).w]).toEqual([15, 0, 7]);
  });
});

describe('gate', () => {
  it('lock deny blocks agents with locked, humans still succeed; caps and claims', () => {
    const id = rid(run(H, [rectCmd(0, 0)]).results[0]);
    expect(run(A, [{ t: 'shape.translate', ids: [id], dx: 1, dy: 0 }]).ok).toBe(true);
    b.locks.check = () => ({ ok: false, error: 'locked', holder: 'human-you' });
    const denied = run(A, [{ t: 'shape.translate', ids: [id], dx: 1, dy: 0 }]);
    expect(denied.results[0]).toMatchObject({ ok: false, error: 'locked', holder: 'human-you' });
    expect(run(H, [{ t: 'shape.translate', ids: [id], dx: 1, dy: 0 }]).ok).toBe(true);
    const atomic = run(A, [rectCmd(0, 0), { t: 'shape.delete', ids: [id] }], { atomic: true });
    expect(atomic.ok).toBe(false);
    expect(sh(id).deleted).toBeUndefined();
    b.locks.check = () => ({ ok: true });
    b.claims.check = () => ({ ok: false, error: 'claimed_by', holder: 'agent-zzzz' });
    expect(run(A, [{ t: 'shape.delete', ids: [id] }]).results[0]).toMatchObject({ error: 'claimed_by' });
    b.actors.register({ id: 'agent-obs1', kind: 'agent', name: 'obs', color: '#000', caps: ['read'] });
    expect(run('agent-obs1', [rectCmd(0, 0)]).results[0]).toMatchObject({ error: 'forbidden' });
  });
});

describe('gesture, undo, selection', () => {
  it('gesture re-plans from base, commits one undoable tx; abort leaves nothing', () => {
    const id = rid(run(H, [rectCmd(0, 0)]).results[0]);
    const g = b.gesture(H, 'Drag');
    for (let i = 1; i <= 30; i++) g.update([{ t: 'shape.translate', ids: [id], dx: i, dy: 0 }]);
    expect(sh(id).x).toBe(30);
    const before = b.doc.log().length;
    const r = g.commit();
    expect(r.ok && r.tx).toBeTruthy();
    expect(b.doc.log().length).toBe(before + 1);
    expect(b.undo(H)).toBe(true);
    expect(sh(id).x).toBe(0);
    expect(b.redo(H)).toBe(true);
    expect(sh(id).x).toBe(30);
    const g2 = b.gesture(H, 'Draw');
    g2.update([rectCmd(0, 0)]); g2.update([rectCmd(0, 0, 50, 50)]);
    expect(live().length).toBe(2);
    g2.abort();
    expect(live().length).toBe(1);
  });

  it('undo is per actor and not recorded for undo itself', () => {
    const a = rid(run(A, [rectCmd(0, 0)]).results[0]);
    run(H, [rectCmd(1, 1)]);
    expect(b.undo(H)).toBe(true);
    expect(sh(a).deleted).toBeUndefined();
    expect(b.undo(H)).toBe(false);
    expect(b.undo(A)).toBe(true);
    expect(sh(a).deleted).toBe(true);
  });

  it('selection.set is presence, per actor, not undoable, pruned on delete', () => {
    const id = rid(run(H, [rectCmd(0, 0)]).results[0]);
    run(A, [{ t: 'selection.set', ids: [id] }]);
    expect(b.selection.get(A).ids).toEqual([id]);
    expect(b.selection.get(H).ids).toEqual([]);
    expect(b.undo(A)).toBe(false);
    run(H, [{ t: 'shape.delete', ids: [id] }]);
    expect(b.selection.get(A).ids).toEqual([]);
  });
});

describe('window.board shim', () => {
  it('legacy names and exec work', () => {
    const dev = createDevtools(b);
    const id = dev.addShape({ x: 5, y: 6, fill: '#ff0000' });
    expect(dev.shapes()[0]).toMatchObject({ id, x: 5, y: 6, fill: '#ff0000' });
    expect(dev.updateShape(id, { x: 9 })).toBe(true);
    expect(dev.shapes()[0].x).toBe(9);
    expect(dev.exec({ commands: [rectCmd(0, 0)] }).ok).toBe(true);
    expect(dev.exec({ t: 'shape.delete', ids: [id] }).ok).toBe(true);
    const c = dev.addCursor('Bot');
    dev.moveCursor(c, 10, 20);
    expect(dev.cursors().find((x: any) => x.id === c)).toMatchObject({ x: 10, y: 20 });
    expect(dev.bench().ok).toBe(false);
  });
});

describe('claim.acquire (WP-40 wiring)', () => {
  it('denies an overlapping claim to another agent, never to a human', () => {
    const board = createBoard({ me: 'human-you' });
    const mk = board.exec({ actor: 'agent-iris', opId: 'c-mk', commands: [{ t: 'shape.create', kind: 'frame', props: { x: 0, y: 0, w: 300, h: 200 } }] });
    const frame = mk.results[0].ok ? mk.results[0].id! : '';
    const a = board.exec({ actor: 'agent-iris', opId: 'c-a', commands: [{ t: 'claim.acquire', target: { kind: 'shape', id: frame } }] });
    expect(a.ok).toBe(true);
    const b = board.exec({ actor: 'agent-bolt', opId: 'c-b', commands: [{ t: 'claim.acquire', target: { kind: 'shape', id: frame } }] });
    expect(b.ok).toBe(false);
    expect(b.results[0]).toMatchObject({ ok: false, error: 'claimed_by', holder: 'agent-iris' });
    const h = board.exec({ actor: 'human-you', opId: 'c-h', commands: [{ t: 'claim.acquire', target: { kind: 'shape', id: frame } }] });
    expect(h.ok).toBe(true);
  });
});
