// resolveTarget (issue #18): which repo/folder agents work in, and its checks.
import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkTools, cloneDirFor, resolveTarget } from '../src/target.ts';

const MONO = '/repo/mono';

function gitRepo(files: Record<string, string> = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'contract-target-')));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  for (const [f, body] of Object.entries(files)) {
    mkdirSync(join(dir, f, '..'), { recursive: true });
    writeFileSync(join(dir, f), body);
  }
  return dir;
}

describe('resolveTarget', () => {
  afterEach(() => {
    delete process.env.CONTRACT_TARGET;
    delete process.env.CONTRACT_TEST_CMD;
  });

  it('defaults to the demo-repo folder of the monorepo', () => {
    const t = resolveTarget(MONO);
    expect(t).toMatchObject({ gitRoot: MONO, subdir: 'demo-repo', dir: `${MONO}/demo-repo`, demo: true, label: 'demo-repo' });
    expect(t.checks.map((c) => c.name)).toEqual(['unit tests', 'typecheck', 'check-dupes']);
  });

  it('takes a whole local repo, with npm test as its check and HEAD as base without an origin', () => {
    const dir = gitRepo({ 'package.json': JSON.stringify({ scripts: { test: 'vitest run' } }) });
    const t = resolveTarget(MONO, dir);
    expect(t).toMatchObject({ gitRoot: dir, subdir: '', dir, demo: false, base: 'HEAD', checks: [{ name: 'tests', cmd: 'npm test' }] });
  });

  it('takes a folder inside a repo, from CONTRACT_TARGET, with contract.json checks and base', () => {
    const dir = gitRepo({ 'apps/web/contract.json': JSON.stringify({ checks: { pytest: 'pytest -q' }, base: 'origin/dev' }) });
    process.env.CONTRACT_TARGET = join(dir, 'apps/web');
    const t = resolveTarget(MONO);
    expect(t).toMatchObject({ gitRoot: dir, subdir: 'apps/web', dir: join(dir, 'apps/web'), base: 'origin/dev', checks: [{ name: 'pytest', cmd: 'pytest -q' }], label: 'web' });
    expect(checkTools(t)).toContain('Bash(pytest -q:*)');
  });

  it('CONTRACT_TEST_CMD overrides the default check', () => {
    const dir = gitRepo();
    process.env.CONTRACT_TEST_CMD = 'make test';
    expect(resolveTarget(MONO, dir).checks).toEqual([{ name: 'tests', cmd: 'make test' }]);
  });

  it('rejects missing folders, non-git folders and worktrees', () => {
    expect(() => resolveTarget(MONO, '/nope/not/here')).toThrow(/not found/);
    const plain = realpathSync(mkdtempSync(join(tmpdir(), 'contract-plain-')));
    expect(() => resolveTarget(MONO, plain)).toThrow(/not inside a git repository/);
    const dir = gitRepo({ '.worktrees/agent-a/x.ts': '' });
    expect(() => resolveTarget(MONO, join(dir, '.worktrees/agent-a'))).toThrow(/worktree/);
  });

  it('clones git URLs into .contract/repos/<name>', () => {
    expect(cloneDirFor(MONO, 'https://github.com/acme/shop.git')).toBe(`${MONO}/.contract/repos/shop`);
  });
});
