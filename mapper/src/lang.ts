// Which files are source, and in which language. No parser imports, so hooks that only need
// the path checks (the summary-cache hook runs before every Read) load this in a few ms:
//   import { isSourceFile } from '@contract/mapper/lang';

/** TypeScript / JavaScript, mapped by ts-morph (map.ts). */
export const TS_SOURCE = /\.[mc]?[jt]sx?$/;

/** Every other language, mapped with tree-sitter (polyglot.ts): extension -> grammar. */
export const POLY_GRAMMARS: Readonly<Record<string, Grammar>> = {
  '.py': 'python',
  '.go': 'go',
  '.java': 'java',
  '.rs': 'rust',
  '.rb': 'ruby',
  '.php': 'php',
  '.cs': 'c-sharp',
  // No separate C grammar is bundled; the C++ one parses C fine for declarations.
  '.c': 'cpp',
  '.h': 'cpp',
  '.cc': 'cpp',
  '.cpp': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.hh': 'cpp',
};

export type Grammar = 'python' | 'go' | 'java' | 'rust' | 'ruby' | 'php' | 'c-sharp' | 'cpp';

/** Display names for languages, by grammar. */
export const LANGUAGE_NAMES: Readonly<Record<Grammar | 'typescript', string>> = {
  typescript: 'TypeScript/JavaScript',
  python: 'Python',
  go: 'Go',
  java: 'Java',
  rust: 'Rust',
  ruby: 'Ruby',
  php: 'PHP',
  'c-sharp': 'C#',
  cpp: 'C/C++',
};

const ext = (path: string) => {
  const base = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot).toLowerCase() : '';
};

/** The tree-sitter grammar for a path, or undefined for TS/JS and unknown files. */
export function grammarFor(path: string): Grammar | undefined {
  return POLY_GRAMMARS[ext(path)];
}

/**
 * Whether a path is source code in a language the mapper knows, by extension only (no
 * test/tooling-folder rules; that's isMappable). .d.ts and minified bundles are not source.
 */
export function isSourceFile(path: string): boolean {
  const base = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
  if (TS_SOURCE.test(base)) return !/\.d\.[mc]?ts$/.test(base) && !/\.min\.[mc]?js$/.test(base);
  return grammarFor(base) !== undefined;
}

/** Per-language test-file conventions (the shared test/ tests/ folders are excluded elsewhere). */
const TEST_FILES: RegExp[] = [
  /(^|\/)test_[^/]*\.py$/,
  /_test\.py$/,
  /(^|\/)conftest\.py$/,
  /_test\.go$/,
  /Tests?\.java$/,
  /Tests?\.cs$/,
  /_(spec|test)\.rb$/,
  /Test\.php$/,
  /_(unit)?test\.(c|cc|cpp|cxx)$/,
  /(^|\/)src\/test\//,
  /(^|\/)spec\//,
];

/** True for test files of the tree-sitter languages (TS/JS tests are handled in map.ts). */
export function isPolyTestFile(relPath: string): boolean {
  const p = relPath.replace(/\\/g, '/');
  return TEST_FILES.some((re) => re.test(p));
}
