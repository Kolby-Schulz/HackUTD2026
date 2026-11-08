import { describe, expect, it } from 'vitest';
import { createBoard } from '../core/commands';
import { opId } from '../core/ids';
import { registerDemoSeed, resetToSeed, seedBoard, SEED_ID } from './seed';
import { demoHooks } from './demo';

const live = (b: ReturnType<typeof createBoard>) => {
  const st = b.doc.getState();
  return [...st.shapes.values()].filter((s) => !s.deleted).map((s) => JSON.stringify({ n: s.name, k: s.kind, p: s.parent ? b.doc.getState().shapes.get(s.parent)?.name : null, x: (s as any).x, y: (s as any).y, w: (s as any).w, h: (s as any).h, t: (s as any).text })).sort();
};

describe('demo seed', () => {
  it('seeds 6 layers, idempotently', () => {
    const b = createBoard({ me: 'human-1' });
    seedBoard({ board: b }); seedBoard({ board: b });
    expect(live(b).length).toBe(6);
  });
  it('reset equals the seed (deep) and is one undo step', () => {
    const b = createBoard({ me: 'human-1' });
    seedBoard({ board: b });
    const want = live(b);
    b.exec({ actor: 'human-1', opId: opId('human-1'), commands: [{ t: 'shape.create', kind: 'rect', props: { x: 5, y: 5, w: 10, h: 10, name: 'stray' } }, { t: 'shape.update', ids: [[...b.doc.getState().shapes.values()].find((s) => s.name === 'Brief title' && !s.deleted)!.id], patch: { text: 'changed' } }] });
    expect(live(b)).not.toEqual(want);
    resetToSeed({ board: b });
    expect(live(b)).toEqual(want);
    resetToSeed({ board: b });
    expect(live(b)).toEqual(want);
    b.undo('human-1');
    expect(live(b)).toEqual(want);
  });
  it('registers the hooks', () => {
    registerDemoSeed();
    expect(demoHooks.seed).toBeDefined();
    expect(demoHooks.reset).toBeDefined();
    expect(SEED_ID).toBe('seed-brief');
  });
});
