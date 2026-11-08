// The variant agent's side of git: reads screens and parent sources from dashboard/src/designs, writes a new
// variant folder, typechecks the dashboard and commits only that folder. Code stays in git; SpacetimeDB only
// records that it happened (live.ts).
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';
import type { Files, ScreenInfo } from './generate.ts';

const run = promisify(execFile);

export const designsDir = (repo: string) => join(repo, 'dashboard', 'src', 'designs');

const str = String.raw`'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"`;

/**
 * Title and slots from a screen.tsx. Screens declare them as literals (`title: '…'`, `slots: { id: 'Label', … }`),
 * which the page's README asks for; anything else is reported instead of guessed.
 */
export function parseScreen(id: string, source: string): ScreenInfo {
  const title = new RegExp(String.raw`\btitle:\s*(?:${str})`).exec(source);
  const block = /\bslots:\s*\{([^}]*)\}/.exec(source);
  if (!title || !block) throw new Error(`src/designs/${id}/screen.tsx: no literal title and slots to read`);
  const slots: Record<string, string> = {};
  for (const m of block[1].matchAll(new RegExp(String.raw`([A-Za-z_][\w]*)\s*:\s*(?:${str})`, 'g'))) slots[m[1]] = m[2] ?? m[3];
  if (!Object.keys(slots).length) throw new Error(`src/designs/${id}/screen.tsx: slots is empty`);
  return { id, title: title[1] ?? title[2], slots };
}

export function readScreen(repo: string, screen: string): ScreenInfo {
  const file = join(designsDir(repo), screen, 'screen.tsx');
  if (!existsSync(file)) throw new Error(`no screen "${screen}" in dashboard/src/designs`);
  return parseScreen(screen, readFileSync(file, 'utf8'));
}

export const variantFolders = (repo: string, screen: string): string[] =>
  existsSync(join(designsDir(repo), screen))
    ? readdirSync(join(designsDir(repo), screen), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
    : [];

/**
 * Source files the parent's look comes from: the folders on its `extends` chain, or for a mix, the folders it
 * takes slots from (and their chains). At most `limit` folders, nearest first.
 */
export function parentContext(repo: string, screen: string, parent: string | null, mixSources: (id: string) => string[] | undefined, limit = 4): Record<string, string> {
  const out: Record<string, string> = {};
  const queue = parent ? [parent] : [];
  const seen = new Set<string>();
  while (queue.length && seen.size < limit) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const dir = join(designsDir(repo), screen, id);
    if (!existsSync(dir)) { queue.push(...(mixSources(id) ?? [])); continue; }
    for (const f of readdirSync(dir).filter((f) => /\.(tsx|ts|css)$/.test(f))) {
      const text = readFileSync(join(dir, f), 'utf8');
      out[relative(repo, join(dir, f))] = text;
      const ext = f === 'index.tsx' ? /\bextends:\s*['"]([a-z0-9-]+)['"]/.exec(text) : null;
      if (ext) queue.push(ext[1]);
    }
  }
  return out;
}

export function writeFolder(repo: string, screen: string, id: string, files: Files): string {
  const dir = join(designsDir(repo), screen, id);
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

export const removeFolder = (repo: string, screen: string, id: string) => rmSync(join(designsDir(repo), screen, id), { recursive: true, force: true });

/** Compiler errors in this folder ('' when clean). Errors elsewhere in the dashboard are not this variant's fault. */
export async function typecheck(repo: string, screen: string, id: string): Promise<string> {
  const folder = `src/designs/${screen}/${id}/`;
  try {
    await run('npx', ['tsc', '--noEmit', '-p', 'tsconfig.json'], { cwd: join(repo, 'dashboard'), maxBuffer: 16 << 20 });
    return '';
  } catch (e) {
    const out = String((e as { stdout?: string }).stdout ?? e);
    return out.split('\n').filter((l) => l.includes(folder)).map((l) => l.replace(folder, '')).join('\n');
  }
}

/** Commits only the variant folder (other staged or unstaged work in the checkout is left alone). */
export async function commitFolder(repo: string, screen: string, id: string, message: string): Promise<string> {
  const path = relative(repo, join(designsDir(repo), screen, id));
  await run('git', ['add', '--', path], { cwd: repo });
  await run('git', ['commit', '--only', '-m', message, '--', path], { cwd: repo });
  const { stdout } = await run('git', ['rev-parse', 'HEAD'], { cwd: repo });
  return stdout.trim();
}
