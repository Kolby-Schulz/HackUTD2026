import { describe, expect, it } from 'vitest';
import { createBoard } from '../core/commands';
import { createRuntime } from './runtime';
import type { ActionInfo } from './runtime';
import { fakeClock } from './fakes.test';

describe('action cards and the thinking placeholder', () => {
  it('a note edit posts a thinking start, then one card with the tx, and drops the Done line', async () => {
    const board = createBoard({ me: 'human-1' });
    const c = board.exec({ actor: 'human-1', opId: 'c', commands: [{ t: 'shape.create', kind: 'rect', props: { x: 0, y: 0, w: 40, h: 40, name: 'Button', fills: [{ type: 'solid', color: '#111111' }] } }] });
    const id = (c.results[0] as { id: string }).id;
    const log: string[] = [];
    const cards: ActionInfo[] = [];
    const rt = createRuntime({
      board, clock: fakeClock(), seed: 1, frameMs: 20, animate: false,
      onSay: (_a, t) => log.push('say:' + t),
      onThinking: (_a, on) => log.push(on ? 'think' : 'unthink'),
      onAction: (_a, card) => { cards.push(card); log.push('card'); },
    });
    const agent = rt.spawn();
    await rt.request(agent, { text: 'make it purple', shapeId: id });
    rt.reset();
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ summary: 'Changed fill to purple', layers: [id] });
    expect(log.indexOf('think')).toBeLessThan(log.indexOf('unthink'));
    expect(log).toContain('card');
    expect(log.some((l) => l.startsWith('say:Done'))).toBe(false);
    // the card's tx is exactly what Undo reverts
    expect(board.doc.getState().shapes.get(id)!.fills[0]).toMatchObject({ color: '#a855f7' });
    expect(board.revert('human-1', cards[0].tx).ok).toBe(true);
    expect(board.doc.getState().shapes.get(id)!.fills[0]).toMatchObject({ color: '#111111' });
  }, 15000);
});
