import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catTargets, countHits, decide, fileMarkers, outline, repoFile, type HookDeps, type HookInput, type Markers } from '../src/summary-hook.ts';

function memMarkers(): Markers {
  const set = new Set<string>();
  return {
    add: (f, t) => !set.has(`${t}:${f}`) && !!set.add(`${t}:${f}`),
    has: (f, t) => set.has(`${t}:${f}`),
    files: (t) => [...set].filter((k) => k.startsWith(`${t}:`)).map((k) => k.slice(t.length + 1)),
  };
}

const REPO = '/wt/demo-repo';
const FEES = `${REPO}/src/billing/fees.ts`;
const FEES_SRC = `// Processing fee charged on every order.

/** Fee rate in basis points (250 = 2.5%). */
export const FEE_BPS = 250;

/** Processing fee for an amount, in whole cents. Rounds down to the cent. */
export function calculateFee(amountCents: number): number {
  // Basis points: amount * 250 / 10000 is 2.5% of the amount.
  const raw = (amountCents * FEE_BPS) / 10000;
  // Whole cents only; anything below a cent is dropped.
  return Math.floor(raw);
}
`;

const read = (file_path: string, extra: object = {}): HookInput => ({
  session_id: 's1',
  cwd: REPO,
  hook_event_name: 'PreToolUse',
  tool_name: 'Read',
  tool_input: { file_path, ...extra },
});
const bash = (command: string): HookInput => ({ session_id: 's1', cwd: REPO, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } });

describe('summary hook', () => {
  let cache: Map<string, string>;
  let lookups: string[]; // "file" for uncounted lookups, "file+hit" for counted ones
  let deps: HookDeps;
  const session = () => ({ ...deps, markers: memMarkers() }); // a new agent session, same cache
  beforeEach(() => {
    cache = new Map();
    lookups = [];
    deps = {
      getSummary: async (f, { countHit }) => (lookups.push(countHit ? `${f}+hit` : f), cache.get(f)),
      putSummary: async (f, s) => void cache.set(f, s),
      readFile: (f) => (f === 'src/billing/fees.ts' ? FEES_SRC : undefined),
      markers: memMarkers(),
    };
  });

  it('repoFile keeps source files inside the repo only', () => {
    expect(repoFile(FEES, REPO, REPO)).toBe('src/billing/fees.ts');
    expect(repoFile('src/a.ts', REPO, REPO)).toBe('src/a.ts');
    expect(repoFile('/elsewhere/a.ts', REPO, REPO)).toBeUndefined();
    expect(repoFile(`${REPO}/node_modules/x/index.js`, REPO, REPO)).toBeUndefined();
    expect(repoFile(`${REPO}/README.md`, REPO, REPO)).toBeUndefined();
    // Every language the mapper knows counts as source, not just TS/JS.
    for (const f of ['app/fees.py', 'pkg/fees.go', 'src/Main.java', 'src/lib.rs', 'lib/a.rb', 'src/A.php', 'src/A.cs', 'src/a.cpp', 'src/a.h']) {
      expect(repoFile(f, REPO, REPO), f).toBe(f);
    }
    expect(repoFile('src/types.d.ts', REPO, REPO)).toBeUndefined();
  });

  it('outline keeps the header, doc comments and signatures, not bodies', () => {
    const o = outline(FEES_SRC)!;
    expect(o).toContain('// Processing fee charged on every order.');
    expect(o).toContain('/** Processing fee for an amount, in whole cents. Rounds down to the cent. */');
    expect(o).toContain('export function calculateFee(amountCents: number): number');
    expect(o).not.toContain('Math.floor');
    expect(outline('const x = 1;\n')).toBeUndefined(); // no exports
    expect(outline('def fee(x):\n    return x\n')).toBeUndefined(); // other languages: read in full
  });

  it('on a miss, allows the Read and caches an outline; a later agent is served it', async () => {
    // Act: agent A reads (miss), then agent B in its own session
    const a = await decide(read(FEES), REPO, deps);
    const b = session();
    const served = await decide(read(FEES), REPO, b);

    // Assert
    expect(a).toBeUndefined();
    expect(cache.get('src/billing/fees.ts')).toContain('calculateFee');
    expect(served?.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(served?.hookSpecificOutput.permissionDecisionReason).toMatch(/export function calculateFee/);
    expect(lookups).toEqual(['src/billing/fees.ts', 'src/billing/fees.ts']); // no hit counted yet
  });

  it('counts the hit at Stop only when the file was not read after the summary', async () => {
    // Arrange: a cached summary; agent B is served it and never reads the file
    cache.set('src/billing/fees.ts', 'calculateFee: 2.5%, rounds down.');
    const b = session();
    await decide(read(FEES), REPO, b);

    // Act
    const first = await countHits(b);
    const again = await countHits(b); // a resumed run's second Stop

    // Assert
    expect(first).toEqual(['src/billing/fees.ts']);
    expect(again).toEqual([]);
    expect(lookups.filter((l) => l.endsWith('+hit'))).toEqual(['src/billing/fees.ts+hit']);
  });

  it('counts no hit when the model reads the file anyway (whole or partial)', async () => {
    // Arrange
    cache.set('src/billing/fees.ts', 'calculateFee: 2.5%, rounds down.');
    const whole = session();
    const partial = session();

    // Act
    await decide(read(FEES), REPO, whole);
    const reread = await decide(read(FEES), REPO, whole);
    await decide(read(FEES), REPO, partial);
    await decide(read(FEES, { offset: 1, limit: 5 }), REPO, partial);

    // Assert
    expect(reread).toBeUndefined(); // second read allowed
    expect(await countHits(whole)).toEqual([]);
    expect(await countHits(partial)).toEqual([]);
    expect(lookups.some((l) => l.endsWith('+hit'))).toBe(false);
  });

  it('fileMarkers: add is first-caller-only, files lists by tag, sessions are separate', () => {
    const root = mkdtempSync(join(tmpdir(), 'summary-hook-test-'));
    const m = fileMarkers('s1', root);
    expect([m.add('src/a.ts', 'served'), m.add('src/a.ts', 'served')]).toEqual([true, false]);
    m.add('src/b.ts', 'read');
    expect(m.has('src/a.ts', 'served')).toBe(true);
    expect(m.files('served')).toEqual(['src/a.ts']);
    expect(fileMarkers('s2', root).has('src/a.ts', 'served')).toBe(false);
  });

  it('ignores partial reads and files outside the repo', async () => {
    // Act
    const partial = await decide(read(FEES, { offset: 10, limit: 20 }), REPO, deps);
    const outside = await decide(read('/etc/hosts.ts'), REPO, deps);

    // Assert
    expect([partial, outside]).toEqual([undefined, undefined]);
    expect(lookups).toEqual([]);
  });

  it('denies cat of source files in Bash, allows other commands', async () => {
    // Act
    const cat = await decide(bash('cat src/models.ts src/billing/fees.ts && cat package.json'), REPO, deps);
    const test = await decide(bash('npm test 2>&1 | tail -20'), REPO, deps);

    // Assert
    expect(cat?.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(cat?.hookSpecificOutput.permissionDecisionReason).toMatch(/src\/models.ts, src\/billing\/fees.ts/);
    expect(test).toBeUndefined();
    expect(catTargets('cat -n src/a.ts | head', REPO, REPO)).toEqual(['src/a.ts']);
  });
});
