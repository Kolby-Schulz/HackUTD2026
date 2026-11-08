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
//   "base": "origin/main" }. Checks are the commands the merge runs and the commands
//   workers may run without asking. CONTRACT_TEST_CMD overrides a single test command.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
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
    return { gitRoot: monorepo, subdir: 'demo-repo', dir: join(monorepo, 'demo-repo'), demo: true, base: 'origin/main', checks: DEMO_CHECKS, label: 'demo-repo' };
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
  };
}

interface TargetConfig {
  checks?: Record<string, string>;
  base?: string;
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

/** contract.json checks, else CONTRACT_TEST_CMD, else the demo's scripts or `npm test`. */
export function checksFor(dir: string, cfg: TargetConfig, demo: boolean): Check[] {
  if (cfg.checks && Object.keys(cfg.checks).length) return Object.entries(cfg.checks).map(([name, cmd]) => ({ name, cmd }));
  if (process.env.CONTRACT_TEST_CMD) return [{ name: 'tests', cmd: process.env.CONTRACT_TEST_CMD }];
  if (demo) return DEMO_CHECKS;
  const hasNpmTest = (() => {
    try {
      return Boolean((JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }).scripts?.test);
    } catch {
      return false;
    }
  })();
  return hasNpmTest ? [{ name: 'tests', cmd: 'npm test' }] : [];
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
export function checkTools(t: Pick<Target, 'checks'>): string[] {
  return [...new Set(['Bash(npm test:*)', 'Bash(npm run:*)', 'Bash(npx vitest:*)', ...t.checks.map((c) => `Bash(${c.cmd}:*)`)])];
}

/** Path prefix of target files inside a worktree of gitRoot ('' or 'sub/dir/'). */
export const subdirPrefix = (t: Target) => (t.subdir ? `${t.subdir}/` : '');
