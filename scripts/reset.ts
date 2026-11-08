// scripts/reset.ts (spec section 14). Owner: dashboard + demo.
// npm run reset -- [--force] [--offline]
//
// Puts everything back so each demo starts identically:
//  1. removes the demo worktrees (.worktrees/<id> on agent/* and demo/* branches) and
//     deletes those branches; other worktrees in .worktrees/ are left alone
//  2. restores demo-repo/ to HEAD (refuses if it has uncommitted edits, unless --force)
//  3. ends any open run (unless --offline). Past runs' rows stay: the scoreboard averages them.
// Keeps .contract/ (baseline token log, saved identities, run results).
import { parseArgs } from 'node:util';
import { adminConnect, endOpenRuns, git, log } from './lib.ts';

const DEMO_BRANCH = /^refs\/heads\/(agent|demo)\//;

export function resetFiles(force = false) {
  // 1. Worktrees + branches.
  const entries = git(['worktree', 'list', '--porcelain'])
    .split('\n\n')
    .map((block) => ({
      path: /^worktree (.+)$/m.exec(block)?.[1],
      branch: /^branch (.+)$/m.exec(block)?.[1],
    }));
  for (const { path, branch } of entries) {
    if (!path || !branch || !DEMO_BRANCH.test(branch)) continue;
    git(['worktree', 'remove', '--force', path]);
    log('reset', `removed worktree ${path}`);
  }
  git(['worktree', 'prune']);
  const branches = git(['for-each-ref', '--format=%(refname)', 'refs/heads/agent', 'refs/heads/demo']).split('\n').filter(Boolean);
  for (const ref of branches) {
    git(['branch', '-D', ref.replace('refs/heads/', '')]);
    log('reset', `deleted branch ${ref.replace('refs/heads/', '')}`);
  }

  // 2. demo-repo back to the committed starting point.
  const dirty = demoRepoChanges();
  if (dirty) {
    if (!force) {
      throw new Error(`demo-repo/ has uncommitted changes; commit them or rerun with --force to discard:\n${dirty}`);
    }
    git(['restore', '--source=HEAD', '--staged', '--worktree', '--', 'demo-repo']);
    // Untracked only; node_modules is ignored and the local lockfile excluded, so both stay.
    git(['clean', '-fd', '-e', 'package-lock.json', '--', 'demo-repo']);
    log('reset', 'restored demo-repo/ to HEAD');
  }
}

/** Uncommitted changes in demo-repo/, ignoring a local `npm install` lockfile. */
export function demoRepoChanges(): string {
  return git(['status', '--porcelain', '--', 'demo-repo', ':!demo-repo/package-lock.json']);
}

export async function resetRuns() {
  const conn = await adminConnect(['SELECT * FROM run']);
  const ended = await endOpenRuns(conn);
  log('reset', ended.length ? `ended open run(s) ${ended.join(', ')}` : 'no open run');
  conn.disconnect();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({
    options: { force: { type: 'boolean', default: false }, offline: { type: 'boolean', default: false } },
  });
  try {
    resetFiles(values.force);
    if (!values.offline) await resetRuns();
  } catch (e) {
    console.error(`[reset] ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
  process.exit(0);
}
