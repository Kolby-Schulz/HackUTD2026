// Collision-free ids (D10). newId = prefix + time-ordered base36 + per-ms counter + 6 random base62 chars.
// Op ids are `${actor}:${seq}`; seqs are persisted in SavedBoard.seq and restored on load.
import type { ActorId } from './types';

const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function randomChars(n: number): string {
  const bytes = new Uint8Array(n);
  globalThis.crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += B62[b % 62];
  return s;
}

let lastMs = 0;
let counter = 0;

/** Valid DOM/CSS token and URL-safe as long as the prefix is (letters, digits, '-'). */
export function newId(prefix = 's'): string {
  const ms = Math.max(Date.now(), lastMs); // never go backwards if the clock does
  counter = ms === lastMs ? counter + 1 : 0;
  lastMs = ms;
  const time = ms.toString(36).padStart(9, '0');
  const seq = (counter % 1296).toString(36).padStart(2, '0');
  return `${prefix}${time}${seq}${randomChars(6)}`;
}

const seqs = new Map<ActorId, number>();

/** Next op id for an actor: `actor:seq`, seq starts at 1 and survives reload via restoreSeqs. */
export function opId(actor: ActorId): string {
  const n = (seqs.get(actor) ?? 0) + 1;
  seqs.set(actor, n);
  return `${actor}:${n}`;
}

export function exportSeqs(): Record<ActorId, number> {
  return Object.fromEntries(seqs);
}

/** Merge saved seqs (keeps the larger value so a stale save cannot rewind a counter). */
export function restoreSeqs(saved: Record<ActorId, number>): void {
  for (const [actor, n] of Object.entries(saved)) {
    if (Number.isFinite(n) && n > (seqs.get(actor) ?? 0)) seqs.set(actor, n);
  }
}

export function parseOpId(id: string): { actor: ActorId; seq: number } | null {
  const i = id.lastIndexOf(':');
  const seq = Number(id.slice(i + 1));
  return i > 0 && Number.isInteger(seq) ? { actor: id.slice(0, i), seq } : null;
}

/** Test helper: forget all counters. */
export function resetSeqs(): void {
  seqs.clear();
}
