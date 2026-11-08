// Pure Rule 2 helpers (src/rules.ts).
import { describe, it, expect } from 'vitest';
import { nameOf, nameTokens, normalizeName, parseSignature, duplicateReason } from '../src/rules';

describe('nameOf', () => {
  it.each([
    ['src/utils/date.ts#formatDate', 'formatDate'],
    ['src/models.ts#Invoice.total', 'total'],
    ['plainName', 'plainName'],
  ])('%s -> %s', (id, expected) => {
    // Arrange / Act
    const name = nameOf(id);

    // Assert
    expect(name).toBe(expected);
  });
});

describe('nameTokens', () => {
  it.each([
    ['toDisplayDate', ['to', 'display', 'date']],
    ['date_to_string', ['date', 'to', 'string']],
    ['format-date', ['format', 'date']],
    ['parseHTTPResponse', ['parse', 'http', 'response']],
    ['calculateFee', ['calculate', 'fee']],
    ['fee2Cents', ['fee2', 'cents']],
  ])('%s', (name, expected) => {
    // Arrange / Act
    const tokens = nameTokens(name);

    // Assert
    expect(tokens).toEqual(expected);
  });
});

describe('normalizeName', () => {
  it.each([
    ['getInvoice', 'invoice'],
    ['makeInvoice', 'invoice'],
    ['make_invoice', 'invoice'],
    ['calculateFee', 'fee'],
    ['computeFee', 'fee'],
    ['formatDate', 'formatdate'],
    ['toDisplayDate', 'displaydate'],
    ['get', ''],
  ])('%s -> %s', (name, expected) => {
    // Arrange / Act
    const n = normalizeName(name);

    // Assert
    expect(n).toBe(expected);
  });
});

describe('parseSignature', () => {
  it('reads parameter types and return type', () => {
    // Arrange
    const sig = 'formatDate(d: Date, opts?: FormatOpts): string';

    // Act
    const parsed = parseSignature(sig);

    // Assert
    expect(parsed).toEqual({ params: ['Date', 'FormatOpts'], returns: 'string' });
  });

  it('keeps nested generics and function types intact', () => {
    // Arrange
    const sig = 'group(items: Map<string, number[]>, by: (x: number) => string): Record<string, number>';

    // Act
    const parsed = parseSignature(sig);

    // Assert
    expect(parsed).toEqual({
      params: ['Map<string,number[]>', '(x:number)=>string'],
      returns: 'Record<string,number>',
    });
  });

  it('drops default values and ignores whitespace differences', () => {
    // Arrange
    const sig = 'round( cents : number = 0 ) :  number';

    // Act
    const parsed = parseSignature(sig);

    // Assert
    expect(parsed).toEqual({ params: ['number'], returns: 'number' });
  });

  it('handles no parameters', () => {
    // Arrange / Act / Assert
    expect(parseSignature('now(): Date')).toEqual({ params: [], returns: 'Date' });
  });

  it.each(['calculateFee', 'calculateFee(amount: number)', 'broken(a: number', ''])(
    'returns undefined for %j',
    (sig) => {
      // Arrange / Act
      const parsed = parseSignature(sig);

      // Assert
      expect(parsed).toBeUndefined();
    },
  );
});

describe('duplicateReason', () => {
  it('matches the same normalized name without signatures', () => {
    // Arrange
    const a = { name: 'getInvoice' };
    const b = { name: 'makeInvoice' };

    // Act
    const reason = duplicateReason(a, b);

    // Assert
    expect(reason).toBe("same normalized name 'invoice'");
  });

  it('matches same types plus a shared token (spec example formatDate vs dateToString)', () => {
    // Arrange
    const a = { name: 'formatDate', signature: 'formatDate(d: Date): string' };
    const b = { name: 'dateToString', signature: 'dateToString(date: Date): string' };

    // Act
    const reason = duplicateReason(a, b);

    // Assert
    expect(reason).toBe("same types (Date) => string and shared name 'date'");
  });

  it('matches the demo pair formatDate vs toDisplayDate when both signatures are known', () => {
    // Arrange
    const a = { name: 'formatDate', signature: 'formatDate(d: Date): string' };
    const b = { name: 'toDisplayDate', signature: 'toDisplayDate(value: Date): string' };

    // Act
    const reason = duplicateReason(a, b);

    // Assert
    expect(reason).toMatch(/shared name 'date'/);
  });

  it('does not match same types without a shared name token', () => {
    // Arrange
    const a = { name: 'formatDate', signature: 'formatDate(d: Date): string' };
    const b = { name: 'describeOrder', signature: 'describeOrder(d: Date): string' };

    // Act
    const reason = duplicateReason(a, b);

    // Assert
    expect(reason).toBeUndefined();
  });

  it('does not match a shared token with different types', () => {
    // Arrange
    const a = { name: 'formatDate', signature: 'formatDate(d: Date): string' };
    const b = { name: 'parseDate', signature: 'parseDate(s: string): Date' };

    // Act
    const reason = duplicateReason(a, b);

    // Assert
    expect(reason).toBeUndefined();
  });

  it('does not match on types when one signature is missing', () => {
    // Arrange
    const a = { name: 'formatDate' };
    const b = { name: 'dateToString', signature: 'dateToString(date: Date): string' };

    // Act
    const reason = duplicateReason(a, b);

    // Assert
    expect(reason).toBeUndefined();
  });

  it('never matches two verb-only names on the empty string', () => {
    // Arrange
    const a = { name: 'get' };
    const b = { name: 'make' };

    // Act
    const reason = duplicateReason(a, b);

    // Assert
    expect(reason).toBeUndefined();
  });

  it('does not treat a shared verb as a shared token', () => {
    // Arrange
    const a = { name: 'getFee', signature: 'getFee(x: number): number' };
    const b = { name: 'getTax', signature: 'getTax(x: number): number' };

    // Act
    const reason = duplicateReason(a, b);

    // Assert
    expect(reason).toBeUndefined();
  });
});
