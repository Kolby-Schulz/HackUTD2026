// The parser half of the code mapper (spec section 9): repo files -> symbol + edge rows.
// No server code here, so the mapper CLI, contract-hook and tests all share it.
//
// What becomes a symbol (ids are "<file>#<name>", methods "<file>#Class.method"; <file>
// is relative to the repo root with forward slashes, so the same file in a worktree
// gets the same ids):
//   - exported function declarations                       kind 'function'
//   - exported top-level consts initialised with an arrow
//     or function expression (export const f = () => ...)  kind 'function'
//   - other exported top-level consts                       kind 'const'
//   - exported classes                                      kind 'class'
//   - their methods (static too, and arrow-function
//     properties; not getters/setters or #private names)   kind 'method'
// Interfaces, type aliases, enums, let/var and re-exports are not symbols.
//
// Signatures are the declaration's own text with the body removed and whitespace
// collapsed: "calculateFee(amount: number, rate: number): number". Nothing is inferred
// from the type checker, so a symbol's signature (and hash) only changes when its own
// declaration changes, never because something it calls changed. Rule 2's type match
// needs a written return type; un-annotated returns are left out.
//
// Edges: every value reference inside a symbol's body that resolves (through imports,
// re-exports and namespace imports) to another mapped symbol: calls, `new`, methods,
// and functions passed as values (`items.map(formatLine)`). Type-only references
// (`x: Invoice`, `implements`, `typeof`) are not edges.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Node, Project, SyntaxKind, ts, type SourceFile } from 'ts-morph';

export type SymbolKind = 'function' | 'class' | 'method' | 'const';

/** One symbol row as upsert_symbols takes it (camelCase, like the generated bindings). */
export interface MappedSymbol {
  id: string;
  name: string;
  kind: SymbolKind;
  signature: string;
  signatureHash: string;
  /** Always '' from the mapper; agents fill it through report_change (spec section 9). */
  behaviorNote: string;
}

export interface MappedEdge {
  callerId: string;
  calleeId: string;
}

/** Everything upsert_symbols needs for one file. */
export interface FileMap {
  file: string;
  symbols: MappedSymbol[];
  edges: MappedEdge[];
}

// ---------------------------------------------------------------------------------
// Signatures
// ---------------------------------------------------------------------------------

/** Removes // and /* *\/ comments, leaving string and template literals untouched. */
function stripComments(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1;
      while (j < s.length && s[j] !== ch) j += s[j] === '\\' ? 2 : 1;
      out += s.slice(i, j + 1);
      i = j;
    } else if (ch === '/' && s[i + 1] === '/') {
      while (i < s.length && s[i] !== '\n') i++;
      out += ' ';
    } else if (ch === '/' && s[i + 1] === '*') {
      const end = s.indexOf('*/', i + 2);
      i = end < 0 ? s.length : end + 1;
      out += ' ';
    } else {
      out += ch;
    }
  }
  return out;
}

/** Display form: comments removed, whitespace collapsed, no trailing commas. */
export function cleanSignature(text: string): string {
  return stripComments(text)
    .replace(/\s+/g, ' ')
    .replace(/[,;]\s*([)>\]}])/g, (m, close: string) => {
      if (close === '}') return ' }'; // `{ a: number; }` / `{ a, }` -> `{ a: number }`
      return m.startsWith(';') ? m : close; // `(a, b,)` -> `(a, b)`
    })
    .replace(/([(<[])\s+/g, '$1')
    .replace(/\s+([)>\]])/g, '$1')
    .trim();
}

/**
 * Hash form: also drops every space, so pure formatting changes (line breaks, trailing
 * commas, a last `;` in a type literal) never count as a signature change.
 */
export function normalizeSignature(signature: string): string {
  return cleanSignature(signature).replace(/\s+/g, '');
}

/**
 * signature_hash: first 16 hex chars of sha256 over the normalized signature. Works on
 * text alone, so anything holding a signature string (contract-hook, a reducer handling
 * report_change's new_signature) can compute the same hash.
 */
export function signatureHash(signature: string): string {
  return createHash('sha256').update(normalizeSignature(signature)).digest('hex').slice(0, 16);
}

type FunctionLikeNode = Node & {
  getTypeParameters(): Node[];
  getParameters(): Node[];
  getReturnTypeNode(): Node | undefined;
};

function isFunctionLike(n: Node): n is FunctionLikeNode {
  return (
    Node.isFunctionDeclaration(n) ||
    Node.isMethodDeclaration(n) ||
    Node.isArrowFunction(n) ||
    Node.isFunctionExpression(n) ||
    Node.isConstructorDeclaration(n)
  );
}

function isAsync(n: Node): boolean {
  return Node.isAsyncable(n) && n.isAsync();
}

/** "name<T>(a: A, b = 1): R" from a function-like node (async prefix kept). */
function functionSignature(name: string, fn: FunctionLikeNode): string {
  const typeParams = fn.getTypeParameters().map((p) => p.getText());
  const params = fn.getParameters().map((p) => p.getText());
  const ret = fn.getReturnTypeNode()?.getText();
  return cleanSignature(
    `${isAsync(fn) ? 'async ' : ''}${name}${typeParams.length ? `<${typeParams.join(', ')}>` : ''}(${params.join(', ')})${
      ret ? `: ${ret}` : ''
    }`,
  );
}

/** Overloads are part of the interface: one signature per overload, joined with "; ". */
function overloadedSignature(name: string, impl: FunctionLikeNode, overloads: Node[]): string {
  if (!overloads.length) return functionSignature(name, impl);
  return overloads.map((o) => functionSignature(name, o as FunctionLikeNode)).join('; ');
}

/** Arrow / function expression behind an initializer, looking through parens, `as`, `satisfies`, `!`. */
function functionInitializer(init: Node | undefined): FunctionLikeNode | undefined {
  let n = init;
  while (
    n &&
    (Node.isParenthesizedExpression(n) || Node.isAsExpression(n) || Node.isSatisfiesExpression(n) || Node.isNonNullExpression(n))
  ) {
    n = n.getExpression();
  }
  return n && (Node.isArrowFunction(n) || Node.isFunctionExpression(n)) ? n : undefined;
}

/** Literal initializers are part of a const's contract (FEE_RATE = 0.03); big objects aren't. */
function literalText(init: Node | undefined): string | undefined {
  if (!init) return undefined;
  if (
    Node.isNumericLiteral(init) ||
    Node.isStringLiteral(init) ||
    Node.isNoSubstitutionTemplateLiteral(init) ||
    Node.isTrueLiteral(init) ||
    Node.isFalseLiteral(init) ||
    Node.isNullLiteral(init) ||
    (Node.isPrefixUnaryExpression(init) && Node.isNumericLiteral(init.getOperand()))
  ) {
    return init.getText();
  }
  return undefined;
}

// ---------------------------------------------------------------------------------
// Declarations -> symbols
// ---------------------------------------------------------------------------------

/** A symbol plus the nodes that are its declaration and its body (for edges). */
interface Decl {
  symbol: MappedSymbol;
  /** Nodes the type checker returns as this symbol's declaration(s). */
  declNodes: Node[];
  /** Subtrees whose references are this symbol's outgoing edges. */
  bodies: Node[];
  /** Subtrees inside `bodies` that belong to another symbol (a class's methods). */
  exclude: Node[];
}

function makeSymbol(file: string, idName: string, name: string, kind: SymbolKind, signature: string): MappedSymbol {
  return { id: `${file}#${idName}`, name, kind, signature, signatureHash: signatureHash(signature), behaviorNote: '' };
}

function classSignature(name: string, cls: Node): string {
  if (!Node.isClassDeclaration(cls)) return `class ${name}`;
  const typeParams = cls.getTypeParameters().map((p) => p.getText());
  const heritage = cls.getHeritageClauses().map((h) => h.getText());
  const ctor = cls.getConstructors()[0];
  const ctorSig = ctor ? `; ${functionSignature('constructor', ctor as unknown as FunctionLikeNode)}` : '';
  return cleanSignature(
    `${cls.isAbstract() ? 'abstract ' : ''}class ${name}${typeParams.length ? `<${typeParams.join(', ')}>` : ''}${
      heritage.length ? ` ${heritage.join(' ')}` : ''
    }${ctorSig}`,
  );
}

function memberPrefix(m: Node): string {
  return Node.isStaticable(m) && m.isStatic() ? 'static ' : '';
}

/**
 * Local names exported by an export list (`export { a, b as c }`, no `from`) or by
 * `export default a`. Read from syntax, not the type checker, so hook mode stays fast
 * and both modes agree on what is exported.
 */
function exportListNames(sf: SourceFile): Set<string> {
  const names = new Set<string>();
  for (const ed of sf.getExportDeclarations()) {
    if (ed.getModuleSpecifier() || ed.isTypeOnly()) continue;
    for (const spec of ed.getNamedExports()) if (!spec.isTypeOnly()) names.add(spec.getNameNode().getText());
  }
  for (const ea of sf.getExportAssignments()) {
    const e = ea.getExpression();
    if (!ea.isExportEquals() && Node.isIdentifier(e)) names.add(e.getText());
  }
  return names;
}

function collectDecls(sf: SourceFile, file: string): Decl[] {
  const listed = exportListNames(sf);
  const exported = (stmt: { hasExportKeyword(): boolean }, name: string | undefined) =>
    stmt.hasExportKeyword() || (name !== undefined && listed.has(name));
  const out: Decl[] = [];
  const seen = new Set<string>();
  const push = (d: Decl) => {
    if (seen.has(d.symbol.id)) return; // e.g. two `export const` of one name in a broken file
    seen.add(d.symbol.id);
    out.push(d);
  };

  for (const stmt of sf.getStatements()) {
    if (Node.isFunctionDeclaration(stmt)) {
      if (!exported(stmt, stmt.getName()) || !stmt.getBody()) continue; // overload signatures come via the implementation
      const name = stmt.getName() ?? 'default';
      push({
        symbol: makeSymbol(file, name, name, 'function', overloadedSignature(name, stmt as unknown as FunctionLikeNode, stmt.getOverloads())),
        declNodes: [stmt, ...stmt.getOverloads()],
        bodies: [stmt],
        exclude: [],
      });
    } else if (Node.isClassDeclaration(stmt)) {
      if (!exported(stmt, stmt.getName())) continue;
      const className = stmt.getName() ?? 'default';
      const methodNodes: Node[] = [];
      for (const member of stmt.getMembers()) {
        let fn: FunctionLikeNode | undefined;
        let declNodes: Node[] = [member];
        if (Node.isMethodDeclaration(member)) {
          if (!member.getBody()) continue; // overload signature or abstract
          fn = member as unknown as FunctionLikeNode;
          declNodes = [member, ...member.getOverloads()];
        } else if (Node.isPropertyDeclaration(member)) {
          fn = functionInitializer(member.getInitializer());
        }
        if (!fn) continue;
        const nameNode = (member as Node & { getNameNode(): Node }).getNameNode();
        if (Node.isPrivateIdentifier(nameNode) || Node.isComputedPropertyName(nameNode)) continue;
        const name = nameNode.getText();
        const sig =
          memberPrefix(member) +
          (Node.isMethodDeclaration(member) ? overloadedSignature(name, fn, member.getOverloads()) : functionSignature(name, fn));
        methodNodes.push(member, ...declNodes);
        push({
          symbol: makeSymbol(file, `${className}.${name}`, name, 'method', sig),
          declNodes,
          bodies: [member],
          exclude: [],
        });
      }
      push({
        symbol: makeSymbol(file, className, className, 'class', classSignature(className, stmt)),
        declNodes: [stmt],
        bodies: [stmt],
        exclude: methodNodes,
      });
    } else if (Node.isVariableStatement(stmt)) {
      if (stmt.getDeclarationKind() !== 'const') continue;
      for (const decl of stmt.getDeclarations()) {
        const nameNode = decl.getNameNode();
        if (!Node.isIdentifier(nameNode)) continue; // destructuring
        const name = nameNode.getText();
        if (!exported(stmt, name)) continue;
        const init = decl.getInitializer();
        const fn = functionInitializer(init);
        let symbol: MappedSymbol;
        if (fn) {
          symbol = makeSymbol(file, name, name, 'function', functionSignature(name, fn));
        } else {
          const type = decl.getTypeNode()?.getText();
          const literal = literalText(init);
          symbol = makeSymbol(
            file,
            name,
            name,
            'const',
            cleanSignature(`const ${name}${type ? `: ${type}` : ''}${literal !== undefined ? ` = ${literal}` : ''}`),
          );
        }
        push({ symbol, declNodes: [decl], bodies: init ? [init] : [], exclude: [] });
      }
    }
  }
  // Classes are pushed after their methods; put each class before its methods for readability.
  return out.sort((a, b) => a.declNodes[0].getStart() - b.declNodes[0].getStart() || kindOrder(a) - kindOrder(b));
}

const kindOrder = (d: Decl) => (d.symbol.kind === 'class' ? 0 : 1);

// ---------------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------------

/** True when `id` sits in a type position (or an `implements` clause) below `root`. */
function inTypePosition(id: Node, root: Node): boolean {
  for (let n: Node | undefined = id.getParent(); n && n !== root; n = n.getParent()) {
    if (ts.isTypeNode(n.compilerNode) && !Node.isExpressionWithTypeArguments(n)) return true;
    if (Node.isHeritageClause(n) && n.getToken() === SyntaxKind.ImplementsKeyword) return true;
    if (Node.isTypeAliasDeclaration(n) || Node.isInterfaceDeclaration(n)) return true;
  }
  return false;
}

function isWithin(n: Node, roots: Node[]): boolean {
  return roots.some((r) => n.getPos() >= r.getPos() && n.getEnd() <= r.getEnd() && n.getSourceFile() === r.getSourceFile());
}

/** ts.Node -> symbol id, for every mapped declaration in the project. */
type DeclIndex = Map<ts.Node, string>;

function referencedIds(decl: Decl, index: DeclIndex, checker: ts.TypeChecker): Set<string> {
  const ids = new Set<string>();
  for (const body of decl.bodies) {
    for (const id of body.getDescendantsOfKind(SyntaxKind.Identifier)) {
      if (decl.exclude.length && isWithin(id, decl.exclude)) continue;
      if (inTypePosition(id, body)) continue;
      const parent = id.getParent();
      let sym: ts.Symbol | undefined =
        parent && Node.isShorthandPropertyAssignment(parent)
          ? checker.getShorthandAssignmentValueSymbol(parent.compilerNode)
          : checker.getSymbolAtLocation(id.compilerNode);
      // Follow imports / re-exports to the real declaration.
      for (let hops = 0; sym && sym.flags & ts.SymbolFlags.Alias && hops < 10; hops++) {
        sym = checker.getAliasedSymbol(sym);
      }
      for (const d of sym?.getDeclarations() ?? []) {
        const target = index.get(d);
        if (target && target !== decl.symbol.id) ids.add(target);
      }
    }
  }
  return ids;
}

// ---------------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------------

export const SKIP_DIRS: ReadonlySet<string> = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', '.contract', '.worktrees']);

/**
 * Folders that hold tests and tooling, not app code. Their helpers (test fixtures,
 * demo-repo's check-dupes script) would clutter the shared code map and could trip
 * Rule 2 with false duplicates, so they are never mapped.
 */
const NON_SOURCE_DIRS: ReadonlySet<string> = new Set(['test', 'tests', '__tests__', 'scripts']);

/** Whether a repo-relative path is app source the mapper maps (not tests, tooling, configs or .d.ts). */
export function isMappable(relPath: string): boolean {
  const parts = relPath.split(/[\\/]/);
  if (parts.some((p) => SKIP_DIRS.has(p) || NON_SOURCE_DIRS.has(p))) return false;
  const base = parts[parts.length - 1];
  if (!/\.(ts|tsx|mts|cts)$/.test(base) || /\.d\.[mc]?ts$/.test(base)) return false;
  if (/\.(test|spec)\.[mc]?tsx?$/.test(base)) return false;
  if (/\.config\.[mc]?tsx?$/.test(base)) return false; // vitest.config.ts and friends
  return true;
}

function walk(dir: string, root: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) walk(join(dir, entry.name), root, out);
    } else if (entry.isFile()) {
      const rel = toRel(root, join(dir, entry.name));
      if (isMappable(rel)) out.push(rel);
    }
  }
}

const toRel = (root: string, abs: string) => relative(root, abs).split(sep).join('/');

function newProject(repoDir: string): Project {
  const tsConfigFilePath = join(repoDir, 'tsconfig.json');
  if (existsSync(tsConfigFilePath)) return new Project({ tsConfigFilePath, skipAddingFilesFromTsConfig: true });
  return new Project({
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      allowImportingTsExtensions: true,
      strict: true,
      noEmit: true,
    },
  });
}

/**
 * Maps one repo. Keeps a ts-morph Project so watch mode can re-map single files cheaply;
 * call refresh() for a file that changed on disk before mapping it again.
 */
export class RepoMapper {
  readonly repoDir: string;
  private readonly project: Project;
  private index: DeclIndex | undefined;

  constructor(repoDir: string) {
    this.repoDir = resolve(repoDir);
    if (!existsSync(this.repoDir)) throw new Error(`mapper: repo not found: ${this.repoDir}`);
    this.project = newProject(this.repoDir);
    const files: string[] = [];
    walk(this.repoDir, this.repoDir, files);
    for (const rel of files) this.project.addSourceFileAtPath(join(this.repoDir, rel));
  }

  /** Repo-relative path ("src/billing/fees.ts") for an absolute or relative path. */
  rel(path: string): string {
    const abs = isAbsolute(path) ? path : join(this.repoDir, path);
    const rel = toRel(this.repoDir, abs);
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`mapper: ${path} is outside ${this.repoDir}`);
    return rel;
  }

  /** Repo-relative paths of every mapped file, sorted. */
  files(): string[] {
    return this.sourceFiles()
      .map((sf) => toRel(this.repoDir, sf.getFilePath()))
      .sort();
  }

  /** Symbols and outgoing edges of one file (empty if the file isn't mapped). */
  mapFile(path: string): FileMap {
    const file = this.rel(path);
    const sf = this.project.getSourceFile(join(this.repoDir, file));
    if (!sf || !isMappable(file)) return { file, symbols: [], edges: [] };
    return this.mapSource(sf, file);
  }

  /** Every mapped file, in path order. */
  mapAll(): FileMap[] {
    return this.files().map((f) => this.mapFile(f));
  }

  /**
   * Re-reads a file from disk (adding it if new, dropping it if deleted). Returns false
   * when the path isn't a mappable source file.
   */
  refresh(path: string): boolean {
    const file = this.rel(path);
    if (!isMappable(file)) return false;
    const abs = join(this.repoDir, file);
    const sf = this.project.getSourceFile(abs);
    if (!existsSync(abs)) {
      if (sf) this.project.removeSourceFile(sf);
    } else if (sf) {
      sf.refreshFromFileSystemSync();
    } else {
      this.project.addSourceFileAtPath(abs);
    }
    this.index = undefined;
    return true;
  }

  /**
   * Mapped files that import `path` (directly or through re-exports). Their edges point
   * into `path`, so watch mode re-maps them too when its symbols are renamed or appear.
   */
  dependents(path: string): string[] {
    const file = this.rel(path);
    const sf = this.project.getSourceFile(join(this.repoDir, file));
    if (!sf) {
      // Deleted: any file whose import specifiers mention it may now resolve differently.
      const stem = file.replace(/\.[mc]?tsx?$/, '');
      const base = stem.slice(stem.lastIndexOf('/') + 1);
      return this.files().filter((f) =>
        this.project
          .getSourceFileOrThrow(join(this.repoDir, f))
          .getImportDeclarations()
          .some((i) => i.getModuleSpecifierValue().replace(/\.[mc]?[jt]sx?$/, '').endsWith(base)),
      );
    }
    const out = new Set<string>();
    const queue = [sf];
    while (queue.length) {
      const cur = queue.pop()!;
      for (const ref of cur.getReferencingSourceFiles()) {
        const rel = toRel(this.repoDir, ref.getFilePath());
        if (!isMappable(rel) || rel === file || out.has(rel)) continue;
        out.add(rel);
        // A barrel that re-exports `path` passes it on to its own importers.
        if (ref.getExportDeclarations().length) queue.push(ref);
      }
    }
    return [...out].sort();
  }

  private sourceFiles(): SourceFile[] {
    return this.project.getSourceFiles().filter((sf) => isMappable(toRel(this.repoDir, sf.getFilePath())));
  }

  private declIndex(): DeclIndex {
    if (this.index) return this.index;
    const index: DeclIndex = new Map();
    for (const sf of this.sourceFiles()) {
      for (const d of collectDecls(sf, toRel(this.repoDir, sf.getFilePath()))) {
        for (const n of d.declNodes) index.set(n.compilerNode, d.symbol.id);
      }
    }
    this.index = index;
    return index;
  }

  private mapSource(sf: SourceFile, file: string): FileMap {
    const decls = collectDecls(sf, file);
    const index = this.declIndex();
    const checker = this.project.getTypeChecker().compilerObject;
    const edges: MappedEdge[] = [];
    for (const d of decls) {
      for (const calleeId of [...referencedIds(d, index, checker)].sort()) edges.push({ callerId: d.symbol.id, calleeId });
    }
    return { file, symbols: decls.map((d) => d.symbol), edges };
  }
}

/**
 * Maps a single file of `repoDir` (default: cwd). For contract-hook: pass `edges: false`
 * to parse only that file (fast, no type checker) when only signatures are needed.
 */
export function mapFile(path: string, opts: { repoDir?: string; edges?: boolean } = {}): FileMap {
  const repoDir = resolve(opts.repoDir ?? process.cwd());
  if (opts.edges ?? true) return new RepoMapper(repoDir).mapFile(path);
  const abs = isAbsolute(path) ? path : join(repoDir, path);
  const file = toRel(repoDir, abs);
  if (file.startsWith('..') || isAbsolute(file)) throw new Error(`mapper: ${path} is outside ${repoDir}`);
  if (!isMappable(file) || !existsSync(abs)) return { file, symbols: [], edges: [] };
  const project = new Project({ skipFileDependencyResolution: true, skipLoadingLibFiles: true, compilerOptions: { noEmit: true } });
  const sf = project.addSourceFileAtPath(abs);
  return { file, symbols: collectDecls(sf, file).map((d) => d.symbol), edges: [] };
}
