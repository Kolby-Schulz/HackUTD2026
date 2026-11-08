import { cpSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { duplicateReason, parseSignature } from '@contract/server/rules';
import {
  createRepoMapper,
  isMappable,
  isSourceFile,
  listMappableFiles,
  mapFile,
  mapFileAsync,
  mapPolyFile,
  PolyglotMapper,
  symbolRangesAsync,
  symbolsTouched,
  type FileMap,
} from '../src/index.ts';

const FIXTURE = fileURLToPath(new URL('./fixtures/poly', import.meta.url));
const TS_FIXTURE = fileURLToPath(new URL('./fixtures/repo', import.meta.url));

const kindsAndIds = (m: FileMap | undefined) => (m?.symbols ?? []).map((s) => `${s.kind} ${s.id}`);
const edges = (maps: FileMap[]) => maps.flatMap((m) => m.edges.map((e) => `${e.callerId} -> ${e.calleeId}`)).sort();

describe('polyglot symbols', () => {
  let maps: FileMap[];
  let byFile: Map<string, FileMap>;
  let sig: (id: string) => string | undefined;
  beforeAll(async () => {
    maps = (await PolyglotMapper.create(FIXTURE)).mapAll();
    byFile = new Map(maps.map((m) => [m.file, m]));
    sig = (id) => maps.flatMap((m) => m.symbols).find((s) => s.id === id)?.signature;
  });

  it('maps every bundled language and skips their test files', () => {
    expect(maps.map((m) => m.file)).toEqual([
      'billing/discount.py',
      'billing/fees.py',
      'pkg/fees/fees.go',
      'src/Billing.cs',
      'src/Billing.java',
      'src/Billing.php',
      'src/billing.rb',
      'src/fees.cpp',
      'src/fees.h',
      'src/lib.rs',
      'src/util.c',
    ]);
  });

  it('Python: public functions, classes, methods, UPPER constants', () => {
    expect(kindsAndIds(byFile.get('billing/fees.py'))).toEqual([
      'const billing/fees.py#FEE_RATE',
      'const billing/fees.py#MAX_ITEMS',
      'function billing/fees.py#calculate_fee',
      'function billing/fees.py#format_total',
      'class billing/fees.py#Invoice',
      'method billing/fees.py#Invoice.total',
      'method billing/fees.py#Invoice.parse',
    ]);
    expect(sig('billing/fees.py#calculate_fee')).toBe('calculate_fee(amount: int, rate: float): int');
    expect(sig('billing/fees.py#format_total')).toBe('format_total(total, *items, currency, **extra)');
    expect(sig('billing/fees.py#Invoice')).toBe('class Invoice(Base); __init__(amount: int, lines: list[str])');
    expect(sig('billing/fees.py#Invoice.total')).toBe('total(): int'); // self dropped
    expect(sig('billing/fees.py#Invoice.parse')).toBe('static parse(text: str): Invoice'); // forward-ref quotes dropped
    expect(sig('billing/fees.py#FEE_RATE')).toBe('const FEE_RATE: float = 0.03');
  });

  it('Go: Capitalized names only, receivers become methods', () => {
    expect(kindsAndIds(byFile.get('pkg/fees/fees.go'))).toEqual([
      'const pkg/fees/fees.go#FeeRate',
      'const pkg/fees/fees.go#MaxItems',
      'class pkg/fees/fees.go#Invoice',
      'class pkg/fees/fees.go#Payer',
      'function pkg/fees/fees.go#CalculateFee',
      'method pkg/fees/fees.go#Invoice.Total',
      'function pkg/fees/fees.go#Sum',
    ]);
    expect(sig('pkg/fees/fees.go#CalculateFee')).toBe('CalculateFee(amount: int, rate: float64): int');
    expect(sig('pkg/fees/fees.go#Sum')).toBe('Sum(values: ...int): int');
    expect(sig('pkg/fees/fees.go#MaxItems')).toBe('const MaxItems: int = 50');
  });

  it('Java and C#: public types and public methods, constructors in the class signature', () => {
    expect(kindsAndIds(byFile.get('src/Billing.java'))).toEqual([
      'class src/Billing.java#Billing',
      'method src/Billing.java#Billing.calculateFee',
      'method src/Billing.java#Billing.format',
    ]);
    expect(sig('src/Billing.java#Billing')).toBe('class Billing; constructor(rate: int)');
    expect(sig('src/Billing.java#Billing.format')).toBe('format(lines: List<String>, rest: String...): String');
    expect(kindsAndIds(byFile.get('src/Billing.cs'))).toEqual([
      'class src/Billing.cs#Invoice',
      'method src/Billing.cs#Invoice.Total',
      'class src/Billing.cs#Fees',
      'method src/Billing.cs#Fees.CalculateFee',
      'class src/Billing.cs#IPayer',
    ]);
    expect(sig('src/Billing.cs#Fees.CalculateFee')).toBe('static CalculateFee(amount: int, rate: double): int');
  });

  it('Rust: pub items, impl methods (pub or via a trait), no test modules', () => {
    expect(kindsAndIds(byFile.get('src/lib.rs'))).toEqual([
      'const src/lib.rs#FEE_RATE',
      'class src/lib.rs#Invoice',
      'class src/lib.rs#Status',
      'class src/lib.rs#Payer',
      'method src/lib.rs#Invoice.new',
      'method src/lib.rs#Invoice.total',
      'method src/lib.rs#Invoice.pay',
      'function src/lib.rs#calculate_fee',
    ]);
    expect(sig('src/lib.rs#Invoice.total')).toBe('total(): u64'); // &self dropped
  });

  it('Ruby, PHP: modules are classes, initialize/__construct go in the class signature', () => {
    expect(kindsAndIds(byFile.get('src/billing.rb'))).toEqual([
      'const src/billing.rb#FEE_RATE',
      'function src/billing.rb#calculate_fee',
      'class src/billing.rb#Billing',
      'class src/billing.rb#Invoice',
      'method src/billing.rb#Invoice.total',
      'method src/billing.rb#Invoice.parse',
    ]);
    expect(sig('src/billing.rb#Invoice')).toBe('class Invoice extends Base; initialize(amount)');
    expect(kindsAndIds(byFile.get('src/Billing.php'))).toEqual([
      'const src/Billing.php#FEE_RATE',
      'function src/Billing.php#calculate_fee',
      'class src/Billing.php#Invoice',
      'method src/Billing.php#Invoice.total',
      'method src/Billing.php#Invoice.parse',
    ]);
    expect(sig('src/Billing.php#calculate_fee')).toBe('calculate_fee(amount: int, rate: float): int');
  });

  it('C/C++: definitions only (no prototypes), out-of-class methods by their scope', () => {
    expect(kindsAndIds(byFile.get('src/fees.cpp'))).toEqual([
      'function src/fees.cpp#calculate_fee',
      'function src/fees.cpp#helper',
      'method src/fees.cpp#Invoice.total',
    ]);
    expect(kindsAndIds(byFile.get('src/fees.h'))).toEqual([
      'class src/fees.h#Point',
      'class src/fees.h#Invoice',
      'method src/fees.h#Invoice.tax',
    ]);
    expect(sig('src/util.c#label')).toBe('label(name: const char *, out: int *): const char *');
  });

  it('kinds stay within what the server accepts', () => {
    const kinds = new Set(maps.flatMap((m) => m.symbols.map((s) => s.kind)));
    for (const k of kinds) expect(['function', 'class', 'method', 'const']).toContain(k);
  });

  it('name-based edges: same file first, else a unique name in the same language', () => {
    expect(edges(maps)).toEqual([
      'billing/fees.py#Invoice.parse -> billing/fees.py#Invoice',
      'billing/fees.py#Invoice.total -> billing/fees.py#calculate_fee',
      'billing/fees.py#format_total -> billing/discount.py#apply_discount',
      'pkg/fees/fees.go#Invoice.Total -> pkg/fees/fees.go#CalculateFee',
      'src/Billing.cs#Invoice.Total -> src/Billing.cs#Fees.CalculateFee',
      'src/Billing.php#Invoice.parse -> src/Billing.php#Invoice',
      'src/Billing.php#Invoice.total -> src/Billing.php#calculate_fee',
      'src/billing.rb#Invoice.parse -> src/billing.rb#Invoice',
      'src/billing.rb#Invoice.total -> src/billing.rb#calculate_fee',
      'src/fees.cpp#Invoice.total -> src/fees.cpp#calculate_fee',
      'src/fees.cpp#calculate_fee -> src/fees.cpp#helper',
      'src/lib.rs#Invoice.new -> src/lib.rs#Invoice',
      'src/lib.rs#Invoice.total -> src/lib.rs#calculate_fee',
    ]);
  });
});

describe('signatures work with Rule 2 unchanged', () => {
  it('parseSignature reads the canonical shape', () => {
    expect(parseSignature('calculate_fee(amount: int, rate: float): int')).toEqual({ params: ['int', 'float'], returns: 'int' });
    expect(parseSignature('Fee(a: int): int')).toEqual({ params: ['int'], returns: 'int' });
    expect(parseSignature('format(lines: List<String>, rest: String...): String')).toEqual({
      params: ['List<String>', 'String...'],
      returns: 'String',
    });
    expect(parseSignature('calculate_fee(amount, rate)')).toBeUndefined(); // no return type
  });

  it('a Python helper duplicates a TS helper of the same name', async () => {
    const [py] = await mapPolyFile('app/fees.py', 'def calculate_fee(amount: int) -> int:\n    return amount\n');
    const ts = mapFile(join(TS_FIXTURE, 'src/billing/fees.ts'), { repoDir: TS_FIXTURE, edges: false }).symbols.find(
      (s) => s.name === 'calculateFee',
    )!;
    expect(duplicateReason(py, ts)).toMatch(/same normalized name 'fee'/);
  });

  it('same types plus a shared name token count, as in TS', async () => {
    const syms = await mapPolyFile(
      'app/dates.py',
      'def format_date(d: date) -> str:\n    return ""\n\ndef date_to_string(d: date) -> str:\n    return ""\n',
    );
    expect(duplicateReason(syms[0], syms[1])).toMatch(/same types/);
  });

  it('formatting does not change the hash; a type change does', async () => {
    const a = (await mapPolyFile('x.go', 'package x\nfunc Fee(a int) int { return a }\n'))[0];
    const b = (await mapPolyFile('x.go', 'package x\nfunc Fee(\n\ta   int,\n) int {\n\treturn a\n}\n'))[0];
    const c = (await mapPolyFile('x.go', 'package x\nfunc Fee(a int64) int { return 0 }\n'))[0];
    expect(b.signatureHash).toBe(a.signatureHash);
    expect(c.signatureHash).not.toBe(a.signatureHash);
  });
});

describe('ranges', () => {
  const src = [
    'import x', // 1
    '', // 2
    '# Fee for one amount.', // 3
    'def calculate_fee(amount: int) -> int:', // 4
    '    return amount', // 5
    '', // 6
    '@dataclass', // 7
    'class Invoice:', // 8
    '    def total(self) -> int:', // 9
    '        return 1', // 10
    '', // 11
    '    rate = 2', // 12
  ].join('\n');

  it('spans include comments and decorators above', async () => {
    expect(await symbolRangesAsync('app/fees.py', src)).toEqual([
      { id: 'app/fees.py#calculate_fee', kind: 'function', startLine: 3, endLine: 5 },
      { id: 'app/fees.py#Invoice', kind: 'class', startLine: 7, endLine: 12 },
      { id: 'app/fees.py#Invoice.total', kind: 'method', startLine: 9, endLine: 10 },
    ]);
  });

  it('symbolsTouched picks the method over its class, the class outside methods', async () => {
    const ranges = await symbolRangesAsync('app/fees.py', src);
    expect(symbolsTouched(ranges, [10])).toEqual(['app/fees.py#Invoice.total']);
    expect(symbolsTouched(ranges, [12])).toEqual(['app/fees.py#Invoice']);
    expect(symbolsTouched(ranges, [1])).toEqual([]);
  });

  it('Rust attributes and doc comments count as part of the item', async () => {
    const ranges = await symbolRangesAsync('src/lib.rs', '/// Doc.\n#[derive(Debug)]\npub struct A {\n    x: u8,\n}\n');
    expect(ranges).toEqual([{ id: 'src/lib.rs#A', kind: 'class', startLine: 1, endLine: 5 }]);
  });

  it('test files and unknown files have no ranges', async () => {
    expect(await symbolRangesAsync('app/test_fees.py', src)).toEqual([]);
    expect(await symbolRangesAsync('README.md', src)).toEqual([]);
  });
});

describe('async API', () => {
  it('mapFileAsync delegates TS/JS to the sync mapper', async () => {
    const path = join(TS_FIXTURE, 'src/billing/fees.ts');
    expect(await mapFileAsync(path, { repoDir: TS_FIXTURE, edges: false })).toEqual(mapFile(path, { repoDir: TS_FIXTURE, edges: false }));
  });

  it('mapFileAsync maps other languages, with or without edges', async () => {
    const fast = await mapFileAsync('billing/fees.py', { repoDir: FIXTURE, edges: false });
    expect(fast.symbols.map((s) => s.name)).toContain('calculate_fee');
    expect(fast.edges).toEqual([]);
    const full = await mapFileAsync('billing/fees.py', { repoDir: FIXTURE });
    expect(full.edges).toContainEqual({ callerId: 'billing/fees.py#format_total', calleeId: 'billing/discount.py#apply_discount' });
  });
});

describe('file discovery', () => {
  it('isMappable covers every language, without tests or dependency folders', () => {
    for (const p of ['app/fees.py', 'pkg/x.go', 'src/main/java/A.java', 'src/lib.rs', 'lib/a.rb', 'src/A.php', 'A.cs', 'a.c', 'a.hpp', 'src/a.ts']) {
      expect(isMappable(p), p).toBe(true);
    }
    for (const p of [
      'app/test_fees.py',
      'app/fees_test.py',
      'conftest.py',
      'pkg/x_test.go',
      'src/test/java/ATest.java',
      'ATests.cs',
      'spec/a_spec.rb',
      'vendor/github.com/x/y.go',
      'target/debug/build.rs',
      'venv/lib/site.py',
      '__pycache__/a.py',
      'obj/A.cs',
      'tests/test_a.py',
      'README.md',
    ]) {
      expect(isMappable(p), p).toBe(false);
    }
  });

  it('isSourceFile is the extension check only', () => {
    expect(isSourceFile('tests/test_a.py')).toBe(true);
    expect(isSourceFile('a.go')).toBe(true);
    expect(isSourceFile('a.ts')).toBe(true);
    expect(isSourceFile('a.d.ts')).toBe(false);
    expect(isSourceFile('a.min.js')).toBe(false);
    expect(isSourceFile('a.md')).toBe(false);
  });

  it('listMappableFiles finds both groups', () => {
    expect(listMappableFiles(FIXTURE)).toContain('billing/fees.py');
    expect(listMappableFiles(FIXTURE)).not.toContain('billing/test_fees.py');
  });
});

describe('createRepoMapper (mixed repo, watch-mode surface)', () => {
  let work: string;
  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 'mapper-poly-'));
    mkdirSync(join(work, 'web'));
    cpSync(join(FIXTURE, 'billing'), join(work, 'billing'), { recursive: true });
    writeFileSync(join(work, 'web/fee.ts'), 'export function feeLabel(n: number): string {\n  return String(n);\n}\n');
  });
  afterEach(() => rmSync(work, { recursive: true, force: true }));

  it('maps TS and Python files together', async () => {
    const m = await createRepoMapper(work);
    expect(m.files()).toEqual(['billing/discount.py', 'billing/fees.py', 'web/fee.ts']);
    expect(m.mapFile('web/fee.ts').symbols.map((s) => s.id)).toEqual(['web/fee.ts#feeLabel']);
    expect(m.mapAll().map((f) => f.file)).toEqual(m.files());
  });

  it('refresh and dependents follow renames, new files and deletes', async () => {
    const m = await createRepoMapper(work);
    expect(m.dependents('billing/discount.py')).toEqual(['billing/fees.py']);

    writeFileSync(join(work, 'billing/discount.py'), 'def apply_discount(total: int, pct: int) -> int:\n    return total\n');
    expect(await m.refresh('billing/discount.py')).toBe(true);
    expect(m.mapFile('billing/discount.py').symbols[0].signature).toBe('apply_discount(total: int, pct: int): int');

    writeFileSync(join(work, 'billing/tax.py'), 'def tax() -> int:\n    return apply_discount(1, 2)\n');
    await m.refresh('billing/tax.py');
    expect(m.mapFile('billing/tax.py').edges).toEqual([{ callerId: 'billing/tax.py#tax', calleeId: 'billing/discount.py#apply_discount' }]);
    expect(m.dependents('billing/discount.py')).toEqual(['billing/fees.py', 'billing/tax.py']);

    const before = m.dependents('billing/discount.py');
    unlinkSync(join(work, 'billing/discount.py'));
    await m.refresh('billing/discount.py');
    expect(before).toContain('billing/tax.py');
    expect(m.files()).not.toContain('billing/discount.py');
    expect(m.mapFile('billing/tax.py').edges).toEqual([]);
    expect(await m.refresh('README.md')).toBe(false);
  });
});
