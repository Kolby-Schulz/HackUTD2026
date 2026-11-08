// resolveTarget (issue #18): which repo/folder agents work in, and its checks.
import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkTools, cloneDirFor, detectChecks, missingTools, detectInstall, repoKey, resolveTarget, runInstall, stageAll, toolPath, worktreeDir } from '../src/target.ts';

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

  it('clones git URLs into .contract/repos/<owner>/<name>', () => {
    expect(cloneDirFor(MONO, 'https://github.com/acme/shop.git')).toBe(`${MONO}/.contract/repos/acme/shop`);
    expect(cloneDirFor(MONO, 'git@github.com:acme/shop.git')).toBe(`${MONO}/.contract/repos/acme/shop`);
    expect(cloneDirFor(MONO, 'https://github.com/acme/shop/')).toBe(`${MONO}/.contract/repos/acme/shop`);
    expect(cloneDirFor(MONO, 'shop.git')).toBe(`${MONO}/.contract/repos/shop`);
  });

  it('gives two forks with the same name their own clone folders', () => {
    expect(cloneDirFor(MONO, 'https://github.com/alice/shop.git')).not.toBe(cloneDirFor(MONO, 'https://github.com/bob/shop.git'));
  });
});

describe('any repo: worktrees, installs, checks', () => {
  it('keeps the demo at .worktrees/<id> and gives other repos their own folder', () => {
    const demo = resolveTarget(MONO);
    expect(worktreeDir(MONO, demo, 'agent-a')).toBe(`${MONO}/.worktrees/agent-a`);
    const a = gitRepo();
    const b = gitRepo();
    const ta = resolveTarget(MONO, a);
    expect(worktreeDir(MONO, ta, 'agent-a')).toBe(`${MONO}/.worktrees/${repoKey(ta)}/agent-a`);
    expect(repoKey(ta)).toMatch(/^contract-target-\w+-[0-9a-f]{6}$/);
    expect(repoKey(resolveTarget(MONO, b))).not.toBe(repoKey(ta));
  });

  it('detects installs and checks per ecosystem', () => {
    const cases: [Record<string, string>, string[], string[]][] = [
      [{ 'package-lock.json': '{}', 'package.json': '{"scripts":{"test":"vitest"}}' }, ['npm ci --no-audit --no-fund'], ['npm test']],
      [{ 'pnpm-lock.yaml': '', 'package.json': '{}' }, ['pnpm install --frozen-lockfile'], []],
      [{ 'requirements.txt': 'flask\npytest\n', 'tests/test_x.py': '' }, ['test -d .venv || python3 -m venv .venv && .venv/bin/pip install -q --disable-pip-version-check -r requirements.txt && .venv/bin/pip install -q --disable-pip-version-check pytest'], ['python -m pytest -q']],
      [{ 'uv.lock': '', 'pyproject.toml': '[tool.pytest.ini_options]' }, ['uv sync'], ['python -m pytest -q']],
      [{ 'go.mod': 'module x' }, ['go mod download'], ['go test ./...']],
      [{ 'Cargo.toml': '[package]' }, ['cargo fetch'], ['cargo test']],
      [{ 'pom.xml': '<project/>' }, ['mvn -q -B dependency:go-offline'], ['mvn -q test']],
      [{ 'gradlew': '', 'build.gradle': '' }, ['./gradlew --quiet dependencies'], ['./gradlew test']],
      [{ 'build.gradle.kts': '' }, ['gradle --quiet dependencies'], ['gradle test']],
      [{ 'Gemfile': '', 'spec/a_spec.rb': '' }, ['bundle install'], ['bundle exec rspec']],
      [{ 'composer.json': '{"require-dev":{"phpunit/phpunit":"^10"}}' }, ['composer install --no-interaction'], ['vendor/bin/phpunit']],
      [{ 'App.sln': '' }, ['dotnet restore'], ['dotnet test']],
      [{ 'README.md': '' }, [], []],
    ];
    for (const [files, install, checks] of cases) {
      const dir = gitRepo(files);
      expect(detectInstall(dir).map((c) => c.cmd), Object.keys(files).join()).toEqual(install);
      expect(detectChecks(dir).map((c) => c.cmd), Object.keys(files).join()).toEqual(checks);
    }
  });

  it('lets contract.json override or turn off the install, and lets workers run it', () => {
    expect(resolveTarget(MONO, gitRepo({ 'go.mod': '', 'contract.json': '{"install":"make deps"}' })).install).toEqual([{ name: 'install', cmd: 'make deps' }]);
    expect(resolveTarget(MONO, gitRepo({ 'go.mod': '', 'contract.json': '{"install":false}' })).install).toEqual([]);
    expect(resolveTarget(MONO).install).toEqual([]);
    expect(checkTools({ checks: [], install: [{ name: 'go', cmd: 'go mod download' }] })).toContain('Bash(go mod download:*)');
  });

  it('runs installs with the checkout tools on PATH and skips missing tools', () => {
    const dir = gitRepo();
    const logs: string[] = [];
    const r = runInstall(dir, { install: [{ name: 'echo', cmd: 'echo $PATH > path.txt' }, { name: 'nope', cmd: 'definitely-not-a-tool-xyz install' }] }, (m) => logs.push(m));
    expect(r).toEqual({ ok: false, ran: ['echo'] });
    expect(logs.join('\n')).toMatch(/skipping nope/);
    expect(toolPath(dir, '/usr/bin')).toBe(`${dir}/.venv/bin:${dir}/node_modules/.bin:/usr/bin`);
  });

  it('keeps installed folders out of commits', () => {
    const dir = gitRepo({ 'a.py': 'x = 1', 'node_modules/x/index.js': '', '.venv/bin/python': '', 'sub/node_modules/y.js': '' });
    stageAll(dir);
    const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: dir, encoding: 'utf8' }).trim().split('\n');
    expect(staged).toEqual(['a.py']);
  });

  it('stages a repo that already gitignores its dependency folders', () => {
    // `git add -A . :(exclude)node_modules/**` exits 1 here ("paths are ignored by .gitignore").
    const dir = gitRepo({ '.gitignore': 'node_modules\n', 'a.py': 'x = 1', 'node_modules/x/index.js': '', 'sub/node_modules/y.js': '' });
    expect(() => stageAll(dir)).not.toThrow();
    const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: dir, encoding: 'utf8' }).trim().split('\n');
    expect(staged).toEqual(['.gitignore', 'a.py']);
  });

  it('names tools this laptop is missing, with a brew hint, and trusts the venv for python', () => {
    const t = {
      install: [{ name: 'pip', cmd: 'test -d .venv || python3 -m venv .venv && .venv/bin/pip install -q pytest' }, { name: 'x', cmd: 'zz-no-such-tool-1 fetch' }],
      checks: [{ name: 'pytest', cmd: 'python -m pytest -q' }, { name: 'x', cmd: 'zz-no-such-tool-1 test' }, { name: 'gradle', cmd: './gradlew test' }, { name: 'sh', cmd: 'sh -c true' }],
    };
    expect(missingTools(t, 'darwin')).toEqual([{ tool: 'zz-no-such-tool-1', neededBy: ['zz-no-such-tool-1 fetch', 'zz-no-such-tool-1 test'] }]);
    const go = { install: [{ name: 'go', cmd: 'zz-no-such-go mod download' }], checks: [] };
    expect(missingTools(go, 'linux')[0]).not.toHaveProperty('hint');
  });
});
