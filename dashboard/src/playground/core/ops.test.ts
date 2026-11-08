import { describe, expect, it } from 'vitest';
import { applyOp, childrenOf } from './ops';
import type { DocState, Op, OpEnvelope, Shape } from './types';

const empty = (): DocState => ({ rev: 0, lamport: 0, shapes: new Map(), children: new Map(), meta: { name: 'T' } });
let n = 0;
const env = (actor: string, lamport: number, body: Op): OpEnvelope => ({ opId: `${actor}:${++n}`, actor, lamport, ts: 0, tx: 't', body });
const mk = (id: string, extra: Partial<Shape> = {}): Op => ({
  t: 'create',
  shape: { id, kind: 'rect', name: id, x: 0, y: 0, w: 10, h: 10, fills: [], parent: null, index: 'V', createdBy: 'human-a', ...extra },
});
const run = (envs: OpEnvelope[], s = empty()) => envs.reduce(applyOp, s);
const strip = (s: DocState) => JSON.stringify([[...s.shapes.entries()].sort(), [...s.children.entries()]]);

describe('applyOp', () => {
  it('create stamps every field and place; returns same state on replay', () => {
    const e = env('human-a', 1, mk('a'));
    const s1 = applyOp(empty(), e);
    expect(s1.shapes.get('a')!.stamps.x).toEqual([1, 'human-a']);
    expect(s1.shapes.get('a')!.stamps.place).toEqual([1, 'human-a']);
    expect(s1.children.get(null)).toEqual(['a']);
    expect(applyOp(s1, e)).toBe(s1);
  });

  it('does not mutate its input', () => {
    const s1 = run([env('human-a', 1, mk('a'))]);
    const before = JSON.stringify([...s1.shapes]);
    applyOp(s1, env('human-a', 2, { t: 'set', id: 'a', patch: { x: 5 } }));
    expect(JSON.stringify([...s1.shapes])).toBe(before);
  });

  it('applying the same envelope twice equals once', () => {
    const base = run([env('human-a', 1, mk('a')), env('human-a', 2, mk('p'))]);
    const ops = [
      env('agent-b', 3, { t: 'set', id: 'a', patch: { x: 9 } }),
      env('agent-b', 4, { t: 'place', id: 'a', parent: 'p', index: 'W' }),
      env('agent-b', 5, { t: 'remove', id: 'p' }),
      env('agent-b', 6, { t: 'restore', id: 'p' }),
    ];
    for (const e of ops) {
      const once = applyOp(base, e);
      expect(applyOp(once, e)).toBe(once);
    }
    const all = run(ops, base);
    expect(run(ops, all)).toBe(all);
  });

  it('different fields from two actors both survive in any order', () => {
    const base = run([env('human-a', 1, mk('a'))]);
    const e1 = env('human-a', 5, { t: 'set', id: 'a', patch: { x: 50 } });
    const e2 = env('agent-b', 5, { t: 'set', id: 'a', patch: { w: 99 } });
    const ab = run([e1, e2], base), ba = run([e2, e1], base);
    expect(ab.shapes.get('a')).toMatchObject({ x: 50, w: 99 });
    expect(strip(ab)).toBe(strip(ba));
  });

  it('same field resolves by (lamport, actor) in any order', () => {
    const base = run([env('human-a', 1, mk('a'))]);
    const lo = env('human-a', 5, { t: 'set', id: 'a', patch: { x: 1 } });
    const hi = env('zed-b', 5, { t: 'set', id: 'a', patch: { x: 2 } }); // actor tie-break ('zed' > 'human')
    const later = env('human-a', 6, { t: 'set', id: 'a', patch: { x: 3 } });
    expect(run([lo, hi], base).shapes.get('a')!.x).toBe(2);
    expect(run([hi, lo], base).shapes.get('a')!.x).toBe(2);
    expect(run([later, hi, lo], base).shapes.get('a')!.x).toBe(3);
  });

  it('remove then set keeps the tombstone; restore brings back id and props', () => {
    const base = run([env('human-a', 1, mk('a', { name: 'keep' }))]);
    const gone = run([env('human-a', 2, { t: 'remove', id: 'a' }), env('agent-b', 9, { t: 'set', id: 'a', patch: { name: 'late' } })], base);
    expect(gone.shapes.get('a')!.deleted).toBe(true);
    expect(gone.shapes.get('a')!.name).toBe('keep');
    expect(gone.children.get(null)).toBeUndefined();
    const back = applyOp(gone, env('human-a', 10, { t: 'restore', id: 'a' }));
    expect(back.shapes.get('a')).toMatchObject({ id: 'a', name: 'keep' });
    expect(back.shapes.get('a')!.deleted).toBeUndefined();
    expect(back.children.get(null)).toEqual(['a']);
  });

  it('a restore older than the remove does not resurrect; an old remove after restore is ignored', () => {
    const base = run([env('human-a', 1, mk('a'))]);
    const rm = env('human-a', 5, { t: 'remove', id: 'a' });
    const oldRestore = env('agent-b', 3, { t: 'restore', id: 'a' });
    expect(run([rm, oldRestore], base).shapes.get('a')!.deleted).toBe(true);
    const rm2 = env('human-a', 3, { t: 'remove', id: 'a' });
    const rs = env('human-a', 6, { t: 'restore', id: 'a' });
    const a = run([rm2, rs], base), b = run([rs, rm2], base);
    expect(a.shapes.get('a')!.deleted).toBeUndefined();
    expect(strip(a)).toBe(strip(b));
  });

  it('place into a deleted or missing parent leaves the child at root', () => {
    const base = run([env('human-a', 1, mk('c')), env('human-a', 2, mk('p')), env('human-a', 3, { t: 'remove', id: 'p' })]);
    const s = applyOp(base, env('agent-b', 4, { t: 'place', id: 'c', parent: 'p', index: 'W' }));
    expect(s.children.get(null)).toContain('c');
    expect(s.children.get('p')).toBeUndefined();
    const s2 = applyOp(base, env('agent-b', 4, { t: 'place', id: 'c', parent: 'nope', index: 'W' }));
    expect(s2.children.get(null)).toEqual(['c']);
  });

  it('children of a parent that is later deleted show at root, and return on restore', () => {
    const s = run([env('h', 1, mk('p')), env('h', 2, mk('c', { parent: 'p' })), env('h', 3, { t: 'remove', id: 'p' })]);
    expect(s.children.get(null)).toEqual(['c']);
    const r = applyOp(s, env('h', 4, { t: 'restore', id: 'p' }));
    expect(r.children.get('p')).toEqual(['c']);
    expect(childrenOf(r.shapes)).toEqual(r.children);
  });

  it('place is atomic (parent+index), LWW, and cycles are re-rooted', () => {
    const base = run([env('h', 1, mk('a')), env('h', 2, mk('b', { parent: 'a' }))]);
    const cyc = applyOp(base, env('h', 3, { t: 'place', id: 'a', parent: 'b', index: 'V' }));
    expect(cyc.shapes.get('a')!.parent).toBeNull();
    const hi = env('h', 9, { t: 'place', id: 'b', parent: null, index: 'X' });
    const lo = env('g', 5, { t: 'place', id: 'b', parent: 'a', index: 'Y' });
    const x = run([hi, lo], base), y = run([lo, hi], base);
    expect(x.shapes.get('b')).toMatchObject({ parent: null, index: 'X' });
    expect(strip(x)).toBe(strip(y));
  });

  it('create of an existing or tombstoned id is a no-op', () => {
    const s = run([env('h', 1, mk('a')), env('h', 2, { t: 'remove', id: 'a' })]);
    expect(applyOp(s, env('g', 3, mk('a', { name: 'again' })))).toBe(s);
  });

  it('unknown ids are no-ops and board patches are idempotent', () => {
    const s = empty();
    expect(applyOp(s, env('h', 1, { t: 'set', id: 'zz', patch: { x: 1 } }))).toBe(s);
    expect(applyOp(s, env('h', 1, { t: 'remove', id: 'zz' }))).toBe(s);
    const e = env('h', 2, { t: 'board', patch: { name: 'New' } });
    const s2 = applyOp(s, e);
    expect(s2.meta.name).toBe('New');
    expect(applyOp(s2, e)).toBe(s2);
  });

  it('converges for every permutation of a mixed op set', () => {
    const base = run([env('h', 1, mk('a')), env('h', 2, mk('b')), env('h', 3, mk('p'))]);
    const ops = [
      env('h', 10, { t: 'set', id: 'a', patch: { x: 1, y: 2 } }),
      env('g', 10, { t: 'set', id: 'a', patch: { x: 7 } }),
      env('g', 11, { t: 'place', id: 'a', parent: 'p', index: 'Z' }),
      env('h', 12, { t: 'place', id: 'a', parent: 'b', index: 'Q' }),
      env('h', 13, { t: 'remove', id: 'b' }),
      env('g', 14, { t: 'restore', id: 'b' }),
    ];
    const perms = (xs: OpEnvelope[]): OpEnvelope[][] => xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((r) => [x, ...r]));
    const results = new Set(perms(ops).map((p) => strip(run(p, base))));
    expect(results.size).toBe(1);
  });
});
