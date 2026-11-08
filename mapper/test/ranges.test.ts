// symbolRanges / symbolsTouched (issue #24: live diffs and the claim guard).
import { describe, it, expect } from 'vitest';
import { symbolRanges, symbolsTouched } from '../src/index.ts';

const SRC = `import { x } from './x';

/** Fee for an amount. */
export function calculateFee(amount: number): number {
  return Math.floor(amount * 0.03);
}

export class Invoice {
  total = 0;
  add(n: number): void {
    this.total += n;
  }
}

export const RATE: number = 0.03;
function hidden() {}
`;

describe('symbolRanges / symbolsTouched', () => {
  const ranges = symbolRanges('src/fees.ts', SRC);
  it('gives line spans including JSDoc', () => {
    expect(ranges.find((r) => r.id === 'src/fees.ts#calculateFee')).toMatchObject({ startLine: 3, endLine: 6 });
    expect(ranges.find((r) => r.id === 'src/fees.ts#Invoice.add')).toMatchObject({ startLine: 10, endLine: 12 });
    expect(ranges.map((r) => r.id)).not.toContain('src/fees.ts#hidden');
  });
  it('maps changed lines to the most specific symbol', () => {
    expect(symbolsTouched(ranges, [5])).toEqual(['src/fees.ts#calculateFee']);
    expect(symbolsTouched(ranges, [11])).toEqual(['src/fees.ts#Invoice.add']);
    expect(symbolsTouched(ranges, [9])).toEqual(['src/fees.ts#Invoice']);
    expect(symbolsTouched(ranges, [1, 15])).toEqual(['src/fees.ts#RATE']);
  });
  it('ignores non-source files', () => {
    expect(symbolRanges('README.md', '# hi')).toEqual([]);
  });
});
