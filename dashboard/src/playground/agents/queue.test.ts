import { describe, expect, it } from 'vitest';
import type { Task } from '../core/types';
import { createTaskQueue } from './queue';

const t = (id: string, priority: 0 | 1 | 2 | 3 = 1, text = id): Task => ({ id, agent: 'a', kind: 'note', text, priority, from: 'human-you', state: 'queued' });

describe('task queue', () => {
  it('runs higher priority first, FIFO within a priority, one at a time', () => {
    const q = createTaskQueue();
    q.enqueue(t('a')); q.enqueue(t('b')); q.enqueue(t('c', 3)); q.enqueue(t('d', 2));
    expect(q.next()!.id).toBe('c');
    expect(q.next()).toBeUndefined();            // c still running
    q.finish();
    expect([q.next()!.id, (q.finish(), q.next()!.id), (q.finish(), q.next()!.id)]).toEqual(['d', 'a', 'b']);
  });
  it('cancel removes a queued task and marks it cancelled', () => {
    const q = createTaskQueue();
    q.enqueue(t('a')); q.enqueue(t('b'));
    const c = q.cancel('a')!;
    expect(c.state).toBe('cancelled');
    expect(q.queued().map((x) => x.id)).toEqual(['b']);
    expect(q.cancel('zzz')).toBeUndefined();
  });
  it('rejects past capacity and merges identical consecutive notes', () => {
    const q = createTaskQueue(2);
    q.enqueue(t('a', 1, 'same'));
    const m = q.enqueue(t('b', 1, 'same'));
    expect(m.ok && m.merged).toBe(true);
    q.enqueue(t('c', 1, 'other'));
    expect(q.enqueue(t('d', 1, 'x'))).toEqual({ ok: false, reason: 'full' });
  });
  it('promote moves a task to the front', () => {
    const q = createTaskQueue();
    q.enqueue(t('a')); q.enqueue(t('b'));
    q.promote('b');
    expect(q.next()!.id).toBe('b');
  });
});
