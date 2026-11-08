// upsert_symbols: the code map the mapper writes (spec sections 7 and 9).
import { describe, it, expect, beforeEach } from 'vitest';
import { makeHarness, mod, all, sym, seedCodeMap, FEES, INVOICE, TOTAL, CHECKOUT, type Harness, asMapper } from './helpers';

const FILE = 'src/billing/invoice.ts';

function upsert(t: Harness, symbols: ReturnType<typeof sym>[], edges: { caller_id: string; callee_id: string }[] = []) {
  asMapper(t, (ctx) => mod.upsert_symbols(ctx, { file: FILE, symbols, edges }));
}

describe('upsert_symbols', () => {
  let t: Harness;
  beforeEach(() => {
    t = makeHarness();
  });

  it('inserts new symbols at version 1 with the file set', () => {
    // Arrange
    const symbols = [sym(INVOICE), sym(TOTAL)];

    // Act
    upsert(t, symbols);

    // Assert
    const rows = all(t.db.symbol.iter());
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.file).toBe(FILE);
      expect(r.version).toBe(1);
      expect(r.updated_at.microsSinceUnixEpoch).toBe(t.now());
    }
    expect(t.db.symbol.id.find(INVOICE)!.name).toBe('buildInvoice');
  });

  it('keeps the version when the signature hash is unchanged', () => {
    // Arrange
    upsert(t, [sym(INVOICE, 'buildInvoice()', 'h1')]);
    t.advance(1);

    // Act
    upsert(t, [sym(INVOICE, 'buildInvoice()', 'h1')]);

    // Assert
    const row = t.db.symbol.id.find(INVOICE)!;
    expect(row.version).toBe(1);
    expect(row.updated_at.microsSinceUnixEpoch).toBe(t.now());
  });

  it('keeps the stored behavior_note, even when the hash changes', () => {
    // Arrange
    upsert(t, [sym(INVOICE, 'buildInvoice()', 'h1')]);
    t.internal((ctx) => {
      const r = ctx.db.symbol.id.find(INVOICE)!;
      ctx.db.symbol.id.update({ ...r, behavior_note: 'rounds half-up now' }); // as report_change('behavior') would
    });

    // Act
    upsert(t, [{ ...sym(INVOICE, 'buildInvoice()', 'h1'), behavior_note: '' }]);
    const sameHash = t.db.symbol.id.find(INVOICE)!.behavior_note;
    upsert(t, [{ ...sym(INVOICE, 'buildInvoice(order)', 'h2'), behavior_note: '' }]);

    // Assert
    expect(sameHash).toBe('rounds half-up now');
    expect(t.db.symbol.id.find(INVOICE)!.behavior_note).toBe('rounds half-up now');
  });

  it("keeps an agent's reported signature while the hash is unchanged, and takes the mapper's once it moves", () => {
    // Arrange
    upsert(t, [sym(INVOICE, 'buildInvoice(order)', 'h1')]);
    t.internal((ctx) => {
      const r = ctx.db.symbol.id.find(INVOICE)!;
      ctx.db.symbol.id.update({ ...r, signature: 'buildInvoice(order, lateFee)', version: r.version + 1 }); // as report_change('signature') would
    });

    // Act: a stale mapper push (the agent's edit hasn't reached the mapper's checkout)
    upsert(t, [sym(INVOICE, 'buildInvoice(order)', 'h1')]);
    const stale = t.db.symbol.id.find(INVOICE)!;
    // Act: the change lands, so the mapper's hash moves
    upsert(t, [sym(INVOICE, 'buildInvoice(order, lateFee)', 'h2')]);
    const landed = t.db.symbol.id.find(INVOICE)!;

    // Assert
    expect(stale.signature).toBe('buildInvoice(order, lateFee)');
    expect(stale.version).toBe(2);
    expect(landed.signature).toBe('buildInvoice(order, lateFee)');
    expect(landed.signature_hash).toBe('h2');
    expect(landed.version).toBe(3);
  });

  it('bumps the version when the signature hash changes', () => {
    // Arrange
    upsert(t, [sym(INVOICE, 'buildInvoice(order)', 'h1')]);

    // Act
    upsert(t, [sym(INVOICE, 'buildInvoice(order, lateFee)', 'h2')]);
    upsert(t, [sym(INVOICE, 'buildInvoice(order, lateFee, dueDate)', 'h3')]);

    // Assert
    const row = t.db.symbol.id.find(INVOICE)!;
    expect(row.version).toBe(3);
    expect(row.signature).toBe('buildInvoice(order, lateFee, dueDate)');
  });

  it("deletes symbols that disappeared from the file, and only that file's", () => {
    // Arrange
    seedCodeMap(t);

    // Act
    upsert(t, [sym(INVOICE)]); // computeTotal was removed from invoice.ts

    // Assert
    expect(t.db.symbol.id.find(TOTAL)).toBeNull();
    expect(t.db.symbol.id.find(INVOICE)).not.toBeNull();
    expect(t.db.symbol.id.find(FEES)).not.toBeNull();
    expect(t.db.symbol.id.find(CHECKOUT)).not.toBeNull();
  });

  it("replaces the file's outgoing edges and leaves other files' edges", () => {
    // Arrange
    seedCodeMap(t);
    const NEW = 'src/billing/fees.ts#roundHalfUp';

    // Act
    upsert(t, [sym(INVOICE), sym(TOTAL)], [{ caller_id: INVOICE, callee_id: NEW }]);

    // Assert
    const edges = all(t.db.symbolEdge.iter()).map((e) => `${e.caller_id}->${e.callee_id}`);
    expect(edges).toContain(`${INVOICE}->${NEW}`);
    expect(edges).toContain(`${CHECKOUT}->${FEES}`); // checkout.ts untouched
    expect(edges).not.toContain(`${INVOICE}->${FEES}`);
    expect(edges).not.toContain(`${TOTAL}->${FEES}`);
    expect(edges).toHaveLength(2);
  });

  it('is idempotent: re-running the same upsert gives the same rows', () => {
    // Arrange
    seedCodeMap(t);
    const before = all(t.db.symbolEdge.iter()).length;

    // Act
    seedCodeMap(t);

    // Assert
    expect(all(t.db.symbol.iter())).toHaveLength(4);
    expect(all(t.db.symbolEdge.iter())).toHaveLength(before);
    expect(all(t.db.symbol.iter()).every((s) => s.version === 1)).toBe(true);
  });

  it('accepts every symbol kind from the spec', () => {
    // Arrange
    const kinds = ['function', 'class', 'method', 'const'];
    const symbols = kinds.map((kind, i) => ({ ...sym(`${FILE}#s${i}`), kind }));

    // Act
    upsert(t, symbols);

    // Assert
    expect(all(t.db.symbol.iter()).map((s) => s.kind).sort()).toEqual([...kinds].sort());
  });

  it('rejects an unknown kind and rolls back the whole file', () => {
    // Arrange
    upsert(t, [sym(INVOICE)]);

    // Act
    const act = () => upsert(t, [sym(TOTAL), { ...sym(`${FILE}#x`), kind: 'interface' }]);

    // Assert
    expect(act).toThrow(/invalid symbol kind 'interface'/);
    expect(t.db.symbol.id.find(INVOICE)).not.toBeNull(); // the delete was rolled back
    expect(t.db.symbol.id.find(TOTAL)).toBeNull();
  });

  it('handles a symbol listed twice in one call', () => {
    // Arrange
    const dup = [sym(INVOICE, 'a', 'h1'), sym(INVOICE, 'b', 'h2')];

    // Act
    upsert(t, dup);

    // Assert
    const rows = all(t.db.symbol.iter());
    expect(rows).toHaveLength(1);
    expect(rows[0].signature).toBe('b');
  });

  it('an empty file clears its symbols and edges', () => {
    // Arrange
    seedCodeMap(t);

    // Act
    upsert(t, []);

    // Assert
    expect(all(t.db.symbol.file.filter(FILE))).toHaveLength(0);
    expect(all(t.db.symbolEdge.caller_id.filter(INVOICE))).toHaveLength(0);
    expect(all(t.db.symbolEdge.iter())).toHaveLength(1); // checkout -> fees
  });
});
