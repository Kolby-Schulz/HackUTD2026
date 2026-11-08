// Summary-cache hook (docs/spec-additions-summary-tools.md, part C). Owner: agents.
// Claude Code runs it before Read and Bash (agents/worker/hook-settings.json). Models
// don't call get_summary / put_summary on their own, even when asked, so this does both:
//
// - Read of a whole source file, first time this session:
//   - cached summary for the file's current content -> deny the read and hand over the
//     summary instead. A second Read of the file is allowed, so the model can still read
//     it fully, e.g. before editing it.
//   - no summary -> allow the read and cache an outline of the file (exported signatures
//     with their doc comments; no model call) so the next agent gets it.
// - Bash `cat` of source files -> denied, so reads go through Read and this hook.
// - Stop (end of each run): count a cache hit (record_cache_hit + cache_hit saving) for
//   each summary the model worked from without reading the file anyway.
//
// It always exits 0 and never blocks the agent on its own failure.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// The path-only half of the mapper: no parser imports, so this hook stays fast.
import { isSourceFile } from '@contract/mapper/lang';

export interface HookInput {
  session_id: string;
  cwd: string;
  hook_event_name: string;
  tool_name: string;
  tool_input: { file_path?: string; offset?: number; limit?: number; command?: string };
}

/** Per-session, per-file flags. `add` returns true only for the first caller (atomic). */
export interface Markers {
  add(file: string, tag: Tag): boolean;
  has(file: string, tag: Tag): boolean;
  files(tag: Tag): string[];
}
export type Tag = 'read' | 'served' | 'reread' | 'counted';

export interface HookDeps {
  /** The client's getSummary; countHit false while we don't know yet if the summary is used. */
  getSummary(file: string, opts: { countHit: boolean }): Promise<string | undefined>;
  putSummary(file: string, summary: string): Promise<void>;
  readFile(file: string): string | undefined;
  markers: Markers;
}

export type HookOutput = { hookSpecificOutput: Record<string, string> } | undefined;

/** Path relative to the repo dir for a source file (any language the mapper knows) inside it, else undefined. */
export function repoFile(path: string, cwd: string, repoDir: string): string | undefined {
  const rel = relative(repoDir, isAbsolute(path) ? path : resolve(cwd, path));
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return undefined;
  if (/(^|\/)(node_modules|\.git)\//.test(rel) || !isSourceFile(rel)) return undefined;
  return rel;
}

/** Source files a Bash command `cat`s (each `&&`, `;` or `|` segment that starts with cat). */
export function catTargets(command: string, cwd: string, repoDir: string): string[] {
  const out: string[] = [];
  for (const seg of command.split(/&&|\|\||;|\|/)) {
    const words = seg.trim().split(/\s+/);
    if (words[0] !== 'cat') continue;
    for (const w of words.slice(1)) {
      if (w.startsWith('-') || /^\d*[<>]/.test(w)) continue;
      const rel = repoFile(w.replace(/^['"]|['"]$/g, ''), cwd, repoDir);
      if (rel) out.push(rel);
    }
  }
  return out;
}

/**
 * A short outline of a source file: its header comment, then each export's signature with
 * its doc comment; small interface/type bodies are kept whole. Undefined when the file has
 * no exports or the outline wouldn't be much smaller than the file, so for languages other than
 * TS/JS (no `export` lines) the full file is read and nothing is cached.
 */
export function outline(src: string): string | undefined {
  const lines = src.split('\n');
  const out: string[] = [];
  if (lines[0]?.startsWith('//')) out.push(lines[0]);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/^export\s/.test(line)) continue;
    // Doc comment right above: /** ... */ on one or more lines.
    let doc = '';
    if (lines[i - 1]?.trim().endsWith('*/')) {
      let j = i - 1;
      while (j > 0 && !lines[j].includes('/**')) j--;
      doc = lines
        .slice(j, i)
        .join(' ')
        .replace(/\/\*\*|\*\/|^\s*\*|\s\*\s/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }
    if (doc) out.push(`/** ${doc} */`);
    const end = lines.findIndex((l, k) => k > i && /^}/.test(l));
    if (/^export\s+(interface|type)\s/.test(line) && end > i && end - i <= 12) {
      out.push(...lines.slice(i, end + 1));
    } else {
      out.push(line.replace(/\s*\{\s*$/, '').replace(/\s*=\s*$/, ''));
    }
  }
  if (!out.some((l) => l.startsWith('export'))) return undefined;
  const text = out.join('\n');
  return text.length <= src.length * 0.7 ? text : undefined;
}

const pre = (o: Record<string, string>): HookOutput => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', ...o } });

/** Stop: count the summaries that replaced a read. Returns the files counted. */
export async function countHits(deps: HookDeps): Promise<string[]> {
  const m = deps.markers;
  const used = m.files('served').filter((f) => !m.has(f, 'reread') && !m.has(f, 'counted'));
  const counted: string[] = [];
  for (const file of used) {
    if (!m.add(file, 'counted')) continue; // another Stop got it
    // Still hashes the current content: if the file changed since, nothing is counted.
    if ((await deps.getSummary(file, { countHit: true })) !== undefined) counted.push(file);
  }
  return counted;
}

/** The hook's decision for one PreToolUse event. */
export async function decide(input: HookInput, repoDir: string, deps: HookDeps): Promise<HookOutput> {
  const { tool_name, tool_input, hook_event_name, cwd } = input;
  if (hook_event_name !== 'PreToolUse') return undefined;
  const m = deps.markers;

  if (tool_name === 'Bash' && tool_input.command) {
    const files = catTargets(tool_input.command, cwd, repoDir);
    if (!files.length) return undefined;
    return pre({
      permissionDecision: 'deny',
      permissionDecisionReason:
        `Contract: read source files with the Read tool, not cat (${files.join(', ')}), ` +
        'so summaries cached by other agents can be used. Use one Read call per file.',
    });
  }

  if (tool_name !== 'Read' || !tool_input.file_path) return undefined;
  const file = repoFile(tool_input.file_path, cwd, repoDir);
  if (!file) return undefined;
  const whole = tool_input.offset === undefined && tool_input.limit === undefined;
  // Any read after a served summary (whole or partial) means the summary wasn't enough.
  if (m.has(file, 'served')) {
    m.add(file, 'reread');
    return undefined;
  }
  if (!whole || !m.add(file, 'read')) return undefined;

  const summary = await deps.getSummary(file, { countHit: false });
  if (summary !== undefined) {
    m.add(file, 'served');
    return pre({
      permissionDecision: 'deny',
      permissionDecisionReason:
        `Contract: another agent cached a summary of ${file} (matches its current content), so it wasn't read:\n` +
        `${summary}\n` +
        'Work from this summary. If you need the exact text (for example to edit the file), Read it again and it will be allowed.',
    });
  }
  const content = deps.readFile(file);
  const sketch = content === undefined ? undefined : outline(content);
  if (sketch) await deps.putSummary(file, sketch);
  return undefined;
}

/** One marker file per (session, file, tag) under the OS temp dir; 'wx' makes add atomic. */
export function fileMarkers(sessionId: string, root = join(tmpdir(), 'contract-summary-hook')): Markers {
  const dir = join(root, sessionId.replace(/[^\w-]/g, '_'));
  mkdirSync(dir, { recursive: true });
  const name = (file: string, tag: Tag) => join(dir, `${createHash('sha1').update(file).digest('hex')}.${tag}`);
  return {
    add(file, tag) {
      try {
        writeFileSync(name(file, tag), file, { flag: 'wx' });
        return true;
      } catch {
        return false;
      }
    },
    has: (file, tag) => existsSync(name(file, tag)),
    files: (tag) => readdirSync(dir).filter((n) => n.endsWith(`.${tag}`)).map((n) => readFileSync(join(dir, n), 'utf8')),
  };
}

async function main() {
  console.log = console.error; // the SpacetimeDB SDK logs to stdout; stdout is our JSON reply
  const input = JSON.parse(readFileSync(0, 'utf8')) as HookInput;
  const repoDir = process.env.CONTRACT_REPO_DIR ?? input.cwd;

  type Client = Awaited<ReturnType<typeof import('@contract/client').connect>>;
  let clientP: Promise<Client> | undefined;
  const client = () =>
    (clientP ??= import('@contract/client').then(({ connect }) => {
      const agentId = process.env.CONTRACT_AGENT_ID;
      if (!agentId || !process.env.CONTRACT_TOKEN || !process.env.SPACETIME_HOST) throw new Error('not running under a Contract worker');
      return connect({
        host: process.env.SPACETIME_HOST,
        dbName: process.env.SPACETIME_DB_NAME ?? 'contract',
        token: process.env.CONTRACT_TOKEN,
        noHeartbeat: true,
        repoDir,
        agent: { id: agentId, name: agentId, ownerDev: '', machine: '', model: 'claude-code', tokenBudget: 0 },
      });
    }));

  const { estimateTokens } = await import('@contract/client');
  const deps: HookDeps = {
    getSummary: async (file, opts) => (await client()).getSummary(file, opts),
    putSummary: async (file, summary) => (await client()).putSummary(file, summary, estimateTokens(summary)),
    readFile: (file) => {
      try {
        return readFileSync(resolve(repoDir, file), 'utf8');
      } catch {
        return undefined;
      }
    },
    markers: fileMarkers(input.session_id),
  };
  let out: HookOutput;
  if (input.hook_event_name === 'Stop') {
    const counted = await countHits(deps);
    if (counted.length) console.error(`contract summary hook: counted cache hits for ${counted.join(', ')}`);
  } else {
    out = await decide(input, repoDir, deps);
  }
  if (clientP) await (await clientP).disconnect().catch(() => {});
  if (out) process.stdout.write(JSON.stringify(out));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
    .catch((e: unknown) => console.error(`contract summary hook: ${e instanceof Error ? e.message : String(e)}`))
    .finally(() => process.exit(0));
}
