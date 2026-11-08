import { describe, expect, it } from 'vitest';
import { createBoard } from './commands';
import { flatten } from './tree';
import { mulberry, nextTarget, startStress } from './stress';

describe('stress', () => {
  it('nextTarget stays inside the extent and is deterministic', () => {
    const a = mulberry(7), b = mulberry(7);
    for (let i = 0; i < 50; i++) {
      const t = nextTarget(a, { x: 10, y: 10 }, 500, 300);
      expect(t).toEqual(nextTarget(b, { x: 10, y: 10 }, 500, 300));
      expect(t.x).toBeGreaterThanOrEqual(0); expect(t.x).toBeLessThanOrEqual(500);
      expect(t.y).toBeGreaterThanOrEqual(0); expect(t.y).toBeLessThanOrEqual(300);
    }
  });
  it('spawns agents and shapes, moves cursors, and cleans up completely', async () => {
    const board = createBoard();
    const before = board.actors.list().length;
    const shapesBefore = flatten(board.doc.getState()).length;
    const h = startStress(board, { agents: 20, shapes: 100 });
    expect(h.agents).toBe(20);
    expect(board.actors.list().length).toBe(before + 21);
    expect(flatten(board.doc.getState()).length).toBe(shapesBefore + 100);
    const id = board.actors.list().find((a) => a.name === 'Stress 1')!.id;
    const p0 = board.presence.get(id)!;
    await new Promise((r) => setTimeout(r, 250));
    const p1 = board.presence.get(id)!;
    expect(p1.x !== p0.x || p1.y !== p0.y).toBe(true);
    h.stop();
    expect(board.actors.list().length).toBe(before);
    expect(board.presence.get(id)).toBeUndefined();
    expect(flatten(board.doc.getState()).length).toBe(shapesBefore);
    h.stop();   // idempotent
  });
  it('a second run replaces the first', () => {
    const board = createBoard();
    const a = startStress(board, { agents: 5 }); startStress(board, { agents: 3 });
    expect(board.actors.list().filter((x) => x.name.startsWith('Stress')).length).toBe(3);
    a.stop();
  });
});
