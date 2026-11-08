// Op envelopes <-> board_op rows. The row keeps op_id, actor and tx as columns; the body carries the rest
// (Lamport stamp, client time, the op). The server orders rows by `seq`; Lamport stamps still decide field merges.
import type { OpEnvelope, Op } from '../core/types';
import { parseOpId } from '../core/ids';
import { MAX_OP_BODY_BYTES } from './types';
import type { BoardOpRow, PushOp } from './types';

interface Body { l: number; ts: number; op: Op }

const OP_KINDS = new Set<Op['t']>(['create', 'set', 'place', 'remove', 'restore', 'board']);
const bytes = (s: string) => new TextEncoder().encode(s).length;

export class OpTooLargeError extends Error {
  constructor(readonly opId: string, readonly size: number) {
    super(`op ${opId} is ${size} bytes; the server takes at most ${MAX_OP_BODY_BYTES}`);
    this.name = 'OpTooLargeError';
  }
}

/** Encode one envelope for push_ops. Throws OpTooLargeError past the server's body limit. */
export function encodeOp(env: OpEnvelope): PushOp {
  const body: Body = { l: env.lamport, ts: env.ts, op: env.body };
  const json = JSON.stringify(body);
  const size = bytes(json);
  if (size > MAX_OP_BODY_BYTES) throw new OpTooLargeError(env.opId, size);
  return { opId: env.opId, tx: env.tx, body: json };
}

/** Decode a board_op row, or null when the row is malformed (it is skipped, never applied half-read). */
export function decodeOp(row: Pick<BoardOpRow, 'opId' | 'actor' | 'tx' | 'body'>): OpEnvelope | null {
  const id = parseOpId(row.opId);
  if (!id || id.actor !== row.actor) return null;
  let b: unknown;
  try { b = JSON.parse(row.body); } catch { return null; }
  if (!isBody(b)) return null;
  return { opId: row.opId, actor: row.actor, lamport: b.l, ts: b.ts, tx: row.tx, body: b.op };
}

function isBody(b: unknown): b is Body {
  if (typeof b !== 'object' || b === null) return false;
  const r = b as Record<string, unknown>;
  const op = r.op as Record<string, unknown> | undefined;
  return Number.isFinite(r.l) && Number.isFinite(r.ts) && typeof op === 'object' && op !== null
    && OP_KINDS.has(op.t as Op['t']);
}
