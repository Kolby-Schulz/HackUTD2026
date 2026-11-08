// Shared helpers across worktrees (issue #15). Used by the worker (on resume) and the MCP
// server (when it hands instructions to the model), so both delivery paths copy. Each agent works in its own worktree, so
// a helper the coordinator tells it to import from another agent ("import formatDate from
// src/format.ts") isn't there until the merge. Before resuming, the worker copies such a
// file in byte-for-byte from the owner's worktree: identical content merges cleanly as
// add/add in git, and the agent can import it instead of writing its own copy.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * demo-repo-relative file paths mentioned in instruction text: `src/x.ts`, `src/x.ts#name`,
 * `demo-repo/src/x.ts`, `./src/x.ts`. Deduplicated, in order of first mention. Paths with
 * `..` segments are ignored so a copy can never leave the worktree.
 */
export function mentionedFiles(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(?<![\w/.-])(?:\.\/|demo-repo\/)?(src\/[\w./-]*?\.tsx?)(?![\w])/g)) {
    const path = m[1]!;
    if (path.split('/').includes('..') || out.includes(path)) continue;
    out.push(path);
  }
  return out;
}

export interface ShareCopy {
  /** demo-repo-relative path, e.g. src/format.ts */
  file: string;
  /** agent whose worktree has the file */
  fromAgent: string;
}

/**
 * Which mentioned files to copy in: missing here, present in another agent's worktree
 * (the first one in `others` order that has it). Never touches a file that exists locally.
 */
export function planCopies(
  text: string,
  existsHere: (file: string) => boolean,
  others: { agentId: string; has: (file: string) => boolean }[],
): ShareCopy[] {
  const copies: ShareCopy[] = [];
  for (const file of mentionedFiles(text)) {
    if (existsHere(file)) continue;
    const from = others.find((o) => o.has(file));
    if (from) copies.push({ file, fromAgent: from.agentId });
  }
  return copies;
}

/** The line added to the resume prompt for each copy. */
export function copyNote(c: ShareCopy): string {
  return `Copied ${c.file} from ${c.fromAgent}'s worktree so you can import it; don't edit it.`;
}

/** A copy made this run: the content written, to refresh it later if left untouched. */
export interface CopiedFile extends ShareCopy {
  content: Buffer;
}

/** demo-repo dir of every other agent worktree under <repo>/.worktrees (merge dirs skipped). */
function otherWorktrees(repo: string, agentId: string): { agentId: string; dir: string }[] {
  const root = join(repo, '.worktrees');
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((id) => id !== agentId && !id.startsWith('merge-'))
    .sort()
    .map((id) => ({ agentId: id, dir: join(root, id, 'demo-repo') }))
    .filter((w) => existsSync(w.dir));
}

/**
 * Copies files the instruction text mentions that are missing in `cwd` (this agent's
 * demo-repo) from other agents' worktrees. Returns what was copied (with the bytes written).
 */
export function copySharedFiles(text: string, repo: string, agentId: string, cwd: string): CopiedFile[] {
  const others = otherWorktrees(repo, agentId);
  const plan = planCopies(
    text,
    (f) => existsSync(join(cwd, f)),
    others.map((o) => ({ agentId: o.agentId, has: (f: string) => existsSync(join(o.dir, f)) })),
  );
  return plan.map((c) => {
    const src = join(others.find((o) => o.agentId === c.fromAgent)!.dir, c.file);
    const dest = join(cwd, c.file);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
    return { ...c, content: readFileSync(dest) };
  });
}

/**
 * Before committing: the owner may have kept editing the helper after we copied it. If our
 * copy is still exactly what we copied, take the owner's current bytes so the merge stays
 * an identical add/add. A copy this agent edited is left alone.
 */
export function refreshCopies(copied: CopiedFile[], repo: string, cwd: string): string[] {
  const refreshed: string[] = [];
  for (const c of copied) {
    const dest = join(cwd, c.file);
    const src = join(repo, '.worktrees', c.fromAgent, 'demo-repo', c.file);
    if (!existsSync(dest) || !existsSync(src) || !readFileSync(dest).equals(c.content)) continue;
    if (readFileSync(src).equals(c.content)) continue;
    copyFileSync(src, dest);
    refreshed.push(c.file);
  }
  return refreshed;
}
