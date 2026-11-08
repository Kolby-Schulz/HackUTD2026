// scripts/reset.ts (spec section 14). Owner: dashboard + demo.
// npm run reset -- [--force] [--offline] [--repo <path|git URL>]
//
// Puts everything back so each run starts identically, on the demo or any target repo
// (--repo / CONTRACT_TARGET, issue #18):
//  1. removes the run's worktrees (.worktrees/<id> on agent/* and demo/* branches) and
//     deletes those branches; other worktrees in .worktrees/ are left alone
//  2. restores the target folder (demo-repo/ by default) to its HEAD commit (refuses if it
//     has uncommitted edits, unless --force)
//  3. ends any open run and clears per-run server state (unless --offline). Past runs'
//     rows stay: the scoreboard averages them.
// Keeps .contract/ (baseline token log, saved identities, run results, cloned repos).
import { parseArgs } from 'node:util';
import { resolveTarget, type Target } from '@contract/client';
import { adminConnect, git, log, REPO, resetServerState } from './lib.ts';

const DEMO_BRANCH = /^refs\/heads\/(agent|demo)\//;

export function resetFiles(force = false, target: Target = resolveTarget(REPO, undefined, { clone: false })) {
  // 1. Worktrees + branches, in the monorepo and (if different) the target repo.
  for (const root of new Set([REPO, target.gitRoot])) {
    const entries = git(['worktree', 'list', '--porcelain'], root)
      .split('\n\n')
      .map((block) => ({
        path: /^worktree (.+)$/m.exec(block)?.[1],
        branch: /^branch (.+)$/m.exec(block)?.[1],
      }));
    for (const { path, branch } of entries) {
      if (!path || !branch || !DEMO_BRANCH.test(branch)) continue;
      git(['worktree', 'remove', '--force', path], root);
      log('reset', `removed worktree ${path}`);
    }
    git(['worktree', 'prune'], root);
    const branches = git(['for-each-ref', '--format=%(refname)', 'refs/heads/agent', 'refs/heads/demo'], root).split('\n').filter(Boolean);
    for (const ref of branches) {
      git(['branch', '-D', ref.replace('refs/heads/', '')], root);
      log('reset', `deleted branch ${ref.replace('refs/heads/', '')}${root === REPO ? '' : ` in ${target.label}`}`);
    }
  }

  // 2. The target folder back to the committed starting point.
  const dirty = targetChanges(target);
  if (dirty) {
    const where = target.subdir ? `${target.subdir}/` : `${target.label} (whole repo)`;
    if (!force) {
      throw new Error(`${where} has uncommitted changes; commit them or rerun with --force to discard:\n${dirty}`);
    }
    const path = target.subdir || '.';
    git(['restore', '--source=HEAD', '--staged', '--worktree', '--', path], target.gitRoot);
    // Untracked only; node_modules is ignored and the local lockfile excluded, so both stay.
    git(['clean', '-fd', '-e', 'package-lock.json', '--', path], target.gitRoot);
    log('reset', `restored ${where} to HEAD`);
  }
}

/** Uncommitted changes in the target folder, ignoring a local `npm install` lockfile. */
export function targetChanges(target: Target = resolveTarget(REPO, undefined, { clone: false })): string {
  const path = target.subdir || '.';
  return git(['status', '--porcelain', '--', path, `:!${target.subdir ? `${target.subdir}/` : ''}package-lock.json`], target.gitRoot);
}

/** The demo's name for targetChanges() (run-demo checks demo-repo before a run). */
export const demoRepoChanges = () => targetChanges(resolveTarget(REPO, ''));

export async function resetRuns() {
  const conn = await adminConnect(['SELECT * FROM run']);
  const ended = await resetServerState(conn);
  log('reset', ended.length ? `ended open run(s) ${ended.join(', ')}` : 'no open run');
  log('reset', 'cleared code map, plans, claims and pending instructions');
  conn.disconnect();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({
    options: { force: { type: 'boolean', default: false }, offline: { type: 'boolean', default: false }, repo: { type: 'string' } },
  });
  try {
    resetFiles(values.force, resolveTarget(REPO, values.repo, { clone: false }));
    if (!values.offline) await resetRuns();
  } catch (e) {
    console.error(`[reset] ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
  process.exit(0);
}
