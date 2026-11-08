import { describe, expect, it } from 'vitest';
import { createBoard } from '../../core/commands';
import { remoteOutlines } from './RemoteSelections';

describe('remoteOutlines', () => {
  it('lists other actors selections and upgrades locked shapes to editing', () => {
    const board = createBoard();
    const iris = board.actors.spawn({ kind: 'agent', name: 'Iris' });
    const kit = board.actors.spawn({ kind: 'agent', name: 'Kit' });
    board.selection.set(board.me, ['mine']);
    board.selection.set(iris.id, ['a', 'b']);
    board.locks.acquire('b', iris.id);
    board.locks.acquire('c', kit.id);
    board.locks.acquire('mine', board.me);
    const out = remoteOutlines(board);
    expect(out.map((o) => [o.actor, o.shapeId, o.editing])).toEqual([
      [iris.id, 'a', false], [iris.id, 'b', true], [kit.id, 'c', true],
    ]);
  });
});
