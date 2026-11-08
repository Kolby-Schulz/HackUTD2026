// Live diffs (contract-hook) and the claim guard (issue #24).
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { symbolRanges, symbolsTouched } from '@contract/mapper';
import { changedLines, fileDiff } from '../src/hook.ts';
import { blockingClaims, blockMessage, pendingLines } from '../src/claim-guard.ts';

const SRC = [
  'export function a(): number {', // 1
  '  return 1;', // 2
  '}', // 3
  '', // 4
  'export function b(): number {', // 5
  '  return 2;', // 6
  '}', // 7
  '',
].join('\n');
const FILE = 'src/x.ts';

describe('changedLines', () => {
  it('reads new-side lines from hunks, counting deletions at their position', () => {
    const diff = ['--- a/src/x.ts', '+++ b/src/x.ts', '@@ -5,3 +5,4 @@', ' export function b(): number {', '-  return 2;', '+  return 3;', '+  // x', ' }'].join('\n');
    expect(changedLines(diff)).toEqual([6, 7]);
  });
});

describe('fileDiff', () => {
  it('diffs tracked files against HEAD and new files against /dev/null', () => {
    const dir = mkdtempSync(join(tmpdir(), 'contract-diff-'));
    const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
    git('init', '-q');
    writeFileSync(join(dir, 'x.ts'), SRC);
    git('add', '.');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base');
    writeFileSync(join(dir, 'x.ts'), SRC.replace('return 2', 'return 20'));
    writeFileSync(join(dir, 'y.ts'), 'export const y = 1;\n');
    const d = fileDiff(dir, 'x.ts');
    expect(d).toContain('+  return 20;');
    expect(symbolsTouched(symbolRanges('x.ts', SRC), changedLines(d))).toEqual(['x.ts#b']);
    expect(fileDiff(dir, 'y.ts')).toContain('+export const y = 1;');
  });
});

describe('claim guard', () => {
  const ranges = symbolRanges(FILE, SRC);
  it('finds the lines an Edit, MultiEdit or Write would change', () => {
    expect(symbolsTouched(ranges, pendingLines({ cwd: '.', tool_name: 'Edit', tool_input: { old_string: 'return 2;' } }, SRC))).toEqual(['src/x.ts#b']);
    expect(symbolsTouched(ranges, pendingLines({ cwd: '.', tool_name: 'MultiEdit', tool_input: { edits: [{ old_string: 'return 1;' }, { old_string: 'return 2;' }] } }, SRC))).toEqual(['src/x.ts#a', 'src/x.ts#b']);
    expect(symbolsTouched(ranges, pendingLines({ cwd: '.', tool_name: 'Write', tool_input: { content: SRC.replace('return 1', 'return 9') } }, SRC))).toEqual(['src/x.ts#a']);
    expect(pendingLines({ cwd: '.', tool_name: 'Write', tool_input: { content: SRC } }, SRC)).toEqual([]);
  });
  it("blocks only other agents' live claims and says who holds them", () => {
    const now = 1_000_000;
    const claims = [
      { symbolId: 'src/x.ts#b', agentId: 'agent-a', expiresAtMs: now + 120_000 },
      { symbolId: 'src/x.ts#a', agentId: 'agent-b', expiresAtMs: now + 120_000 }, // mine
      { symbolId: 'src/x.ts#a', agentId: 'agent-c', expiresAtMs: now - 1 }, // expired
    ];
    const blocks = blockingClaims(claims, ['src/x.ts#a', 'src/x.ts#b'], 'agent-b', now);
    expect(blocks.map((c) => c.symbolId)).toEqual(['src/x.ts#b']);
    expect(blockMessage(blocks, new Map([['agent-a', 'Alice, laptop-1']]))).toMatch(/b \(src\/x.ts#b\) is claimed by agent-a \(Alice, laptop-1\)/);
  });
});
