import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { copyNote, copySharedFiles, mentionedFiles, planCopies, refreshCopies } from '../src/share.ts';

describe('mentionedFiles', () => {
  it('finds src/ paths and symbol ids, deduplicated, in order', () => {
    // Act
    const r = mentionedFiles(
      'Import formatDate from src/format.ts (symbol src/format.ts#formatDate); keep demo-repo/src/billing/fees.ts#calculateFee and ./src/ui/view.tsx.',
    );

    // Assert
    expect(r).toEqual(['src/format.ts', 'src/billing/fees.ts', 'src/ui/view.tsx']);
  });

  it('ignores paths outside src/ and paths with .. segments', () => {
    // Act
    const r = mentionedFiles('See ../src/x.ts, src/../../etc/passwd.ts, other/src/y.ts, format.ts#formatDate.');

    // Assert
    expect(r).toEqual([]);
  });
});

describe('planCopies', () => {
  const text = 'Do not write a formatter; import formatDate from src/format.ts#formatDate. Keep src/checkout/receipt.ts.';

  it('copies only files missing here that another worktree has', () => {
    // Arrange
    const here = new Set(['src/checkout/receipt.ts']);
    const others = [
      { agentId: 'agent-b', has: (f: string) => f === 'src/format.ts' },
      { agentId: 'agent-c', has: () => true },
    ];

    // Act
    const r = planCopies(text, (f) => here.has(f), others);

    // Assert
    expect(r).toEqual([{ file: 'src/format.ts', fromAgent: 'agent-b' }]);
    expect(copyNote(r[0]!)).toBe("Copied src/format.ts from agent-b's worktree so you can import it; don't edit it.");
  });

  it('never plans to overwrite a file that exists locally', () => {
    // Act
    const r = planCopies(text, () => true, [{ agentId: 'agent-b', has: () => true }]);

    // Assert
    expect(r).toEqual([]);
  });

  it('skips files nobody has yet', () => {
    // Act
    const r = planCopies(text, () => false, [{ agentId: 'agent-b', has: () => false }]);

    // Assert
    expect(r).toEqual([]);
  });
});

describe('copySharedFiles / refreshCopies', () => {
  let repo: string;
  const write = (path: string, text: string) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  };
  const a = () => join(repo, '.worktrees/agent-a/demo-repo');
  const b = () => join(repo, '.worktrees/agent-b/demo-repo');

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'share-test-'));
    write(join(a(), 'src/existing.ts'), 'mine\n');
    write(join(b(), 'src/format.ts'), 'export const formatDate = 1;\n');
    write(join(b(), 'src/existing.ts'), 'theirs\n');
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it('copies a missing file byte-for-byte and leaves existing files alone', () => {
    // Act
    const got = copySharedFiles('import from src/format.ts#formatDate and src/existing.ts', repo, 'agent-a', a());

    // Assert
    expect(got.map((c) => [c.file, c.fromAgent])).toEqual([['src/format.ts', 'agent-b']]);
    expect(readFileSync(join(a(), 'src/format.ts'), 'utf8')).toBe('export const formatDate = 1;\n');
    expect(readFileSync(join(a(), 'src/existing.ts'), 'utf8')).toBe('mine\n');
  });

  it('refreshes an untouched copy from the owner, but not one this agent edited', () => {
    // Arrange
    const got = copySharedFiles('src/format.ts', repo, 'agent-a', a());
    write(join(b(), 'src/format.ts'), 'export const formatDate = 2;\n');

    // Act
    const first = refreshCopies(got, repo, a());
    write(join(a(), 'src/format.ts'), 'edited\n');
    const second = refreshCopies(got, repo, a());

    // Assert
    expect(first).toEqual(['src/format.ts']);
    expect(second).toEqual([]);
    expect(readFileSync(join(a(), 'src/format.ts'), 'utf8')).toBe('edited\n');
  });

  it('does nothing without other worktrees', () => {
    // Arrange
    rmSync(join(repo, '.worktrees/agent-b'), { recursive: true });

    // Act
    const got = copySharedFiles('src/format.ts', repo, 'agent-a', a());

    // Assert
    expect(got).toEqual([]);
    expect(existsSync(join(a(), 'src/format.ts'))).toBe(false);
  });
});
