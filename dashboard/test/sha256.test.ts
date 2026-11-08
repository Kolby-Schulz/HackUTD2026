// The dashboard's plain-JS SHA-256 must match Node's, and its pairing proof must match the daemon's.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { pairProof, sha256Hex } from '../src/sha256.ts';
import { pairProof as daemonProof } from '../../scripts/daemon.ts';

describe('sha256Hex', () => {
  it('matches node:crypto for short, block-edge and multi-block input', () => {
    for (const s of ['', 'abc', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'é✓'.repeat(100)]) {
      expect(sha256Hex(s)).toBe(createHash('sha256').update(s).digest('hex'));
    }
  });
  it('makes the same pairing proof as the daemon', () => {
    const id = 'C200' + 'ab'.repeat(30);
    expect(pairProof('k7q-4xm', id)).toBe(daemonProof('K7Q4XM', id));
  });
});
