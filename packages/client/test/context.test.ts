// Pure token-saver helpers (src/context.ts).
import { describe, it, expect } from 'vitest';
import {
  buildContext,
  rankExisting,
  querySignature,
  summaryKey,
  estimateTokens,
  SCORE_SAME_NAME,
  SCORE_SAME_TYPES,
  SCORE_SHARED_TOKEN,
  type SymbolRow,
  type EdgeRow,
} from '../src/context';

const FEES = 'src/billing/fees.ts#calculateFee';
const INVOICE = 'src/billing/invoice.ts#buildInvoice';
const TOTAL = 'src/billing/invoice.ts#computeTotal';
const CHECKOUT = 'src/checkout/checkout.ts#checkout';
const ROUND = 'src/billing/round.ts#roundCents';
const DATE = 'src/utils/date.ts#formatDate';

function sym(id: string, signature: string, behaviorNote = ''): SymbolRow {
  const [file, name] = id.split('#');
  return { id, name, file, signature, behaviorNote };
}

const SYMBOLS = new Map(
  [
    sym(FEES, 'calculateFee(amountCents: number): number', 'rounds down'),
    sym(INVOICE, 'buildInvoice(order: Order): Invoice'),
    sym(TOTAL, 'computeTotal(cart: Cart): number'),
    sym(CHECKOUT, 'checkout(cart: Cart): Receipt'),
    sym(ROUND, 'roundCents(x: number): number'),
    sym(DATE, 'formatDate(d: Date): string'),
  ].map((s) => [s.id, s]),
);
// invoice, total and checkout call fees; fees calls round.
const EDGES: EdgeRow[] = [
  { callerId: INVOICE, calleeId: FEES },
  { callerId: TOTAL, calleeId: FEES },
  { callerId: CHECKOUT, calleeId: FEES },
  { callerId: FEES, calleeId: ROUND },
];

describe('buildContext', () => {
  it('depth 0 returns only the requested symbols, with their callers and callees', () => {
    // Arrange
    const ids = [FEES];

    // Act
    const ctx = buildContext(ids, 0, SYMBOLS, EDGES);

    // Assert
    expect(ctx).toEqual([
      {
        id: FEES,
        signature: 'calculateFee(amountCents: number): number',
        behaviorNote: 'rounds down',
        callers: [INVOICE, CHECKOUT, TOTAL].sort(),
        callees: [ROUND],
      },
    ]);
  });

  it('depth 1 adds direct neighbors after the requested symbol', () => {
    // Arrange
    const ids = [FEES];

    // Act
    const ctx = buildContext(ids, 1, SYMBOLS, EDGES);

    // Assert
    expect(ctx[0].id).toBe(FEES);
    expect(ctx.map((c) => c.id).sort()).toEqual([FEES, INVOICE, TOTAL, CHECKOUT, ROUND].sort());
    expect(ctx.map((c) => c.id)).not.toContain(DATE);
  });

  it('depth 2 reaches neighbors of neighbors', () => {
    // Arrange: from checkout, fees is 1 hop and round/invoice/total are 2 hops.
    const ids = [CHECKOUT];

    // Act
    const one = buildContext(ids, 1, SYMBOLS, EDGES).map((c) => c.id);
    const two = buildContext(ids, 2, SYMBOLS, EDGES).map((c) => c.id);

    // Assert
    expect(one.sort()).toEqual([CHECKOUT, FEES].sort());
    expect(two.sort()).toEqual([CHECKOUT, FEES, INVOICE, TOTAL, ROUND].sort());
  });

  it('skips unknown ids and never repeats a symbol', () => {
    // Arrange
    const ids = ['src/nope.ts#ghost', FEES, FEES, INVOICE];

    // Act
    const ctx = buildContext(ids, 1, SYMBOLS, EDGES);

    // Assert
    const ids2 = ctx.map((c) => c.id);
    expect(ids2).not.toContain('src/nope.ts#ghost');
    expect(new Set(ids2).size).toBe(ids2.length);
    expect(ids2.slice(0, 2)).toEqual([FEES, INVOICE]);
  });

  it('attaches a file summary when one is available', () => {
    // Arrange
    const summaryFor = (file: string) => (file === 'src/billing/fees.ts' ? 'Fee helpers.' : undefined);

    // Act
    const ctx = buildContext([FEES, DATE], 0, SYMBOLS, EDGES, summaryFor);

    // Assert
    expect(ctx[0].summary).toBe('Fee helpers.');
    expect('summary' in ctx[1]).toBe(false);
  });

  it('ignores edges to symbols not in the map and dedupes repeated edges', () => {
    // Arrange
    const edges = [...EDGES, { callerId: FEES, calleeId: 'src/x.ts#gone' }, { callerId: CHECKOUT, calleeId: FEES }];

    // Act
    const ctx = buildContext([FEES], 1, SYMBOLS, edges);

    // Assert
    expect(ctx.map((c) => c.id)).not.toContain('src/x.ts#gone');
    expect(ctx[0].callers.filter((c) => c === CHECKOUT)).toHaveLength(1);
  });

  it('returns nothing for an empty request', () => {
    // Arrange / Act
    const ctx = buildContext([], 3, SYMBOLS, EDGES);

    // Assert
    expect(ctx).toEqual([]);
  });
});

describe('querySignature', () => {
  it('builds a signature when a return type is given', () => {
    // Arrange / Act / Assert
    expect(querySignature({ name: 'toDisplayDate', params: ['Date'], returns: 'string' })).toBe(
      'toDisplayDate(p0: Date): string',
    );
  });

  it('is undefined without a return type', () => {
    // Arrange / Act / Assert
    expect(querySignature({ name: 'toDisplayDate', params: ['Date'] })).toBeUndefined();
  });
});

describe('rankExisting', () => {
  const all = [...SYMBOLS.values()];

  it('scores a same-normalized-name match highest', () => {
    // Arrange
    const q = { name: 'computeFee' };

    // Act
    const [best] = rankExisting(q, all);

    // Assert
    expect(best).toEqual({ symbolId: FEES, signature: 'calculateFee(amountCents: number): number', score: SCORE_SAME_NAME });
  });

  it('finds formatDate for toDisplayDate(Date): string by types + shared token', () => {
    // Arrange
    const q = { name: 'toDisplayDate', params: ['Date'], returns: 'string' };

    // Act
    const matches = rankExisting(q, all);

    // Assert
    expect(matches[0]).toMatchObject({ symbolId: DATE, score: SCORE_SAME_TYPES });
  });

  it('gives a weak score to a shared token without matching types', () => {
    // Arrange
    const q = { name: 'parseDate', params: ['string'], returns: 'Date' };

    // Act
    const matches = rankExisting(q, all);

    // Assert
    expect(matches).toEqual([expect.objectContaining({ symbolId: DATE, score: SCORE_SHARED_TOKEN })]);
  });

  it('does not count a shared verb as a shared token', () => {
    // Arrange: "build" and "compute" are verbs; nothing else is shared.
    const q = { name: 'buildReceipt' };

    // Act
    const matches = rankExisting(q, all);

    // Assert
    expect(matches.map((m) => m.symbolId)).not.toContain(INVOICE);
  });

  it('returns nothing for a genuinely new name', () => {
    // Arrange
    const q = { name: 'renderQrCode', params: ['string'], returns: 'Buffer' };

    // Act
    const matches = rankExisting(q, all);

    // Assert
    expect(matches).toEqual([]);
  });

  it('sorts best first and respects the limit', () => {
    // Arrange: every symbol shares the token "fee" with this made-up set.
    const many = 'ABCDEFGH'.split('').map((c) => sym(`src/f${c}.ts#feeHelper${c}`, `feeHelper${c}(): void`));
    const exact = sym('src/fees.ts#getFee', 'getFee(): number');

    // Act
    const matches = rankExisting({ name: 'makeFee' }, [...many, exact], 3);

    // Assert
    expect(matches).toHaveLength(3);
    expect(matches[0]).toMatchObject({ symbolId: 'src/fees.ts#getFee', score: SCORE_SAME_NAME });
    expect(matches.slice(1).every((m) => m.score === SCORE_SHARED_TOKEN)).toBe(true);
  });
});

describe('summaryKey / estimateTokens', () => {
  it('keys by file and content hash, changing when content changes', () => {
    // Arrange
    const file = 'src/billing/fees.ts';

    // Act
    const a = summaryKey(file, 'export const x = 1;');
    const b = summaryKey(file, 'export const x = 1;');
    const c = summaryKey(file, 'export const x = 2;');

    // Assert
    expect(a).toMatch(/^src\/billing\/fees\.ts:[0-9a-f]{16}$/);
    expect(a).toBe(b);
    expect(c).not.toBe(a);
  });

  it('estimates about 4 characters per token, rounding up', () => {
    // Arrange / Act / Assert
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });
});
