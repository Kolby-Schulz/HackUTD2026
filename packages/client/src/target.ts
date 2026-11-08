// The repository Contract coordinates agents on (issue #18, "Bring your own repo").
// Node-only (git + fs); the dashboard never imports it.
//
// One setting picks it, used by the worker, mapper, session and reset scripts:
//   --repo <path|git URL>   or   CONTRACT_TARGET=<path|git URL> in .env
// Unset means the built-in demo: the monorepo's own demo-repo/ folder.
//
// (Not CONTRACT_REPO: that name already points the hooks at the monorepo root.)
//
// - A local path may be a whole git repo or a folder inside one (like demo-repo/ inside
//   this monorepo). Workers get a git worktree of that repo and work in the same folder.
// - A git URL is cloned once into .contract/repos/<name> and fetched on later runs.
// - Optional <target>/contract.json: { "checks": { "unit tests": "npm test", ... },
//   "base": "origin/main", "install": "make deps" | false,
//   "map": { "include": ["scripts"], "exclude": ["demo-repo"] } }. Checks are the commands the
//   merge runs and the commands workers may run without asking. CONTRACT_TEST_CMD overrides
//   a single test command. Without contract.json, checks and the dependency install are
//   detected from the repo's files (package.json, pyproject.toml, go.mod, Cargo.toml, ...).
// - Worktrees: the demo's live in .worktrees/<name>; any other repo's in
//   .worktrees/<repoKey>/<name>, so switching repos never reuses another repo's folder.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';

export interface Check {
  name: string;
  /** Shell command run in the target folder; exit 0 = pass. */
  cmd: string;
}

export interface Target {
  /** The git repository's top level (the monorepo for the demo). */
  gitRoot: string;
  /** Folder inside gitRoot the agents work in ('' = the whole repo), with '/' separators. */
  subdir: string;
  /** join(gitRoot, subdir): the main checkout the mapper maps. */
  dir: string;
  /** True for the built-in demo-repo/. */
  demo: boolean;
  /** Ref workers branch from in the two-laptop flow ('origin/main' when there's an origin). */
  base: string;
  /** Commands that decide whether merged work is good. */
  checks: Check[];
  /** Short label for logs and the dashboard. */
  label: string;
  /** Commands that install the target's dependencies in a fresh checkout ([] = none). */
  install: Check[];
}

/** The demo's checks: demo-repo's npm scripts (run-demo and session pick from these). */
export const DEMO_CHECKS: Check[] = [
  { name: 'unit tests', cmd: 'npm run --silent test' },
  { name: 'typecheck', cmd: 'npm run --silent typecheck' },
  { name: 'check-dupes', cmd: 'npm run --silent check:dupes' },
];

const isUrl = (s: string) => /^(https?:\/\/|git@|ssh:\/\/|git:\/\/)/.test(s) || (s.endsWith('.git') && !existsSync(s));

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** `.contract/repos/<name>` for a git URL: "https://github.com/a/b.git" -> "b". */
export function cloneDirFor(monorepo: string, url: string): string {
  const name = basename(url.replace(/\/+$/, '')).replace(/\.git$/, '').replace(/[^\w.-]/g, '_') || 'repo';
  return join(monorepo, '.contract', 'repos', name);
}

/**
 * Resolves the target from `spec` (a --repo value), else CONTRACT_TARGET, else the demo.
 * Clones a git URL on first use (pass clone: false to only compute paths).
 */
export function resolveTarget(monorepo: string, spec?: string, opts: { clone?: boolean } = {}): Target {
  const raw = (spec ?? process.env.CONTRACT_TARGET ?? '').trim();
  if (!raw) {
    // No install: worktrees sit inside the monorepo, so node finds its node_modules.
    return { gitRoot: monorepo, subdir: 'demo-repo', dir: join(monorepo, 'demo-repo'), demo: true, base: 'origin/main', checks: DEMO_CHECKS, label: 'demo-repo', install: [] };
  }

  let dir: string;
  if (isUrl(raw)) {
    dir = cloneDirFor(monorepo, raw);
    if (opts.clone !== false) {
      if (!existsSync(join(dir, '.git'))) {
        mkdirSync(join(monorepo, '.contract', 'repos'), { recursive: true });
        execFileSync('git', ['clone', raw, dir], { stdio: 'inherit' });
      }
    }
  } else {
    dir = resolve(monorepo, raw);
  }
  if (!existsSync(dir)) throw new Error(`target repo not found: ${dir}`);
  if (`${dir}${sep}`.includes(`${sep}.worktrees${sep}`)) throw new Error(`target ${dir} is a worker worktree; point it at the main checkout`);

  let gitRoot: string;
  try {
    gitRoot = git(['rev-parse', '--show-toplevel'], dir);
  } catch {
    throw new Error(`target ${dir} is not inside a git repository (workers need git worktrees); run \`git init\` and commit first`);
  }
  const subdir = relative(gitRoot, dir).split(sep).join('/');
  const cfg = readConfig(dir);
  const demo = gitRoot === resolve(monorepo) && subdir === 'demo-repo';
  return {
    gitRoot,
    subdir,
    dir: subdir ? join(gitRoot, subdir) : gitRoot,
    demo,
    base: cfg.base ?? defaultBase(gitRoot),
    checks: checksFor(dir, cfg, demo),
    label: demo ? 'demo-repo' : basename(dir),
    install: demo ? [] : installFor(dir, cfg),
  };
}

interface TargetConfig {
  checks?: Record<string, string>;
  base?: string;
  /** Shell command that installs dependencies, or false for none (default: detected). */
  install?: string | false;
  /** Code-map folders: read by the mapper (mapper/src/map.ts MapPolicy), not here. */
  map?: { include?: string[]; exclude?: string[] };
}

function readConfig(dir: string): TargetConfig {
  const p = join(dir, 'contract.json');
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as TargetConfig;
  } catch (e) {
    throw new Error(`${p}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** contract.json checks, else CONTRACT_TEST_CMD, else the demo's scripts, else detected from the repo. */
export function checksFor(dir: string, cfg: TargetConfig, demo: boolean): Check[] {
  if (cfg.checks && Object.keys(cfg.checks).length) return Object.entries(cfg.checks).map(([name, cmd]) => ({ name, cmd }));
  if (process.env.CONTRACT_TEST_CMD) return [{ name: 'tests', cmd: process.env.CONTRACT_TEST_CMD }];
  if (demo) return DEMO_CHECKS;
  return detectChecks(dir);
}

const has = (dir: string, f: string) => existsSync(join(dir, f));
const readText = (dir: string, f: string) => {
  try {
    return readFileSync(join(dir, f), 'utf8');
  } catch {
    return '';
  }
};
const filesMatching = (dir: string, re: RegExp) => {
  try {
    return readdirSync(dir).filter((f) => re.test(f));
  } catch {
    return [];
  }
};
const isPython = (dir: string) => ['pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt', 'uv.lock', 'poetry.lock'].some((f) => has(dir, f));
const usesPytest = (dir: string) =>
  has(dir, 'pytest.ini') || has(dir, 'conftest.py') || has(dir, 'tests') || has(dir, 'test') ||
  /\[tool\.pytest|pytest/.test(readText(dir, 'pyproject.toml') + readText(dir, 'setup.cfg') + readText(dir, 'requirements.txt') + readText(dir, 'requirements-dev.txt'));

/** Test commands by ecosystem, from the files at the target's root. */
export function detectChecks(dir: string): Check[] {
  const out: Check[] = [];
  let pkgTest = false;
  try {
    pkgTest = Boolean((JSON.parse(readText(dir, 'package.json')) as { scripts?: Record<string, string> }).scripts?.test);
  } catch { /* no package.json */ }
  if (pkgTest) out.push({ name: 'tests', cmd: 'npm test' });
  if (isPython(dir) && usesPytest(dir)) out.push({ name: 'pytest', cmd: 'python -m pytest -q' });
  if (has(dir, 'go.mod')) out.push({ name: 'go test', cmd: 'go test ./...' });
  if (has(dir, 'Cargo.toml')) out.push({ name: 'cargo test', cmd: 'cargo test' });
  if (has(dir, 'gradlew')) out.push({ name: 'gradle test', cmd: './gradlew test' });
  else if (has(dir, 'build.gradle') || has(dir, 'build.gradle.kts')) out.push({ name: 'gradle test', cmd: 'gradle test' });
  else if (has(dir, 'pom.xml')) out.push({ name: 'maven test', cmd: 'mvn -q test' });
  if (has(dir, 'Gemfile') && has(dir, 'spec')) out.push({ name: 'rspec', cmd: 'bundle exec rspec' });
  else if (has(dir, 'Gemfile') && has(dir, 'Rakefile')) out.push({ name: 'rake test', cmd: 'bundle exec rake test' });
  if (has(dir, 'composer.json') && /phpunit/.test(readText(dir, 'composer.json'))) out.push({ name: 'phpunit', cmd: 'vendor/bin/phpunit' });
  if (filesMatching(dir, /\.(sln|csproj)$/).length) out.push({ name: 'dotnet test', cmd: 'dotnet test' });
  return out;
}

/** contract.json install, else detected from lockfiles and manifests (one step per ecosystem). */
export function installFor(dir: string, cfg: TargetConfig = {}): Check[] {
  if (cfg.install === false) return [];
  if (typeof cfg.install === 'string' && cfg.install.trim()) return [{ name: 'install', cmd: cfg.install.trim() }];
  return detectInstall(dir);
}

const VENV = 'test -d .venv || python3 -m venv .venv';
const PIP = '.venv/bin/pip install -q --disable-pip-version-check';

export function detectInstall(dir: string): Check[] {
  const out: Check[] = [];
  if (has(dir, 'pnpm-lock.yaml')) out.push({ name: 'pnpm', cmd: 'pnpm install --frozen-lockfile' });
  else if (has(dir, 'yarn.lock')) out.push({ name: 'yarn', cmd: 'yarn install --frozen-lockfile' });
  else if (has(dir, 'bun.lock') || has(dir, 'bun.lockb')) out.push({ name: 'bun', cmd: 'bun install' });
  else if (has(dir, 'package-lock.json')) out.push({ name: 'npm', cmd: 'npm ci --no-audit --no-fund' });
  else if (has(dir, 'package.json')) out.push({ name: 'npm', cmd: 'npm install --no-audit --no-fund' });

  if (has(dir, 'uv.lock')) out.push({ name: 'uv', cmd: 'uv sync' });
  else if (has(dir, 'poetry.lock')) out.push({ name: 'poetry', cmd: 'poetry install' });
  else if (isPython(dir)) {
    const steps = [VENV];
    if (has(dir, 'requirements.txt')) steps.push(`${PIP} -r requirements.txt`);
    if (has(dir, 'requirements-dev.txt')) steps.push(`${PIP} -r requirements-dev.txt`);
    if (has(dir, 'pyproject.toml') || has(dir, 'setup.py')) steps.push(`${PIP} -e .`);
    if (usesPytest(dir)) steps.push(`${PIP} pytest`);
    out.push({ name: 'pip', cmd: steps.join(' && ') });
  }
  if (has(dir, 'go.mod')) out.push({ name: 'go', cmd: 'go mod download' });
  if (has(dir, 'Cargo.toml')) out.push({ name: 'cargo', cmd: 'cargo fetch' });
  if (has(dir, 'Gemfile')) out.push({ name: 'bundler', cmd: 'bundle install' });
  if (has(dir, 'composer.json')) out.push({ name: 'composer', cmd: 'composer install --no-interaction' });
  if (filesMatching(dir, /\.(sln|csproj)$/).length) out.push({ name: 'dotnet', cmd: 'dotnet restore' });
  // JVM: fetch dependencies up front so the agent's first test run isn't a long download.
  if (has(dir, 'gradlew')) out.push({ name: 'gradle', cmd: './gradlew --quiet dependencies' });
  else if (has(dir, 'build.gradle') || has(dir, 'build.gradle.kts')) out.push({ name: 'gradle', cmd: 'gradle --quiet dependencies' });
  else if (has(dir, 'pom.xml')) out.push({ name: 'maven', cmd: 'mvn -q -B dependency:go-offline' });
  return out;
}

/** The program a shell command starts with ("npm ci" -> "npm", "test -d .venv || ..." -> "python3"). */
function programOf(cmd: string): string {
  const m = /python3 -m venv/.test(cmd) ? 'python3' : cmd.trim().split(/\s+/)[0];
  return m ?? '';
}

/** Homebrew formula for each tool installs and checks use (bundle comes with Ruby). */
const BREW: Record<string, string> = {
  npm: 'node', node: 'node', pnpm: 'pnpm', yarn: 'yarn', bun: 'oven-sh/bun/bun', python3: 'python', uv: 'uv', poetry: 'poetry',
  go: 'go', cargo: 'rust', bundle: 'ruby', composer: 'composer', dotnet: '--cask dotnet-sdk', mvn: 'maven', gradle: 'gradle',
};

export interface MissingTool {
  /** The program that isn't on PATH ("go"). */
  tool: string;
  /** What needs it ("go mod download", "go test"). */
  neededBy: string[];
  /** How to get it on this laptop ("brew install go"), when known. */
  hint?: string;
}

/**
 * Programs the target's installs and checks need that this laptop doesn't have, so the UI can
 * say so up front instead of tests failing later. A Python install brings its own python and
 * pytest (.venv), and ./gradlew or vendor/bin/... come from the repo or its install.
 */
export function missingTools(t: Pick<Target, 'install' | 'checks'>, platform = process.platform): MissingTool[] {
  const venv = t.install.some((c) => /python3 -m venv|uv sync|poetry install/.test(c.cmd));
  const need = new Map<string, string[]>();
  for (const c of [...t.install, ...t.checks]) {
    let program = programOf(c.cmd);
    if (program === 'python') {
      if (venv) continue;
      program = 'python3';
    }
    if (!program || program.includes('/')) continue;
    need.set(program, [...(need.get(program) ?? []), c.cmd]);
  }
  return [...need]
    .filter(([program]) => !onPath(program))
    .map(([tool, neededBy]) => ({ tool, neededBy, ...(platform === 'darwin' && BREW[tool] ? { hint: `brew install ${BREW[tool]}` } : {}) }));
}

function onPath(program: string): boolean {
  if (program.includes('/')) return true; // ./gradlew, vendor/bin/...
  try {
    execFileSync('sh', ['-c', `command -v ${program}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** PATH with the checkout's own tool folders first (.venv/bin, node_modules/.bin). */
export function toolPath(dir: string, path = process.env.PATH ?? ''): string {
  return [join(dir, '.venv', 'bin'), join(dir, 'node_modules', '.bin'), path].join(':');
}

/** Folders installs create; never committed (git pathspec excludes, no repo config changes). */
export const DEP_DIRS = ['node_modules', '.venv', 'vendor/bundle', 'target', '__pycache__'];
export const DEP_PATHSPEC = ['--', '.', ...DEP_DIRS.flatMap((d) => [`:(exclude,glob)${d}/**`, `:(exclude,glob)**/${d}/**`])];

/**
 * Installs the target's dependencies in a checkout of it (`dir` = the target folder in a
 * worktree). Missing tools are skipped and failures logged, not thrown: the agent can still
 * work, and a broken install shows up as failing checks.
 */
export function runInstall(dir: string, t: Pick<Target, 'install'>, log: (m: string) => void = console.log): { ok: boolean; ran: string[] } {
  const ran: string[] = [];
  let ok = true;
  for (const step of t.install) {
    const program = programOf(step.cmd);
    if (!onPath(program)) {
      log(`[install] skipping ${step.name}: \`${program}\` is not installed on this laptop`);
      ok = false;
      continue;
    }
    log(`[install] ${step.cmd}`);
    try {
      execFileSync('sh', ['-c', step.cmd], { cwd: dir, stdio: 'inherit', timeout: 10 * 60_000, env: { ...process.env, PATH: toolPath(dir) } });
      ran.push(step.name);
    } catch (e) {
      ok = false;
      log(`[install] ${step.name} failed: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
    }
  }
  return { ok, ran };
}

/** Short, stable folder name for a target: "<label>-<6 hex of its git root>". */
export function repoKey(t: Pick<Target, 'gitRoot' | 'subdir' | 'label'>): string {
  const hash = createHash('sha1').update(`${resolve(t.gitRoot)}\0${t.subdir}`).digest('hex').slice(0, 6);
  return `${t.label.replace(/[^\w.-]/g, '_')}-${hash}`;
}

/** Where a worktree named `name` (an agent id, "merge-<run>") lives for this target. */
export function worktreeDir(monorepo: string, t: Pick<Target, 'gitRoot' | 'subdir' | 'label' | 'demo'>, name: string): string {
  return t.demo ? join(monorepo, '.worktrees', name) : join(monorepo, '.worktrees', repoKey(t), name);
}

/** origin/<default branch> when the repo has an origin, else HEAD (local-only repo). */
function defaultBase(gitRoot: string): string {
  try {
    git(['remote', 'get-url', 'origin'], gitRoot);
  } catch {
    return 'HEAD';
  }
  try {
    return git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], gitRoot); // e.g. origin/main
  } catch {
    return 'origin/main';
  }
}

/**
 * Claude Code permission rules letting a worker run the target's checks without asking:
 * "npm run --silent test" -> "Bash(npm run --silent test:*)", plus the usual npm/vitest ones.
 */
export function checkTools(t: Pick<Target, 'checks'> & Partial<Pick<Target, 'install'>>): string[] {
  return [...new Set([
    'Bash(npm test:*)', 'Bash(npm run:*)', 'Bash(npx vitest:*)',
    ...t.checks.map((c) => `Bash(${c.cmd}:*)`),
    ...(t.install ?? []).map((c) => `Bash(${c.cmd}:*)`),
  ])];
}

/** Path prefix of target files inside a worktree of gitRoot ('' or 'sub/dir/'). */
export const subdirPrefix = (t: Target) => (t.subdir ? `${t.subdir}/` : '');
