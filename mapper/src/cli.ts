// Code mapper CLI (spec section 9).
//   npm run mapper -- [--repo ../demo-repo] [--watch] [--dry-run [--json]]
// --repo     repo to map (relative to the cwd, which is mapper/ under `npm run mapper`);
//            default: CONTRACT_TARGET (issue #18), else the monorepo's demo-repo/.
//            --watch holds the "mapper" service lock: one watching mapper per database.
// --watch    keep running and re-map files as they change (plus the files importing them).
//            A big batch of changes (a `git checkout`, a pull) re-maps the whole repo instead.
// --dry-run  print the map instead of sending it; --json prints it as JSON.
// Connects to SPACETIME_HOST / SPACETIME_DB_NAME from the monorepo's .env.
//
// TS/JS: .ts/.tsx/.js/.jsx/.mjs/.cjs files are mapped (ES module exports; CommonJS
// module.exports is not), and tsconfig `paths` aliases resolve, from the root
// tsconfig.json or, in a monorepo without one, from the packages' own tsconfig.json files.
// Python, Go, Java, Rust, Ruby, PHP, C# and C/C++ are mapped with tree-sitter
// (src/polyglot.ts); their edges are name-based and approximate.
// Repos over CONTRACT_MAPPER_MAX_FILES source files (default 5000) are refused: point
// --repo at a subfolder instead.
// Tests and tooling folders (test/, tests/, __tests__/, scripts/) are never mapped unless the
// repo's contract.json says so: "map": { "include": ["scripts"], "exclude": ["demo-repo"] }.
//
// Run ONE mapper, against the main demo-repo checkout. Never point it at a worker's
// worktree: the code map is shared, and agents' in-progress edits reach it through
// report_change (contract-hook), not through the mapper.
import { config as loadEnv } from 'dotenv';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { hostname } from 'node:os';
import { watch } from 'chokidar';
import { holdService, resolveTarget } from '@contract/client';
import { isMappable, SKIP_DIRS, type FileMap } from './map.ts';
import { createRepoMapper } from './polyglot.ts';
import { MapSync, type Upsert } from './sync.ts';

const MONOREPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
loadEnv({ path: resolve(MONOREPO, '.env'), quiet: true });

const DEBOUNCE_MS = 150;
/** While a burst is still arriving (a checkout writes many files), wait longer for it to end. */
const BURST_DEBOUNCE_MS = 1000;
/** A batch this big is re-mapped as a whole repo instead of file by file. */
const REBUILD_THRESHOLD = 50;

const log = (msg: string) => console.log(`[mapper] ${msg}`);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function describe(u: Upsert, before: Map<string, string>): string {
  if (!u.symbols.length) return `${u.file}: removed from the code map`;
  const bumped = u.symbols.filter((s) => before.has(s.id) && before.get(s.id) !== s.signatureHash).map((s) => s.name);
  const added = u.symbols.filter((s) => !before.has(s.id)).map((s) => s.name);
  const parts = [`${plural(u.symbols.length, 'symbol')}, ${plural(u.edges.length, 'edge')}`];
  if (added.length && before.size) parts.push(`new: ${added.join(', ')}`);
  if (bumped.length) parts.push(`signature changed: ${bumped.join(', ')}`);
  return `${u.file}: ${parts.join('; ')}`;
}

async function pushAll(sync: MapSync, maps: FileMap[]): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (const m of maps) {
    const before = new Map(sync.serverSymbols(m.file).map((s) => [s.id, s.signatureHash]));
    try {
      const u = await sync.push(m);
      if (u) {
        sent++;
        log(describe(u, before));
      }
    } catch (e) {
      failed++;
      console.error(`[mapper] ${m.file}: upsert_symbols failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { sent, failed };
}

/**
 * Pushes a full map of the repo: every local file, plus empty maps for files the server
 * still has but the repo no longer does (deleted, or left over from an earlier repo state),
 * so they are cleared. Used at startup and when watch mode rebuilds after a big change.
 */
async function pushSnapshot(sync: MapSync, maps: FileMap[], dbName: string): Promise<{ sent: number; failed: number }> {
  const local = new Set(maps.map((m) => m.file));
  const stale: FileMap[] = [...sync.serverFiles()].filter((f) => !local.has(f)).map((file) => ({ file, symbols: [], edges: [] }));
  const result = await pushAll(sync, [...maps, ...stale]);
  log(`sent ${plural(result.sent, 'file')} to ${dbName} (${maps.length + stale.length - result.sent - result.failed} unchanged)`);
  return result;
}

function printMaps(maps: FileMap[], json: boolean): void {
  if (json) {
    console.log(JSON.stringify(maps, null, 2));
    return;
  }
  for (const m of maps) {
    console.log(m.file);
    for (const s of m.symbols) console.log(`  ${s.kind.padEnd(8)} ${s.id}  ${s.signature}`);
    for (const e of m.edges) console.log(`    ${e.callerId} -> ${e.calleeId}`);
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      repo: { type: 'string' },
      watch: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
    },
  });
  // --repo, else CONTRACT_TARGET, else demo-repo (issue #18).
  const repoDir = values.repo ? resolve(values.repo) : resolveTarget(MONOREPO).dir;
  if (`${repoDir}${sep}`.includes(`${sep}.worktrees${sep}`)) {
    throw new Error(`refusing to map a worker worktree (${repoDir}); point --repo at the main demo-repo`);
  }

  let mapper = await createRepoMapper(repoDir);
  const maps = mapper.mapAll();
  const nSymbols = maps.reduce((n, m) => n + m.symbols.length, 0);
  const nEdges = maps.reduce((n, m) => n + m.edges.length, 0);
  log(`${repoDir}: ${plural(maps.length, 'file')}, ${plural(nSymbols, 'symbol')}, ${plural(nEdges, 'edge')}`);

  if (values['dry-run']) {
    printMaps(maps, values.json);
    return;
  }

  const host = process.env.SPACETIME_HOST;
  const dbName = process.env.SPACETIME_DB_NAME;
  if (!host || !dbName) throw new Error('SPACETIME_HOST and SPACETIME_DB_NAME must be set (see .env.example)');

  const sync = await MapSync.connect({
    host,
    dbName,
    onDisconnect: (reason) => {
      console.error(`[mapper] disconnected from ${host}: ${reason}`);
      process.exit(1);
    },
  });

  // A watching mapper is a singleton per database (issue #19): two laptops both watching
  // would overwrite each other's code map. One-shot mapping (session start) needs no lock.
  const lock = values.watch
    ? await holdService(sync.reducers, 'mapper', process.env.CONTRACT_MACHINE || hostname(), (why) => {
        console.error(`[mapper] lost the mapper lock (${why}); stopping`);
        process.exit(1);
      }).catch((e: unknown) => {
        sync.close();
        throw e;
      })
    : undefined;

  const first = await pushSnapshot(sync, maps, dbName);

  if (!values.watch) {
    sync.close();
    if (first.failed) process.exitCode = 1;
    return;
  }

  // Watch mode: batch events (trailing debounce), handle batches one at a time.
  let pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let queue = Promise.resolve();

  const handleBatch = async (paths: string[]) => {
    const rels = paths.map((p) => mapper.rel(p)).filter(isMappable);
    if (!rels.length) return;
    if (rels.length > REBUILD_THRESHOLD) {
      // A checkout or pull: per-file updates would be slow and see half-written states.
      log(`${plural(rels.length, 'file')} changed at once; re-mapping the whole repo`);
      mapper = await createRepoMapper(repoDir);
      await pushSnapshot(sync, mapper.mapAll(), dbName);
      return;
    }
    const targets = new Set(rels);
    for (const f of rels) for (const d of mapper.dependents(f)) targets.add(d); // before: deleted files' importers
    for (const f of rels) await mapper.refresh(f);
    for (const f of rels) for (const d of mapper.dependents(f)) targets.add(d); // after: new importers
    await pushAll(
      sync,
      [...targets].sort().map((f) => mapper.mapFile(f)),
    );
  };

  const onEvent = (path: string) => {
    pending.add(path);
    clearTimeout(timer);
    timer = setTimeout(() => {
      const batch = [...pending];
      pending = new Set();
      queue = queue.then(() => handleBatch(batch)).catch((e) => console.error(`[mapper] watch: ${String(e)}`));
    }, pending.size > REBUILD_THRESHOLD ? BURST_DEBOUNCE_MS : DEBOUNCE_MS);
  };

  const watcher = watch(repoDir, {
    ignoreInitial: true,
    ignored: (path, stats) => {
      if (path === repoDir) return false;
      const name = path.slice(path.lastIndexOf(sep) + 1);
      if (SKIP_DIRS.has(name) || name.startsWith('.')) return true;
      return Boolean(stats?.isFile()) && !isMappable(mapper.rel(path));
    },
  });
  watcher.on('add', onEvent).on('change', onEvent).on('unlink', onEvent);
  watcher.on('error', (e) => console.error(`[mapper] watch error: ${String(e)}`));
  watcher.on('ready', () => log(`watching ${repoDir} (Ctrl-C to stop)`));

  const stop = async () => {
    await watcher.close();
    await queue;
    await lock?.release();
    sync.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((e) => {
  console.error(`[mapper] ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
