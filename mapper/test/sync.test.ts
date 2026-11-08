import { describe, expect, it } from 'vitest';
import { planUpsert, signatureHash, type FileMap, type ServerSymbol } from '../src/index.ts';

const SIG = 'calculateFee(amount: number): number';
const map: FileMap = {
  file: 'src/fees.ts',
  symbols: [
    { id: 'src/fees.ts#calculateFee', name: 'calculateFee', kind: 'function', signature: SIG, signatureHash: signatureHash(SIG), behaviorNote: '' },
  ],
  edges: [{ callerId: 'src/fees.ts#calculateFee', calleeId: 'src/models.ts#FEE_RATE' }],
};
const server = (over: Partial<ServerSymbol> = {}): ServerSymbol => ({
  id: 'src/fees.ts#calculateFee',
  name: 'calculateFee',
  kind: 'function',
  file: 'src/fees.ts',
  signature: SIG,
  signatureHash: signatureHash(SIG),
  behaviorNote: '',
  ...over,
});

describe('planUpsert', () => {
  it('sends nothing when the server already has this map (restart is a no-op)', () => {
    expect(planUpsert(map, [server()], map.edges)).toBeUndefined();
  });

  it('sends everything for a file the server has never seen', () => {
    expect(planUpsert(map, [], [])).toEqual(map);
  });

  it('sends when an edge changed', () => {
    expect(planUpsert(map, [server()], [])).toBeDefined();
    expect(planUpsert(map, [server()], [...map.edges, { callerId: 'src/fees.ts#calculateFee', calleeId: 'x#y' }])).toBeDefined();
  });

  it('sends when a symbol was removed from the file', () => {
    const extra = server({ id: 'src/fees.ts#old', name: 'old' });
    expect(planUpsert(map, [server(), extra], map.edges)?.symbols.map((s) => s.id)).toEqual(['src/fees.ts#calculateFee']);
  });

  it('sends a new hash when the signature changed', () => {
    const old = server({ signature: 'calculateFee(a: string): number', signatureHash: signatureHash('calculateFee(a: string): number') });
    const u = planUpsert(map, [old], map.edges);
    expect(u?.symbols[0].signature).toBe(SIG);
    expect(u?.symbols[0].signatureHash).toBe(signatureHash(SIG));
  });

  it('an agent-set behavior_note or reported signature alone is no reason to send', () => {
    // upsert_symbols keeps both on the server (issue #25), so the mapper ignores them.
    const reported = server({ behaviorNote: 'rounds half-up now', signature: 'calculateFee(amount: number, mode: Rounding): number' });
    expect(planUpsert(map, [reported], map.edges)).toBeUndefined();
    const u = planUpsert({ ...map, edges: [] }, [reported], map.edges); // some other change forces a send
    expect(u?.symbols).toEqual(map.symbols); // sends what it parsed; the server keeps the agent's fields
  });

  it('an empty map against an empty server is a no-op; against rows it clears them', () => {
    const empty: FileMap = { file: 'src/fees.ts', symbols: [], edges: [] };
    expect(planUpsert(empty, [], [])).toBeUndefined();
    expect(planUpsert(empty, [server()], map.edges)).toEqual(empty);
  });
});
