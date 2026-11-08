import { describe, expect, it } from 'vitest';
import { createBoard } from '../core/commands';
import { renameShape, soloVisible, toggleFlag } from './layers';

function setup() {
  const board = createBoard();
  const r = board.exec({ actor: board.me, opId: 'o1', commands: [
    { t: 'shape.create', kind: 'rect', props: { name: 'A', x: 0, y: 0, w: 10, h: 10 }, id: 'a' },
    { t: 'shape.create', kind: 'rect', props: { name: 'B', x: 20, y: 0, w: 10, h: 10 }, id: 'b' },
  ] });
  expect(r.ok).toBe(true);
  return board;
}
const sh = (b: ReturnType<typeof setup>, id: string) => b.doc.getState().shapes.get(id)!;

describe('layer row actions', () => {
  it('renames as one undo entry, empty reverts, caps length', () => {
    const b = setup();
    expect(renameShape(b, 'a', '  Hero  ')).toBe(true);
    expect(sh(b, 'a').name).toBe('Hero');
    expect(sh(b, 'a').nameAuto).toBe(false);
    expect(renameShape(b, 'a', '   ')).toBe(false);
    expect(sh(b, 'a').name).toBe('Hero');
    renameShape(b, 'a', 'x'.repeat(400));
    expect(sh(b, 'a').name.length).toBe(256);
    b.undo(b.me);
    expect(sh(b, 'a').name).toBe('Hero');
  });
  it('toggles lock/hide on all targets, mixed state turns on first', () => {
    const b = setup();
    toggleFlag(b, ['a'], 'locked');
    toggleFlag(b, ['a', 'b'], 'locked');
    expect(sh(b, 'a').locked && sh(b, 'b').locked).toBe(true);
    toggleFlag(b, ['a', 'b'], 'locked');
    expect(!!sh(b, 'a').locked || !!sh(b, 'b').locked).toBe(false);
    toggleFlag(b, ['b'], 'hidden');
    expect(sh(b, 'b').hidden).toBe(true);
  });
  it('solo hides siblings, second solo restores', () => {
    const b = setup();
    soloVisible(b, 'a');
    expect(sh(b, 'b').hidden).toBe(true);
    expect(sh(b, 'a').hidden).toBeFalsy();
    soloVisible(b, 'a');
    expect(sh(b, 'b').hidden).toBe(false);
  });
});
