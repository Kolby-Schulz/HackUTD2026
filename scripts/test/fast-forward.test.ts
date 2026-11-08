// session start's update of the target checkout (fastForwardToBase), with real git repos: a bare
// origin, a checkout of it, and a second clone that lands a merge on origin/main.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fastForwardToBase } from '../lib.ts';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

let root: string, origin: string, local: string, other: string;

/** Lands a commit on origin/main from another clone (what Merge and check --land does). */
function landOnOrigin(file: string, text: string) {
  writeFileSync(join(other, file), text);
  git(other, 'add', '-A');
  git(other, 'commit', '-qm', `land ${file}`);
  git(other, 'push', '-q', 'origin', 'main');
  git(local, 'fetch', '-q', 'origin', 'main');
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ff-'));
  origin = join(root, 'origin.git');
  local = join(root, 'local');
  other = join(root, 'other');
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  git(root, 'clone', '-q', origin, local);
  git(local, 'checkout', '-q', '-b', 'main');
  writeFileSync(join(local, 'a.ts'), 'export const a = 1;\n');
  git(local, 'add', '-A');
  git(local, 'commit', '-qm', 'init');
  git(local, 'push', '-q', '-u', 'origin', 'main');
  git(root, 'clone', '-q', origin, other);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('fastForwardToBase', () => {
  it('reports current when nothing landed', () => {
    expect(fastForwardToBase(local, 'origin/main')).toEqual({ status: 'current' });
  });
  it('fast-forwards a clean checkout to a merge that landed on origin', () => {
    landOnOrigin('b.ts', 'export const b = 2;\n');
    expect(fastForwardToBase(local, 'origin/main')).toEqual({ status: 'updated' });
    expect(readFileSync(join(local, 'b.ts'), 'utf8')).toBe('export const b = 2;\n');
  });
  it('keeps unrelated local edits while updating', () => {
    writeFileSync(join(local, 'a.ts'), 'export const a = 99;\n');
    landOnOrigin('b.ts', 'export const b = 2;\n');
    expect(fastForwardToBase(local, 'origin/main').status).toBe('updated');
    expect(readFileSync(join(local, 'a.ts'), 'utf8')).toBe('export const a = 99;\n');
  });
  it('leaves a checkout alone when the update would overwrite local edits', () => {
    writeFileSync(join(local, 'a.ts'), 'export const a = 99;\n');
    landOnOrigin('a.ts', 'export const a = 2;\n');
    expect(fastForwardToBase(local, 'origin/main')).toMatchObject({ status: 'skipped', reason: 'local changes would be overwritten' });
    expect(readFileSync(join(local, 'a.ts'), 'utf8')).toBe('export const a = 99;\n');
  });
  it('leaves a checkout on another branch alone', () => {
    git(local, 'checkout', '-q', '-b', 'feature');
    landOnOrigin('b.ts', 'x\n');
    expect(fastForwardToBase(local, 'origin/main')).toMatchObject({ status: 'skipped', reason: 'on branch feature, not main' });
  });
  it('leaves a main with its own commits alone', () => {
    writeFileSync(join(local, 'c.ts'), 'mine\n');
    git(local, 'add', '-A');
    git(local, 'commit', '-qm', 'local only');
    landOnOrigin('b.ts', 'x\n');
    expect(fastForwardToBase(local, 'origin/main')).toMatchObject({ status: 'skipped', reason: 'local main has commits that are not on origin/main' });
  });
});
