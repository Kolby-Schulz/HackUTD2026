import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { mapFileAsync, signatureHash, symbolRangesAsync, symbolsTouched, type MappedSymbol } from '@contract/mapper';
import { pendingLines } from '../src/claim-guard.ts';
import { detectChanges, editedFile, type SymbolRow } from '../src/report.ts';

const OLD = 'export function calcFee(amount: number): number';
const NEW = 'export function calcFee(amount: number, currency: string): number';
const ID = 'src/billing/fees.ts#calcFee';

const mapped = (signature: string, id = ID): MappedSymbol => ({
  id,
  name: id.split('#')[1],
  kind: 'function',
  signature,
  signatureHash: signatureHash(signature),
  behaviorNote: '',
});
const row = (signature: string, hash = signatureHash(signature), id = ID): SymbolRow => ({ id, signature, signatureHash: hash });

describe('detectChanges', () => {
  it('reports nothing when the signature is unchanged', () => {
    expect(detectChanges([mapped(OLD)], [row(OLD)])).toEqual([]);
  });

  it('reports a changed signature', () => {
    expect(detectChanges([mapped(NEW)], [row(OLD)])).toEqual([
      { symbolId: ID, kind: 'signature', newSignature: NEW, description: `contract-hook: signature changed to ${NEW}` },
    ]);
  });

  it('does not re-report a change already sent (signature updated, hash not)', () => {
    expect(detectChanges([mapped(NEW)], [row(NEW, signatureHash(OLD))])).toEqual([]);
  });

  it('reports a new symbol as created', () => {
    const id = 'src/billing/fees.ts#refundFee';
    const sig = 'export function refundFee(amount: number): number';
    expect(detectChanges([mapped(OLD), mapped(sig, id)], [row(OLD)])).toEqual([
      { symbolId: id, kind: 'created', newSignature: sig, description: `contract-hook: created ${sig}` },
    ]);
  });

  it('does not re-report a created symbol (row inserted with an empty hash)', () => {
    expect(detectChanges([mapped(NEW)], [row(NEW, '')])).toEqual([]);
  });

  it('reports a symbol missing from the file as removed', () => {
    expect(detectChanges([], [row(OLD)])).toEqual([{ symbolId: ID, kind: 'removed', description: `contract-hook: removed ${ID}` }]);
  });
});

describe('editedFile', () => {
  const repo = '/wt/demo-repo';
  const input = (file_path: string) => ({ cwd: repo, tool_input: { file_path } });
  it('returns the repo-relative path of a source file', () => {
    expect(editedFile(input(`${repo}/src/billing/fees.ts`), repo)).toBe('src/billing/fees.ts');
  });
  it('ignores non-source and out-of-repo files', () => {
    expect(editedFile(input(`${repo}/README.md`), repo)).toBeUndefined();
    expect(editedFile(input('/elsewhere/x.ts'), repo)).toBeUndefined();
    expect(editedFile(input(`${repo}/node_modules/a/index.ts`), repo)).toBeUndefined();
    expect(editedFile({ cwd: repo, tool_input: {} }, repo)).toBeUndefined();
  });
});

describe('other languages (tree-sitter mapper)', () => {
  const repo = '/wt/repo';
  it('editedFile accepts any mapped language', () => {
    expect(editedFile({ cwd: repo, tool_input: { file_path: `${repo}/app/fees.py` } }, repo)).toBe('app/fees.py');
    expect(editedFile({ cwd: repo, tool_input: { file_path: `${repo}/pkg/fees.go` } }, repo)).toBe('pkg/fees.go');
  });

  it('a Python signature change is reported, like a TS one', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hook-py-'));
    try {
      const path = join(dir, 'app/fees.py');
      mkdirSync(join(dir, 'app'));
      writeFileSync(path, 'def calc_fee(amount: int) -> int:\n    return amount\n');
      const before = (await mapFileAsync(path, { repoDir: dir, edges: false })).symbols;
      const rows = before.map((s) => ({ id: s.id, signature: s.signature, signatureHash: s.signatureHash }));
      writeFileSync(path, 'def calc_fee(amount: int, currency: str) -> int:\n    return amount\n');
      const after = (await mapFileAsync(path, { repoDir: dir, edges: false })).symbols;
      expect(detectChanges(after, rows)).toMatchObject([
        { symbolId: 'app/fees.py#calc_fee', kind: 'signature', newSignature: 'calc_fee(amount: int, currency: str): int' },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the claim guard finds the Go symbol an Edit touches', async () => {
    const src = 'package fees\n\nfunc Fee(a int) int {\n\treturn a\n}\n\nfunc Other() int { return 1 }\n';
    const lines = pendingLines({ cwd: repo, tool_name: 'Edit', tool_input: { old_string: '\treturn a' } }, src);
    expect(symbolsTouched(await symbolRangesAsync('pkg/fees.go', src), lines)).toEqual(['pkg/fees.go#Fee']);
  });
});
