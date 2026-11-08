// Per-agent task queue: higher priority first, FIFO within a priority, capacity-limited, cancelable.
// Pure data structure (no timers, no board). The runtime feeds the driver one task at a time.
import type { Task } from '../core/types';

export const QUEUE_CAPACITY = 50;

export type EnqueueResult =
  | { ok: true; task: Task; merged: boolean }      // merged = an identical queued note was reused
  | { ok: false; reason: 'full' };

export interface TaskQueue {
  /** Add a queued task. An identical consecutive note (same text, layer and priority) is merged. */
  enqueue(task: Task): EnqueueResult;
  /** Take the highest-priority queued task and mark it running (undefined when none is queued). */
  next(): Task | undefined;
  /** Remove a queued task (state `cancelled`). Returns it, or undefined if it is not queued. */
  cancel(id: string): Task | undefined;
  /** Move a queued task to the front by raising its priority to 3. */
  promote(id: string): boolean;
  /** Empty the queue, marking every queued task `cancelled`. */
  clear(): Task[];
  queued(): readonly Task[];
  running(): Task | undefined;
  /** Mark the running task finished. */
  finish(state?: 'done' | 'failed' | 'cancelled'): Task | undefined;
}

export function createTaskQueue(capacity = QUEUE_CAPACITY): TaskQueue {
  let items: Task[] = [];
  let current: Task | undefined;

  const insert = (t: Task) => {
    const at = items.findIndex((x) => x.priority < t.priority);
    items.splice(at < 0 ? items.length : at, 0, t);
  };

  return {
    enqueue(task) {
      const last = items[items.length - 1];
      if (last && last.kind === task.kind && last.text === task.text && last.shapeId === task.shapeId && last.priority === task.priority) {
        return { ok: true, task: last, merged: true };
      }
      if (items.length >= capacity) return { ok: false, reason: 'full' };
      task.state = 'queued';
      insert(task);
      return { ok: true, task, merged: false };
    },
    next() {
      if (current || !items.length) return undefined;
      current = items.shift()!;
      current.state = 'running';
      return current;
    },
    cancel(id) {
      const i = items.findIndex((t) => t.id === id);
      if (i < 0) return undefined;
      const [t] = items.splice(i, 1);
      t.state = 'cancelled';
      return t;
    },
    promote(id) {
      const i = items.findIndex((t) => t.id === id);
      if (i < 0) return false;
      const [t] = items.splice(i, 1);
      t.priority = 3;
      insert(t);
      return true;
    },
    clear() {
      const out = items;
      items = [];
      for (const t of out) t.state = 'cancelled';
      return out;
    },
    queued: () => items,
    running: () => current,
    finish(state = 'done') {
      const t = current;
      current = undefined;
      if (t) t.state = state;
      return t;
    },
  };
}
