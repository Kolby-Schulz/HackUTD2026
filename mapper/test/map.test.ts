import { cpSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { duplicateReason, parseSignature } from '@contract/server/rules';
import { checkFileCount, isMappable, mapFile, maxFiles, readMapPolicy, RepoMapper, setMapPolicy, signatureHash, useMapPolicy, type FileMap } from '../src/index.ts';

const FIXTURE = fileURLToPath(new URL('./fixtures/repo', import.meta.url));

const byFile = (maps: FileMap[]) => new Map(maps.map((m) => [m.file, m]));
const allSymbols = (maps: FileMap[]) => maps.flatMap((m) => m.symbols);
const sig = (maps: FileMap[], id: string) => allSymbols(maps).find((s) => s.id === id)?.signature;
const edgeList = (maps: FileMap[]) => maps.flatMap((m) => m.edges.map((e) => `${e.callerId} -> ${e.calleeId}`)).sort();

describe('symbols', () => {
  const maps = new RepoMapper(FIXTURE).mapAll();

  it('maps source files only: no tests, no .d.ts', () => {
    expect(maps.map((m) => m.file)).toEqual([
      'src/billing/fees.ts',
      'src/billing/index.ts',
      'src/billing/invoice.ts',
      'src/checkout.ts',
      'src/models.ts',
      'src/util/format.ts',
    ]);
  });

  it('records exported functions, classes, methods and consts with spec ids and kinds', () => {
    expect(allSymbols(maps).map((s) => `${s.kind} ${s.id}`)).toEqual([
      'function src/billing/fees.ts#calculateFee',
      'function src/billing/fees.ts#feeLabel',
      'class src/billing/invoice.ts#Document',
      'class src/billing/invoice.ts#Invoice',
      'method src/billing/invoice.ts#Invoice.title',
      'method src/billing/invoice.ts#Invoice.total',
      'method src/billing/invoice.ts#Invoice.render',
      'method src/billing/invoice.ts#Invoice.empty',
      'function src/billing/invoice.ts#buildInvoice',
      'function src/checkout.ts#checkoutTotal',
      'function src/checkout.ts#summary',
      'const src/checkout.ts#handlers',
      'const src/models.ts#FEE_RATE',
      'const src/models.ts#DEFAULT_CURRENCY',
      'const src/models.ts#LIMITS',
      'const src/models.ts#TAX_RATE', // exported through an export list
      'function src/util/format.ts#formatMoney',
      'function src/util/format.ts#formatLines',
      'function src/util/format.ts#loadRate',
      'function src/util/format.ts#localHelper',
      'function src/util/format.ts#default',
    ]);
  });

  it('skips non-exported functions, let, interfaces, types, getters and #private members', () => {
    const ids = allSymbols(maps).map((s) => s.id);
    for (const missing of ['roundDown', 'counter', 'mutable', 'LineItem', 'Currency', 'Totals', 'count', 'hidden', 'secret']) {
      expect(ids.some((id) => id.endsWith(`#${missing}`) || id.endsWith(`.${missing}`) || id.includes('#Invoice.#'))).toBe(false);
    }
  });

  it('method rows use the bare method name (what Rule 2 compares)', () => {
    const total = allSymbols(maps).find((s) => s.id === 'src/billing/invoice.ts#Invoice.total');
    expect(total?.name).toBe('total');
  });

  it('behaviorNote is always empty from the mapper', () => {
    expect(allSymbols(maps).every((s) => s.behaviorNote === '')).toBe(true);
  });
});

describe('signatures', () => {
  const maps = new RepoMapper(FIXTURE).mapAll();

  it('are the declaration as written, body removed, comments and line breaks collapsed', () => {
    expect(sig(maps, 'src/billing/fees.ts#calculateFee')).toBe('calculateFee(amount: number, rate: number = FEE_RATE): number');
    expect(sig(maps, 'src/util/format.ts#formatMoney')).toBe('formatMoney(n: number): string');
    expect(sig(maps, 'src/util/format.ts#formatLines')).toBe('formatLines(lines: number[]): string[]');
    expect(sig(maps, 'src/checkout.ts#checkoutTotal')).toBe(
      'checkoutTotal(items: { sku: string; price: number; qty: number }[]): number',
    );
  });

  it('cover overloads, async, static, arrow properties, classes and consts', () => {
    expect(sig(maps, 'src/billing/fees.ts#feeLabel')).toBe(
      'feeLabel(amount: number): string; feeLabel(amount: number, currency: string): string',
    );
    expect(sig(maps, 'src/util/format.ts#loadRate')).toBe('async loadRate(): Promise<number>');
    expect(sig(maps, 'src/billing/invoice.ts#Invoice.empty')).toBe('static empty(): Invoice');
    expect(sig(maps, 'src/billing/invoice.ts#Invoice.render')).toBe('render(): string');
    expect(sig(maps, 'src/billing/invoice.ts#Invoice')).toBe(
      'class Invoice extends Document implements Totals; constructor(private readonly items: LineItem[])',
    );
    expect(sig(maps, 'src/billing/invoice.ts#Document')).toBe('abstract class Document');
    expect(sig(maps, 'src/models.ts#FEE_RATE')).toBe('const FEE_RATE = 0.03');
    expect(sig(maps, 'src/models.ts#DEFAULT_CURRENCY')).toBe("const DEFAULT_CURRENCY: Currency = 'USD'");
    expect(sig(maps, 'src/models.ts#LIMITS')).toBe('const LIMITS');
  });

  it('leave out a return type that is not written (nothing is inferred)', () => {
    expect(sig(maps, 'src/checkout.ts#summary')).toBe('summary(amounts: number[])');
  });

  it('parse with the server Rule 2 parser, so type matching works on mapped symbols', () => {
    expect(parseSignature(sig(maps, 'src/billing/fees.ts#calculateFee')!)).toEqual({
      params: ['number', 'number'],
      returns: 'number',
    });
    expect(parseSignature(sig(maps, 'src/util/format.ts#loadRate')!)).toEqual({ params: [], returns: 'Promise<number>' });
    expect(parseSignature(sig(maps, 'src/billing/invoice.ts#Invoice.total')!)).toEqual({ params: [], returns: 'number' });
    // Classes and consts must not be mistaken for functions.
    expect(parseSignature(sig(maps, 'src/billing/invoice.ts#Invoice')!)).toBeUndefined();
    expect(parseSignature(sig(maps, 'src/models.ts#FEE_RATE')!)).toBeUndefined();
    // The spec's duplicate example, with a mapped existing helper.
    expect(duplicateReason({ name: 'toDisplayMoney', signature: 'toDisplayMoney(x: number): string' }, {
      name: 'formatMoney',
      signature: sig(maps, 'src/util/format.ts#formatMoney'),
    })).toMatch(/shared name 'money'/);
  });
});

describe('signatureHash', () => {
  const base = 'calculateFee(amount: number, rate: number): number';

  it('ignores formatting: line breaks, spacing, trailing commas, comments', () => {
    for (const same of [
      'calculateFee(\n  amount: number,\n  rate: number,\n): number',
      'calculateFee(amount:number,rate:number):number',
      'calculateFee(amount: number /* cents */, rate: number): number',
      'calculateFee(amount: number, // pre-tax\n rate: number): number',
    ]) {
      expect(signatureHash(same)).toBe(signatureHash(base));
    }
    expect(signatureHash('f(a: { x: number; }): void')).toBe(signatureHash('f(a: { x: number }): void'));
  });

  it('changes when the interface changes', () => {
    for (const different of [
      'calculateFee(amount: number, rate: string): number',
      'calculateFee(amount: number): number',
      'calculateFee(amount: number, rate: number): string',
      'calculateFee(amount: number, rate?: number): number',
      'async calculateFee(amount: number, rate: number): number',
    ]) {
      expect(signatureHash(different)).not.toBe(signatureHash(base));
    }
  });

  it('does not treat // inside a string literal as a comment', () => {
    expect(signatureHash("f(url = 'http://a'): void")).not.toBe(signatureHash("f(url = 'http://b'): void"));
  });

  it('is 16 hex chars', () => {
    expect(signatureHash(base)).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('edges', () => {
  const maps = new RepoMapper(FIXTURE).mapAll();

  it('resolve calls, new, methods, callbacks and const reads through imports, aliases, barrels and namespaces', () => {
    expect(edgeList(maps)).toEqual(
      [
        'src/billing/fees.ts#calculateFee -> src/models.ts#FEE_RATE', // default value
        'src/billing/fees.ts#feeLabel -> src/billing/fees.ts#calculateFee', // same file
        'src/billing/invoice.ts#Invoice -> src/billing/fees.ts#calculateFee', // in the constructor
        'src/billing/invoice.ts#Invoice -> src/billing/invoice.ts#Document', // extends
        'src/billing/invoice.ts#Invoice.render -> src/billing/invoice.ts#Invoice.total', // this.total()
        'src/billing/invoice.ts#Invoice.render -> src/util/format.ts#formatMoney',
        'src/billing/invoice.ts#Invoice.empty -> src/billing/invoice.ts#Invoice', // new Invoice
        'src/billing/invoice.ts#buildInvoice -> src/billing/invoice.ts#Invoice',
        'src/checkout.ts#checkoutTotal -> src/billing/fees.ts#calculateFee', // billing.calculateFee via barrel
        'src/checkout.ts#checkoutTotal -> src/billing/invoice.ts#Invoice.total', // inv.total()
        'src/checkout.ts#checkoutTotal -> src/billing/invoice.ts#buildInvoice', // aliased import `make`
        'src/checkout.ts#checkoutTotal -> src/models.ts#LIMITS',
        'src/checkout.ts#handlers -> src/checkout.ts#checkoutTotal', // function as a value
        'src/checkout.ts#summary -> src/util/format.ts#formatLines', // call + shorthand, deduped
        'src/util/format.ts#formatLines -> src/util/format.ts#formatMoney', // lines.map(formatMoney)
      ].sort(),
    );
  });

  it('skip type-only references, library calls, non-mapped helpers and self references', () => {
    const edges = edgeList(maps);
    expect(edges.some((e) => e.startsWith('src/checkout.ts#checkoutTotal -> src/billing/invoice.ts#Invoice '))).toBe(false);
    expect(edges.some((e) => e === 'src/checkout.ts#checkoutTotal -> src/billing/invoice.ts#Invoice')).toBe(false);
    expect(edges.some((e) => e.includes('roundDown') || e.includes('Math'))).toBe(false);
    expect(edges.some((e) => e.split(' -> ')[0] === e.split(' -> ')[1])).toBe(false);
  });

  it('each file carries only its own outgoing edges', () => {
    for (const m of maps) {
      for (const e of m.edges) expect(e.callerId.startsWith(`${m.file}#`)).toBe(true);
    }
  });
});

describe('mapFile (for contract-hook)', () => {
  let work: string;
  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 'mapper-hook-'));
    cpSync(FIXTURE, work, { recursive: true });
  });
  afterEach(() => rmSync(work, { recursive: true, force: true }));

  it('gives a worktree copy the same ids and hashes as the main checkout', () => {
    const main = byFile(new RepoMapper(FIXTURE).mapAll()).get('src/billing/fees.ts')!;
    const fromWorktree = mapFile(join(work, 'src/billing/fees.ts'), { repoDir: work, edges: false });
    expect(fromWorktree.file).toBe('src/billing/fees.ts');
    expect(fromWorktree.symbols).toEqual(main.symbols);
    expect(fromWorktree.edges).toEqual([]);
    expect(mapFile('src/billing/fees.ts', { repoDir: work }).edges).toEqual(main.edges);
  });

  it('shows a signature change as a new hash on the same id', () => {
    const path = join(work, 'src/billing/fees.ts');
    const before = mapFile(path, { repoDir: work, edges: false }).symbols[0];
    writeFileSync(path, readFileSync(path, 'utf8').replace('rate: number = FEE_RATE,', 'rate: number = FEE_RATE, round = true,'));
    const after = mapFile(path, { repoDir: work, edges: false }).symbols[0];
    expect(after.id).toBe(before.id);
    expect(after.signatureHash).not.toBe(before.signatureHash);
  });

  it('a body-only change (the rounding fix) keeps the hash: that is a behavior change', () => {
    const path = join(work, 'src/billing/fees.ts');
    const before = mapFile(path, { repoDir: work, edges: false }).symbols[0];
    writeFileSync(path, readFileSync(path, 'utf8').replace('Math.floor', 'Math.round'));
    expect(mapFile(path, { repoDir: work, edges: false }).symbols[0]).toEqual(before);
  });

  it('returns no symbols for test files and missing files, and throws outside the repo', () => {
    expect(mapFile(join(work, 'src/checkout.test.ts'), { repoDir: work, edges: false }).symbols).toEqual([]);
    expect(mapFile(join(work, 'src/nope.ts'), { repoDir: work, edges: false }).symbols).toEqual([]);
    expect(() => mapFile('/etc/hosts.ts', { repoDir: work, edges: false })).toThrow(/outside/);
  });
});

describe('isMappable', () => {
  it.each([
    ['src/a.ts', true],
    ['src/a.tsx', true],
    ['src/a.test.ts', false],
    ['src/a.spec.ts', false],
    ['src/__tests__/a.ts', false],
    ['tests/fixtures.ts', false],
    ['test/helpers.ts', false],
    ['scripts/check-dupes.ts', false],
    ['vitest.config.ts', false],
    ['vitest.integration.config.ts', false],
    ['src/config.ts', true],
    ['src/a.d.ts', false],
    ['node_modules/x/a.ts', false],
    ['.contract/x.ts', false],
    ['src/a.js', true],
    ['src/a.jsx', true],
    ['src/a.mjs', true],
    ['src/a.cjs', true],
    ['src/a.test.js', false],
    ['src/a.spec.jsx', false],
    ['eslint.config.mjs', false],
    ['public/jquery.min.js', false],
    ['tests/setup.js', false],
    ['README.md', false],
  ])('%s -> %s', (path, want) => expect(isMappable(path)).toBe(want));
});

describe('map policy (contract.json "map")', () => {
  afterEach(() => setMapPolicy());

  it('include maps a tooling folder, minus its tests and configs; exclude hides a folder', () => {
    setMapPolicy({ include: ['scripts'], exclude: ['demo-repo'] });
    expect(isMappable('scripts/lib.ts')).toBe(true);
    expect(isMappable('scripts/nested/daemon.ts')).toBe(true);
    expect(isMappable('scripts/test/daemon.test.ts')).toBe(false);
    expect(isMappable('scripts/vitest.config.ts')).toBe(false);
    expect(isMappable('other/scripts/x.ts')).toBe(false); // include is a repo-relative prefix
    expect(isMappable('demo-repo/src/fees.ts')).toBe(false);
    expect(isMappable('demo-repo-two/src/fees.ts')).toBe(true);
    expect(isMappable('node_modules/scripts/x.ts')).toBe(false);
  });

  it('is read from the repo\'s contract.json and applied by RepoMapper', () => {
    const work = mkdtempSync(join(tmpdir(), 'mapper-policy-'));
    try {
      cpSync(FIXTURE, work, { recursive: true });
      mkdirSync(join(work, 'scripts'));
      writeFileSync(join(work, 'scripts', 'tool.ts'), 'export function toolMain(argv: string[]): number { return argv.length; }\n');
      expect(new RepoMapper(work).files()).not.toContain('scripts/tool.ts');
      writeFileSync(join(work, 'contract.json'), JSON.stringify({ map: { include: ['scripts'], exclude: ['src/billing'] } }));
      // a fresh dir has a fresh policy (the cache is per directory)
      const dir2 = mkdtempSync(join(tmpdir(), 'mapper-policy-'));
      cpSync(work, dir2, { recursive: true });
      const files = new RepoMapper(dir2).files();
      expect(files).toContain('scripts/tool.ts');
      expect(files.some((f) => f.startsWith('src/billing/'))).toBe(false);
      expect(readMapPolicy(dir2)).toEqual({ include: ['scripts'], exclude: ['src/billing'] });
      expect(useMapPolicy(FIXTURE)).toEqual({ include: [], exclude: [] });
      rmSync(dir2, { recursive: true, force: true });
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
});

describe('watch primitives: refresh + dependents', () => {
  let work: string;
  let mapper: RepoMapper;
  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 'mapper-watch-'));
    cpSync(FIXTURE, work, { recursive: true });
    mapper = new RepoMapper(work);
  });
  afterEach(() => rmSync(work, { recursive: true, force: true }));

  it('dependents include direct importers and importers through a barrel', () => {
    expect(mapper.dependents('src/billing/fees.ts')).toEqual(['src/billing/index.ts', 'src/billing/invoice.ts', 'src/checkout.ts']);
    expect(mapper.dependents('src/checkout.ts')).toEqual([]);
  });

  it('a rename is picked up after refresh, and remapping dependents re-points their edges', () => {
    const fees = join(work, 'src/billing/fees.ts');
    const inv = join(work, 'src/billing/invoice.ts');
    writeFileSync(fees, readFileSync(fees, 'utf8').replaceAll('calculateFee', 'computeFee'));
    writeFileSync(inv, readFileSync(inv, 'utf8').replaceAll('calculateFee', 'computeFee'));
    mapper.refresh(fees);
    mapper.refresh(inv);
    expect(mapper.mapFile(fees).symbols.map((s) => s.name)).toEqual(['computeFee', 'feeLabel']);
    const invEdges = mapper.mapFile(inv).edges.map((e) => e.calleeId);
    expect(invEdges).toContain('src/billing/fees.ts#computeFee');
    expect(invEdges).not.toContain('src/billing/fees.ts#calculateFee');
  });

  it('a new file is added and a deleted file maps to nothing (clears it on the server)', () => {
    const extra = join(work, 'src/util/dates.ts');
    writeFileSync(extra, 'export function formatDate(d: Date): string {\n  return d.toISOString();\n}\n');
    expect(mapper.refresh(extra)).toBe(true);
    expect(mapper.files()).toContain('src/util/dates.ts');
    expect(mapper.mapFile(extra).symbols.map((s) => s.signature)).toEqual(['formatDate(d: Date): string']);

    const deps = mapper.dependents('src/util/format.ts');
    expect(deps).toEqual(['src/billing/invoice.ts', 'src/checkout.ts']);
    unlinkSync(join(work, 'src/util/format.ts'));
    mapper.refresh('src/util/format.ts');
    expect(mapper.files()).not.toContain('src/util/format.ts');
    expect(mapper.mapFile('src/util/format.ts')).toEqual({ file: 'src/util/format.ts', symbols: [], edges: [] });
    // Importers lose their edges into the deleted file once remapped.
    expect(mapper.mapFile('src/billing/invoice.ts').edges.some((e) => e.calleeId.startsWith('src/util/format.ts#'))).toBe(false);
  });

  it('refresh ignores files that are not mapped', () => {
    expect(mapper.refresh('src/checkout.test.ts')).toBe(false);
    expect(mapper.refresh('README.md')).toBe(false);
  });
});

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

describe('JavaScript files', () => {
  const maps = new RepoMapper(fixture('js-repo')).mapAll();

  it('maps .js/.jsx/.mjs/.cjs, skipping tests, .min.js and build output next to a .ts', () => {
    expect(maps.map((m) => m.file)).toEqual(['src/app.jsx', 'src/legacy.cjs', 'src/lib/math.js', 'src/server.mjs', 'src/typed.ts']);
  });

  it('records ES module exports with unannotated signatures; CommonJS exports are not mapped', () => {
    expect(allSymbols(maps).map((s) => `${s.kind} ${s.id}  ${s.signature}`)).toEqual([
      'function src/app.jsx#Total  Total({ value })',
      'function src/app.jsx#makeCounter  makeCounter()',
      'function src/lib/math.js#add  add(a, b)',
      'function src/lib/math.js#double  double(x)',
      'const src/lib/math.js#SCALE  const SCALE = 10',
      'class src/lib/math.js#Counter  class Counter; constructor(start = 0)',
      'method src/lib/math.js#Counter.inc  inc()',
      'function src/server.mjs#handle  async handle(req)',
      'function src/typed.ts#typed  typed(n: number): number',
    ]);
  });

  it('resolves call edges between JS files', () => {
    expect(edgeList(maps)).toEqual([
      'src/app.jsx#Total -> src/lib/math.js#SCALE',
      'src/app.jsx#Total -> src/lib/math.js#double',
      'src/app.jsx#makeCounter -> src/lib/math.js#Counter',
      'src/app.jsx#makeCounter -> src/lib/math.js#Counter.inc',
      'src/lib/math.js#Counter.inc -> src/lib/math.js#add',
      'src/lib/math.js#double -> src/lib/math.js#add',
      'src/server.mjs#handle -> src/lib/math.js#add',
    ]);
  });

  it('mapFile without edges (contract-hook) reads a JS file too', () => {
    const { symbols } = mapFile('src/lib/math.js', { repoDir: fixture('js-repo'), edges: false });
    expect(symbols.map((s) => s.name)).toEqual(['add', 'double', 'SCALE', 'Counter', 'inc']);
  });
});

describe('tsconfig paths aliases', () => {
  it('resolve through the root tsconfig.json (comments and trailing commas allowed), into TS and JS', () => {
    const maps = new RepoMapper(fixture('paths-repo')).mapAll();
    expect(edgeList(maps)).toEqual(['src/main.ts#pageUrl -> src/lib/legacy.js#shout', 'src/main.ts#pageUrl -> src/lib/utils.ts#slugify']);
  });

  const monorepoEdges = [
    'packages/web/src/page.ts#renderCart -> packages/shared/src/format.ts#formatPrice',
    'packages/web/src/page.ts#renderCart -> packages/web/src/cart.ts#cartTotal',
  ];

  it("resolve in a monorepo with no root tsconfig, from each package's own tsconfig", () => {
    expect(edgeList(new RepoMapper(fixture('monorepo')).mapAll())).toEqual(monorepoEdges);
  });

  describe('with a root tsconfig that has no paths', () => {
    let work: string;
    beforeEach(() => {
      work = mkdtempSync(join(tmpdir(), 'mapper-mono-'));
      cpSync(fixture('monorepo'), work, { recursive: true });
    });
    afterEach(() => rmSync(work, { recursive: true, force: true }));

    it('solution style (only references): package aliases still resolve', () => {
      const refs = '{ "files": [], "references": [{ "path": "packages/web" }, { "path": "packages/shared" }] }';
      writeFileSync(join(work, 'tsconfig.json'), refs);
      expect(edgeList(new RepoMapper(work).mapAll())).toEqual(monorepoEdges);
    });

    it('shared compiler options only: package aliases are merged in', () => {
      writeFileSync(join(work, 'tsconfig.json'), '{ "compilerOptions": { "strict": true, "module": "ESNext", "moduleResolution": "bundler" } }');
      expect(edgeList(new RepoMapper(work).mapAll())).toEqual(monorepoEdges);
    });
  });
});

describe('size check', () => {
  const saved = process.env.CONTRACT_MAPPER_MAX_FILES;
  afterEach(() => {
    if (saved === undefined) delete process.env.CONTRACT_MAPPER_MAX_FILES;
    else process.env.CONTRACT_MAPPER_MAX_FILES = saved;
  });

  it('limit comes from CONTRACT_MAPPER_MAX_FILES, default 5000', () => {
    expect(maxFiles({})).toBe(5000);
    expect(maxFiles({ CONTRACT_MAPPER_MAX_FILES: '120' })).toBe(120);
    expect(maxFiles({ CONTRACT_MAPPER_MAX_FILES: 'lots' })).toBe(5000);
  });

  it('warns above 2000 files and throws above the limit', () => {
    expect(checkFileCount(100, '/r', 5000)).toBeUndefined();
    expect(checkFileCount(2500, '/r', 5000)).toMatch(/2500 source files; the first map may be slow/);
    expect(() => checkFileCount(5001, '/r', 5000)).toThrow(/over the limit of 5000.*--repo at a subfolder.*CONTRACT_MAPPER_MAX_FILES/);
  });

  it('RepoMapper refuses a repo over the limit before parsing it', () => {
    process.env.CONTRACT_MAPPER_MAX_FILES = '3';
    expect(() => new RepoMapper(FIXTURE)).toThrow(/has 6 source files, over the limit of 3/);
  });
});
