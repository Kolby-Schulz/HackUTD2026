// Ops this client made that the server has not confirmed yet, keyed by op id.
// An op leaves the outbox only when its row shows up in the board_op subscription (the ack). After a reconnect every
// unconfirmed op is sent again; push_ops skips an op id it already has with the same body, so resending is safe.
import { MAX_OPS_PER_PUSH } from './types';
import type { PushOp } from './types';

type State = 'queued' | 'sent';

export interface Outbox {
  add(ops: readonly PushOp[]): void;
  /** The next batch to send (at most 100 queued ops that pass `ready`, oldest first); marks them sent. */
  take(ready?: (op: PushOp) => boolean): PushOp[];
  /** The server confirmed these op ids. */
  ack(opIds: Iterable<string>): void;
  /** A push failed for a reason that may pass (connection): put its ops back in the queue. */
  retry(ops: readonly PushOp[]): void;
  /** A push was refused for good: drop its ops and return them. */
  drop(ops: readonly PushOp[]): PushOp[];
  /** Connection came back: everything unconfirmed goes back in the queue. */
  requeueAll(): void;
  size(): number;
  queued(): number;
}

export function createOutbox(): Outbox {
  // Map keeps insertion order, so batches go out in the order the ops were made.
  const items = new Map<string, { op: PushOp; state: State }>();
  return {
    add(ops) { for (const op of ops) if (!items.has(op.opId)) items.set(op.opId, { op, state: 'queued' }); },
    take(ready) {
      const out: PushOp[] = [];
      for (const it of items.values()) {
        if (it.state !== 'queued' || (ready && !ready(it.op))) continue;
        it.state = 'sent';
        out.push(it.op);
        if (out.length === MAX_OPS_PER_PUSH) break;
      }
      return out;
    },
    ack(ids) { for (const id of ids) items.delete(id); },
    retry(ops) { for (const op of ops) { const it = items.get(op.opId); if (it) it.state = 'queued'; } },
    drop(ops) { return ops.filter((op) => items.delete(op.opId)); },
    requeueAll() { for (const it of items.values()) it.state = 'queued'; },
    size: () => items.size,
    queued: () => { let n = 0; for (const it of items.values()) if (it.state === 'queued') n++; return n; },
  };
}
