// scripts/judge.ts: the "judge types a task" agent (issue #29). Owner: dashboard + demo.
//   npm run judge -- [--id agent-judge] [--max-minutes 6] [--max-output-tokens 20000]
//                    [--allow-paths src/,tests/] [--repo …]
//
// Keeps one agent waiting for tasks typed into the dashboard's "Judge task" box and runs
// each one as a normal with_contract worker (mapper context, rules, conflicts, coordinator),
// with guard rails so a live demo can't wreck itself:
//   - a wall-clock limit and an output-token budget (the task is discarded when hit);
//   - edits only under --allow-paths (the PreToolUse guard refuses anything else);
//   - a fresh worktree for every task (no leftovers from the previous judge's task).
// Needs an open run (`npm run session -- start`) and the coordinator running somewhere.
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { resolveTarget, worktreeDir } from '@contract/client';
import { run } from './merge.ts';
import { git, log, REPO } from './lib.ts';

const { values } = parseArgs({
  options: {
    id: { type: 'string', default: 'agent-judge' },
    'max-minutes': { type: 'string', default: '6' },
    'max-output-tokens': { type: 'string', default: '20000' },
    'allow-paths': { type: 'string', default: 'src/,tests/' },
    repo: { type: 'string' },
    once: { type: 'boolean', default: false },
  },
});
const id = values.id!;
const target = resolveTarget(REPO, values.repo);

/** The worker refuses to reuse a worktree cleanly; give each judge task a fresh one. */
function freshWorktree() {
  const dir = worktreeDir(REPO, target, id);
  if (existsSync(dir)) git(['worktree', 'remove', '--force', dir], target.gitRoot);
  try {
    git(['branch', '-D', `agent/${id}`], target.gitRoot);
  } catch { /* no branch yet */ }
}

log('judge', `${id} ready: ≤ ${values['max-minutes']} min, ≤ ${values['max-output-tokens']} output tokens, edits only in ${values['allow-paths']} (${target.label})`);
for (;;) {
  freshWorktree();
  const args = [
    'run', 'worker', '--', '--id', id, '--wait', '--no-push',
    '--max-minutes', values['max-minutes']!, '--max-output-tokens', values['max-output-tokens']!, '--allow-paths', values['allow-paths']!,
    ...(values.repo ? ['--repo', values.repo] : []),
  ];
  const r = await run(id, 'npm', args, REPO, 24 * 3600_000, { CONTRACT_MACHINE: process.env.CONTRACT_MACHINE ?? 'judge' });
  log('judge', r.exitCode === 0 ? 'task done; waiting for the next one' : r.exitCode === 3 ? 'task stopped by a guard rail; waiting for the next one' : `worker exited ${r.exitCode}; restarting`);
  if (values.once) break;
  await new Promise((res) => setTimeout(res, 2000));
}
process.exit(0);
