import { describe, expect, it } from 'vitest';
import { createEventBus } from './events';
import type { BoardEvent } from './types';

describe('event bus', () => {
  it('filters by kind and shape id, in seq order', () => {
    const bus = createEventBus(() => 1);
    const got: BoardEvent[] = [];
    bus.subscribe({ kinds: ['shape.updated'], shapeIds: ['a'] }, (e) => got.push(e));
    bus.emit({ t: 'shape.updated', actor: 'human-you', ids: ['a'] });
    bus.emit({ t: 'shape.updated', actor: 'human-you', ids: ['b'] });
    bus.emit({ t: 'shape.created', actor: 'human-you', ids: ['a'] });
    bus.emit({ t: 'shape.updated', actor: 'agent-x', ids: ['b', 'a'] });
    expect(got.map((e) => e.seq)).toEqual([1, 4]);
  });
  it('addressedTo, actors, unsubscribe, self skip', () => {
    const bus = createEventBus();
    const got: number[] = [];
    const off = bus.subscribe({ addressedTo: 'agent-x' }, (e) => got.push(e.seq), { self: 'agent-x' });
    bus.emit({ t: 'comment.created', actor: 'human-you', threadId: 't', to: ['agent-x'] });
    bus.emit({ t: 'comment.created', actor: 'agent-x', threadId: 't', to: ['agent-x'] });
    bus.emit({ t: 'comment.created', actor: 'human-you', threadId: 't', to: ['agent-y'] });
    off();
    bus.emit({ t: 'comment.created', actor: 'human-you', threadId: 't', to: ['agent-x'] });
    expect(got).toEqual([1]);
  });
  it('reentrant emit is delivered after the current event, in order', () => {
    const bus = createEventBus();
    const order: string[] = [];
    bus.subscribe({}, (e) => {
      order.push(`a${e.seq}`);
      if (e.seq === 1) bus.emit({ t: 'selection.changed', actor: 'human-you', ids: [] });
    });
    bus.subscribe({}, (e) => order.push(`b${e.seq}`));
    bus.emit({ t: 'selection.changed', actor: 'human-you', ids: [] });
    expect(order).toEqual(['a1', 'b1', 'a2', 'b2']);
  });
});
