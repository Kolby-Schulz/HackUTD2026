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

  it('keeps behavior_note set by an agent through report_change', () => {
    const noted = server({ behaviorNote: 'rounds half-up now' });
    expect(planUpsert(map, [noted], map.edges)).toBeUndefined();
    const u = planUpsert({ ...map, edges: [] }, [noted], map.edges);
    expect(u?.symbols[0].behaviorNote).toBe('rounds half-up now');
  });

  it("keeps an agent's reported signature text while the hash in this checkout is unchanged", () => {
    const reported = server({ signature: 'calculateFee(amount: number, mode: Rounding): number' }); // report_change text, old hash
    const u = planUpsert({ ...map, edges: [] }, [reported], map.edges); // some other change forces a send
    expect(u?.symbols[0].signature).toBe('calculateFee(amount: number, mode: Rounding): number');
    expect(u?.symbols[0].signatureHash).toBe(signatureHash(SIG));
  });

  it('an empty map against an empty server is a no-op; against rows it clears them', () => {
    const empty: FileMap = { file: 'src/fees.ts', symbols: [], edges: [] };
    expect(planUpsert(empty, [], [])).toBeUndefined();
    expect(planUpsert(empty, [server()], map.edges)).toEqual(empty);
  });
});
