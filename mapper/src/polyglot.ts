// The tree-sitter half of the code mapper: Python, Go, Java, Rust, Ruby, PHP, C#, C/C++
// (every grammar bundled in @vscode/tree-sitter-wasm). TS/JS stay on ts-morph (map.ts);
// this file gives the same row shapes for everything else.
//
// What becomes a symbol (ids "<file>#<name>", methods "<file>#Type.method"):
//   - top-level functions                                        kind 'function'
//   - classes, structs, interfaces, traits, enums, Ruby modules  kind 'class'
//   - their methods (Go receivers, Rust impl blocks, members)    kind 'method'
//   - module-level constants (Python UPPER = ..., Go const,
//     Rust/PHP const, Ruby CONSTANT = ...)                       kind 'const'
// Only the "public" ones: Python no leading _, Go Capitalized, Rust `pub` (or a trait
// impl), Java/C# `public`, PHP not private/protected, Ruby and C/C++ everything.
// Constructors (__init__, initialize, __construct, Java/C# constructors) are part of the
// class signature, like TS.
//
// Signatures are written in the TS shape "name(p: T, q: U): R", whatever the language:
// Python `def fee(amount: int) -> int` -> "fee(amount: int): int", Go `func Fee(a int) int`
// -> "Fee(a: int): int". So Rule 2 (parseSignature / duplicateReason in server/src/rules.ts)
// works unchanged. Untyped params stay bare (parsed as `unknown`); no return type, no ": R".
//
// Edges are APPROXIMATE, by name: each call (and `new X` / X{...}) inside a symbol's body
// resolves to a same-file symbol of that name if there is exactly one, else to a symbol of
// that name in another file of the same language if it is unique there, else is skipped.
// There is no type information, so `a.total()` points at any `total` method.
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Language, Node as TSNode, Parser } from '@vscode/tree-sitter-wasm';
import { grammarFor, type Grammar } from './lang.ts';
import {
  cleanSignature,
  isTsMappable,
  mapFile,
  RepoMapper,
  symbolRanges,
  isPolyMappable,
  listMappableFiles,
  signatureHash,
  type FileMap,
  type MappedEdge,
  type MappedSymbol,
  type SymbolKind,
  type SymbolRange,
} from './map.ts';

// ---------------------------------------------------------------------------------
// Loading grammars (lazy: a hook only pays for the language it touches)
// ---------------------------------------------------------------------------------

type TreeSitter = typeof import('@vscode/tree-sitter-wasm');

const require = createRequire(import.meta.url);
let runtime: Promise<{ ts: TreeSitter; dir: string }> | undefined;
const parsers = new Map<Grammar, Promise<Parser>>();

function loadRuntime(): Promise<{ ts: TreeSitter; dir: string }> {
  runtime ??= (async () => {
    const main = require.resolve('@vscode/tree-sitter-wasm');
    const dir = main.slice(0, main.lastIndexOf(sep) + 1);
    const ts = require('@vscode/tree-sitter-wasm') as TreeSitter;
    await ts.Parser.init({ locateFile: (file: string) => join(dir, file) });
    return { ts, dir };
  })();
  return runtime;
}

function parserFor(grammar: Grammar): Promise<Parser> {
  let p = parsers.get(grammar);
  if (!p) {
    p = (async () => {
      const { ts, dir } = await loadRuntime();
      const lang: Language = await ts.Language.load(join(dir, `tree-sitter-${grammar}.wasm`));
      return new ts.Parser().setLanguage(lang);
    })();
    parsers.set(grammar, p);
  }
  return p;
}

// ---------------------------------------------------------------------------------
// Tree helpers
// ---------------------------------------------------------------------------------

const field = (n: TSNode | null | undefined, name: string): TSNode | undefined => n?.childForFieldName(name) ?? undefined;
const named = (n: TSNode | null | undefined): TSNode[] => (n ? n.namedChildren.filter((c): c is TSNode => c !== null) : []);
const children = (n: TSNode): TSNode[] => n.children.filter((c): c is TSNode => c !== null);
const hasChild = (n: TSNode, type: string) => children(n).some((c) => c.type === type);

/** The last plain name in an identifier-ish node: `a.b.c` -> "c", `Foo::bar` -> "bar", `List<T>` -> "List". */
function simpleName(n: TSNode | undefined): string | undefined {
  if (!n) return undefined;
  if (n.namedChildCount === 0) return n.text.replace(/^\$/, '');
  if (/^generic|^template_type|^parameterized/.test(n.type)) return simpleName(named(n)[0]);
  const next = field(n, 'name') ?? field(n, 'field') ?? field(n, 'attribute') ?? field(n, 'method') ?? n.lastNamedChild ?? undefined;
  return next === n ? undefined : simpleName(next);
}

const stripQuotes = (s: string) => s.replace(/^(['"])(.*)\1$/, '$2');

/** Literal initializers are part of a const's contract (FEE_RATE = 0.03); big expressions aren't. */
function literal(n: TSNode | undefined): string | undefined {
  if (!n) return undefined;
  const t = n.type;
  const isLit =
    /literal|^(integer|float|string|number|true|false|none|nil|null|boolean|encapsed_string)$/.test(t) ||
    (/^unary/.test(t) && named(n).length === 1 && literal(named(n)[0]) !== undefined);
  if (!isLit || n.text.includes('\n') || n.text.length > 60) return undefined;
  if (named(n).some((c) => c.type === 'interpolation')) return undefined;
  return n.text;
}

// ---------------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------------

interface Param {
  name: string;
  type?: string;
}

/** One definition found by a language walker. */
interface Def {
  /** Type name for methods (id "Type.name"). */
  owner?: string;
  name: string;
  kind: SymbolKind;
  signature: string;
  /** Node whose lines are the symbol's range (wrapper with decorators/annotations). */
  span: TSNode;
  /** Subtree whose calls are this symbol's outgoing edges. */
  body?: TSNode;
}

/** "name(p: T, q): R" in the TS shape Rule 2 parses. */
function fnSig(name: string, params: Param[], ret?: string, prefix = ''): string {
  const ps = params.map((p) => (p.type ? `${p.name}: ${p.type}` : p.name));
  return cleanSignature(`${prefix}${name}(${ps.join(', ')})${ret ? `: ${ret}` : ''}`);
}

function constSig(name: string, type: string | undefined, value: TSNode | undefined): string {
  const lit = literal(value);
  return cleanSignature(`const ${name}${type ? `: ${type}` : ''}${lit !== undefined ? ` = ${lit}` : ''}`);
}

function classSig(keyword: string, name: string, extra: string | undefined, ctor: string | undefined): string {
  return cleanSignature(`${keyword} ${name}${extra ? ` ${extra}` : ''}${ctor ? `; ${ctor}` : ''}`);
}

type Walker = (root: TSNode, src: string) => Def[];

// --- Python ---------------------------------------------------------------------------

function pyParams(list: TSNode | undefined, isMethod: boolean): Param[] {
  const out: Param[] = [];
  for (const p of named(list)) {
    const type = field(p, 'type')?.text;
    switch (p.type) {
      case 'identifier':
        out.push({ name: p.text });
        break;
      case 'typed_parameter': {
        const inner = named(p)[0];
        const name = inner?.type === 'identifier' ? inner.text : (inner?.text ?? '_');
        out.push({ name, type });
        break;
      }
      case 'default_parameter':
      case 'typed_default_parameter':
        out.push({ name: field(p, 'name')?.text ?? '_', type });
        break;
      case 'list_splat_pattern':
      case 'dictionary_splat_pattern':
        out.push({ name: p.text });
        break;
      default:
        break; // `*` / `/` separators
    }
  }
  if (isMethod && out.length && (out[0].name === 'self' || out[0].name === 'cls')) out.shift();
  return out;
}

function pyFunction(fn: TSNode, isMethod: boolean): { params: Param[]; ret?: string; prefix: string } {
  const ret = field(fn, 'return_type')?.text;
  return {
    params: pyParams(field(fn, 'parameters'), isMethod),
    ret: ret && stripQuotes(ret),
    prefix: hasChild(fn, 'async') ? 'async ' : '',
  };
}

const pyPublic = (name: string) => !name.startsWith('_');

const python: Walker = (root) => {
  const out: Def[] = [];
  for (const stmt of named(root)) {
    const def = stmt.type === 'decorated_definition' ? field(stmt, 'definition') : stmt;
    if (!def) continue;
    const name = field(def, 'name')?.text;
    if (def.type === 'function_definition' && name && pyPublic(name)) {
      const f = pyFunction(def, false);
      out.push({ name, kind: 'function', signature: fnSig(name, f.params, f.ret, f.prefix), span: stmt, body: field(def, 'body') });
    } else if (def.type === 'class_definition' && name && pyPublic(name)) {
      let ctor: string | undefined;
      for (const m of named(field(def, 'body'))) {
        const fn = m.type === 'decorated_definition' ? field(m, 'definition') : m;
        if (fn?.type !== 'function_definition') continue;
        const mName = field(fn, 'name')?.text ?? '';
        const f = pyFunction(fn, true);
        if (mName === '__init__') ctor = fnSig('__init__', f.params);
        if (!pyPublic(mName)) continue;
        const isStatic = named(m).some((d) => d.type === 'decorator' && /^@?(staticmethod|classmethod)$/.test(d.text.trim()));
        out.push({
          owner: name,
          name: mName,
          kind: 'method',
          signature: fnSig(mName, f.params, f.ret, `${isStatic ? 'static ' : ''}${f.prefix}`),
          span: m,
          body: field(fn, 'body'),
        });
      }
      const bases = field(def, 'superclasses')?.text;
      out.push({ name, kind: 'class', signature: classSig('class', `${name}${bases ?? ''}`, undefined, ctor), span: stmt });
    } else if (stmt.type === 'expression_statement') {
      const a = named(stmt)[0];
      const left = field(a, 'left');
      if (a?.type === 'assignment' && left?.type === 'identifier' && /^[A-Z][A-Z0-9_]*$/.test(left.text)) {
        out.push({ name: left.text, kind: 'const', signature: constSig(left.text, field(a, 'type')?.text, field(a, 'right')), span: stmt });
      }
    }
  }
  return out;
};

// --- Go -------------------------------------------------------------------------------

function goParams(list: TSNode | undefined): Param[] {
  const out: Param[] = [];
  for (const p of named(list)) {
    if (p.type !== 'parameter_declaration' && p.type !== 'variadic_parameter_declaration') continue;
    const type = field(p, 'type')?.text ?? '';
    const t = p.type === 'variadic_parameter_declaration' ? `...${type}` : type;
    const names = p.childrenForFieldName('name').filter((c): c is TSNode => c !== null);
    if (!names.length) out.push({ name: '_', type: t });
    for (const n of names) out.push({ name: n.text, type: t });
  }
  return out;
}

function goResult(result: TSNode | undefined): string | undefined {
  if (!result) return undefined;
  if (result.type !== 'parameter_list') return result.text;
  const types = goParams(result).map((p) => p.type ?? '');
  return types.length === 1 ? types[0] : `(${types.join(', ')})`;
}

const goPublic = (name: string) => /^[A-Z]/.test(name);

const go: Walker = (root) => {
  const out: Def[] = [];
  for (const d of named(root)) {
    if (d.type === 'function_declaration' || d.type === 'method_declaration') {
      const name = field(d, 'name')?.text;
      if (!name || !goPublic(name)) continue;
      const sig = fnSig(name, goParams(field(d, 'parameters')), goResult(field(d, 'result')));
      let owner: string | undefined;
      if (d.type === 'method_declaration') {
        const recv = named(field(d, 'receiver')).find((p) => p.type === 'parameter_declaration');
        owner = simpleName(field(recv, 'type'))?.replace(/^\*/, '');
        if (!owner) continue;
      }
      out.push({ owner, name, kind: owner ? 'method' : 'function', signature: sig, span: d, body: field(d, 'body') });
    } else if (d.type === 'type_declaration') {
      for (const spec of named(d)) {
        if (spec.type !== 'type_spec') continue;
        const name = field(spec, 'name')?.text;
        const kind = field(spec, 'type')?.type;
        if (!name || !goPublic(name) || (kind !== 'struct_type' && kind !== 'interface_type')) continue;
        const tp = field(spec, 'type_parameters')?.text ?? '';
        out.push({ name, kind: 'class', signature: cleanSignature(`type ${name}${tp} ${kind === 'struct_type' ? 'struct' : 'interface'}`), span: d });
      }
    } else if (d.type === 'const_declaration') {
      for (const spec of named(d)) {
        if (spec.type !== 'const_spec') continue;
        const names = spec.childrenForFieldName('name').filter((c): c is TSNode => c !== null);
        const values = named(field(spec, 'value'));
        names.forEach((n, i) => {
          if (goPublic(n.text)) {
            out.push({ name: n.text, kind: 'const', signature: constSig(n.text, field(spec, 'type')?.text, values[i]), span: spec });
          }
        });
      }
    }
  }
  return out;
};

// --- Java and C# ---------------------------------------------------------------------

const JAVA_TYPES = new Set(['class_declaration', 'interface_declaration', 'enum_declaration', 'record_declaration']);
const CS_TYPES = new Set([...JAVA_TYPES, 'struct_declaration', 'record_struct_declaration']);
const typeKeyword = (t: string) => t.replace(/_declaration$/, '').replace(/_struct$/, ' struct');

function javaParams(list: TSNode | undefined): Param[] {
  const out: Param[] = [];
  for (const p of named(list)) {
    if (p.type === 'formal_parameter' || p.type === 'parameter') {
      out.push({ name: field(p, 'name')?.text ?? '_', type: field(p, 'type')?.text });
    } else if (p.type === 'spread_parameter') {
      const decl = named(p).find((c) => c.type === 'variable_declarator');
      const type = named(p).find((c) => c !== decl && c.type !== 'modifiers')?.text;
      out.push({ name: field(decl, 'name')?.text ?? decl?.text ?? '_', type: type && `${type}...` });
    }
  }
  return out;
}

/** Java keeps modifiers in one `modifiers` node; C# has one `modifier` node per keyword. */
const modifierWords = (n: TSNode) =>
  named(n)
    .filter((c) => c.type === 'modifiers' || c.type === 'modifier')
    .flatMap((c) => c.text.split(/\s+/));

function javaLike(types: Set<string>): Walker {
  const walk = (container: TSNode | undefined, out: Def[]) => {
    for (const d of named(container)) {
      if (d.type === 'namespace_declaration' || d.type === 'file_scoped_namespace_declaration') {
        walk(field(d, 'body') ?? d, out);
        continue;
      }
      if (!types.has(d.type)) continue;
      const name = field(d, 'name')?.text;
      if (!name || !modifierWords(d).includes('public')) continue;
      const isInterface = d.type === 'interface_declaration';
      let ctor: string | undefined;
      const body = field(d, 'body');
      const members = [...named(body), ...named(named(body).find((c) => c.type === 'enum_body_declarations'))];
      for (const m of members) {
        if (m.type === 'constructor_declaration' && !ctor) ctor = fnSig('constructor', javaParams(field(m, 'parameters')));
        if (m.type !== 'method_declaration' || !field(m, 'body')) continue; // abstract / interface signatures
        const words = modifierWords(m);
        if (!isInterface && !words.includes('public')) continue;
        const mName = field(m, 'name')?.text;
        if (!mName) continue;
        const ret = (field(m, 'returns') ?? field(m, 'type'))?.text;
        const tp = field(m, 'type_parameters')?.text ?? '';
        const sig = fnSig(`${mName}${tp}`, javaParams(field(m, 'parameters')), ret, words.includes('static') ? 'static ' : '');
        out.push({ owner: name, name: mName, kind: 'method', signature: sig, span: m, body: field(m, 'body') });
      }
      const heritage = [
        field(d, 'type_parameters')?.text,
        field(d, 'superclass')?.text,
        field(d, 'interfaces')?.text,
        named(d).find((c) => c.type === 'base_list' || c.type === 'extends_interfaces')?.text,
      ]
        .filter(Boolean)
        .join(' ');
      out.push({ name, kind: 'class', signature: classSig(typeKeyword(d.type), name, heritage, ctor), span: d });
    }
  };
  return (root) => {
    const out: Def[] = [];
    walk(root, out);
    return out;
  };
}

// --- Rust -----------------------------------------------------------------------------

function rustParams(list: TSNode | undefined): Param[] {
  return named(list)
    .filter((p) => p.type === 'parameter')
    .map((p) => ({ name: field(p, 'pattern')?.text ?? '_', type: field(p, 'type')?.text }));
}

const rustPub = (n: TSNode) => named(n).some((c) => c.type === 'visibility_modifier' && c.text.startsWith('pub'));

function rustFn(fn: TSNode): string {
  const name = field(fn, 'name')?.text ?? '';
  return fnSig(`${name}${field(fn, 'type_parameters')?.text ?? ''}`, rustParams(field(fn, 'parameters')), field(fn, 'return_type')?.text);
}

const RUST_TYPES: Record<string, string> = { struct_item: 'struct', enum_item: 'enum', trait_item: 'trait', union_item: 'union' };

const rust: Walker = (root) => {
  const out: Def[] = [];
  for (const d of named(root)) {
    const name = field(d, 'name')?.text;
    if (d.type === 'function_item' && name && rustPub(d)) {
      out.push({ name, kind: 'function', signature: rustFn(d), span: d, body: field(d, 'body') });
    } else if (RUST_TYPES[d.type] && name && rustPub(d)) {
      out.push({ name, kind: 'class', signature: classSig(RUST_TYPES[d.type], `${name}${field(d, 'type_parameters')?.text ?? ''}`, undefined, undefined), span: d });
    } else if ((d.type === 'const_item' || d.type === 'static_item') && name && rustPub(d)) {
      out.push({ name, kind: 'const', signature: constSig(name, field(d, 'type')?.text, field(d, 'value')), span: d });
    } else if (d.type === 'impl_item') {
      const owner = simpleName(field(d, 'type'));
      const viaTrait = Boolean(field(d, 'trait'));
      if (!owner) continue;
      for (const m of named(field(d, 'body'))) {
        const mName = field(m, 'name')?.text;
        if (m.type !== 'function_item' || !mName || !(viaTrait || rustPub(m))) continue;
        out.push({ owner, name: mName, kind: 'method', signature: rustFn(m), span: m, body: field(m, 'body') });
      }
    }
  }
  return out;
};

// --- Ruby -----------------------------------------------------------------------------

function rubyParams(list: TSNode | undefined): Param[] {
  return named(list).map((p) => {
    const name = field(p, 'name')?.text ?? p.text;
    const prefix = p.type === 'splat_parameter' ? '*' : p.type === 'hash_splat_parameter' ? '**' : p.type === 'block_parameter' ? '&' : '';
    return { name: prefix + name.replace(/^[*&]+/, '') };
  });
}

const ruby: Walker = (root) => {
  const out: Def[] = [];
  const walk = (container: TSNode | undefined, owner: string | undefined) => {
    for (const d of named(container)) {
      if (d.type === 'method' || d.type === 'singleton_method') {
        const name = field(d, 'name')?.text;
        if (!name || (owner && name === 'initialize')) continue;
        const sig = fnSig(name, rubyParams(field(d, 'parameters')), undefined, d.type === 'singleton_method' ? 'static ' : '');
        out.push({ owner, name, kind: owner ? 'method' : 'function', signature: sig, span: d, body: d });
      } else if (d.type === 'class' || d.type === 'module') {
        const name = simpleName(field(d, 'name'));
        if (!name) continue;
        const init = named(field(d, 'body')).find((m) => m.type === 'method' && field(m, 'name')?.text === 'initialize');
        const sup = named(field(d, 'superclass'))[0]?.text;
        out.push({
          name,
          kind: 'class',
          signature: classSig(d.type, name, sup && `extends ${sup}`, init && fnSig('initialize', rubyParams(field(init, 'parameters')))),
          span: d,
        });
        walk(field(d, 'body'), name);
      } else if (!owner && d.type === 'assignment' && field(d, 'left')?.type === 'constant') {
        const name = field(d, 'left')!.text;
        out.push({ name, kind: 'const', signature: constSig(name, undefined, field(d, 'right')), span: d });
      }
    }
  };
  walk(root, undefined);
  return out;
};

// --- PHP ------------------------------------------------------------------------------

function phpParams(list: TSNode | undefined): Param[] {
  return named(list)
    .filter((p) => /parameter$/.test(p.type))
    .map((p) => {
      const name = (field(p, 'name')?.text ?? '_').replace(/^\$/, '');
      return { name: p.type === 'variadic_parameter' ? `...${name}` : name, type: field(p, 'type')?.text };
    });
}

const PHP_TYPES: Record<string, string> = {
  class_declaration: 'class',
  interface_declaration: 'interface',
  trait_declaration: 'trait',
  enum_declaration: 'enum',
};

const php: Walker = (root) => {
  const out: Def[] = [];
  const walk = (container: TSNode | undefined) => {
    for (const d of named(container)) {
      const name = field(d, 'name')?.text;
      if (d.type === 'namespace_definition' && field(d, 'body')) {
        walk(field(d, 'body'));
      } else if (d.type === 'function_definition' && name) {
        out.push({ name, kind: 'function', signature: fnSig(name, phpParams(field(d, 'parameters')), field(d, 'return_type')?.text), span: d, body: field(d, 'body') });
      } else if (PHP_TYPES[d.type] && name) {
        let ctor: string | undefined;
        for (const m of named(field(d, 'body'))) {
          if (m.type !== 'method_declaration') continue;
          const mName = field(m, 'name')?.text;
          if (!mName) continue;
          const params = phpParams(field(m, 'parameters'));
          if (mName === '__construct') {
            ctor = fnSig('__construct', params);
            continue;
          }
          const vis = named(m).find((c) => c.type === 'visibility_modifier')?.text;
          if (vis === 'private' || vis === 'protected' || !field(m, 'body')) continue;
          const prefix = hasChild(m, 'static_modifier') || named(m).some((c) => c.type === 'static_modifier') ? 'static ' : '';
          out.push({ owner: name, name: mName, kind: 'method', signature: fnSig(mName, params, field(m, 'return_type')?.text, prefix), span: m, body: field(m, 'body') });
        }
        const heritage = named(d)
          .filter((c) => c.type === 'base_clause' || c.type === 'class_interface_clause')
          .map((c) => c.text)
          .join(' ');
        out.push({ name, kind: 'class', signature: classSig(PHP_TYPES[d.type], name, heritage, ctor), span: d });
      } else if (d.type === 'const_declaration') {
        for (const el of named(d).filter((c) => c.type === 'const_element')) {
          const [n, value] = named(el);
          if (n) out.push({ name: n.text, kind: 'const', signature: constSig(n.text, undefined, value), span: d });
        }
      }
    }
  };
  walk(root);
  return out;
};

// --- C / C++ ----------------------------------------------------------------------------

const WRAPPING_DECLARATORS = new Set(['pointer_declarator', 'reference_declarator', 'array_declarator', 'parenthesized_declarator', 'attributed_declarator']);

/** pointer_declarator(function_declarator(...)) -> the function_declarator. */
function functionDeclarator(n: TSNode | undefined): TSNode | undefined {
  while (n && WRAPPING_DECLARATORS.has(n.type)) n = field(n, 'declarator') ?? named(n).at(-1);
  return n?.type === 'function_declarator' ? n : undefined;
}

/** The declared name inside a (possibly pointer/array) declarator. */
function declaredName(n: TSNode | undefined): TSNode | undefined {
  while (n && (WRAPPING_DECLARATORS.has(n.type) || n.type === 'init_declarator')) n = field(n, 'declarator') ?? named(n).at(-1);
  return n && /identifier$/.test(n.type) ? n : undefined;
}

function cppParams(list: TSNode | undefined, src: string): Param[] {
  const out: Param[] = [];
  for (const p of named(list)) {
    if (p.type !== 'parameter_declaration' && p.type !== 'optional_parameter_declaration') continue;
    const decl = field(p, 'declarator');
    const name = declaredName(decl);
    const end = field(p, 'default_value') ? field(p, 'default_value')!.startIndex : p.endIndex;
    if (!name) {
      out.push({ name: '_', type: src.slice(p.startIndex, end).replace(/=\s*$/, '').trim() });
      continue;
    }
    const type = (src.slice(p.startIndex, name.startIndex) + src.slice(name.endIndex, end)).replace(/=\s*$/, '');
    out.push({ name: name.text, type: type.trim() });
  }
  return out;
}

const SKIP_BEFORE_TYPE = new Set(['storage_class_specifier', 'attribute_specifier', 'attribute_declaration', 'virtual', 'explicit_function_specifier', 'comment']);

function cppFunction(def: TSNode, src: string): { name: string; scope?: string; sig: string } | undefined {
  const fd = functionDeclarator(field(def, 'declarator'));
  const target = field(fd, 'declarator');
  if (!fd || !target) return undefined;
  let name: string | undefined;
  let scope: string | undefined;
  if (target.type === 'qualified_identifier') {
    name = simpleName(field(target, 'name'));
    scope = simpleName(field(target, 'scope'));
    if (field(target, 'name')?.type !== 'identifier') return undefined; // destructors, operators, nested scopes
  } else if (target.type === 'identifier' || target.type === 'field_identifier') {
    name = target.text;
  }
  if (!name) return undefined;
  const first = children(def).find((c) => c.isNamed && !SKIP_BEFORE_TYPE.has(c.type));
  const ret = first && first.startIndex < fd.startIndex ? src.slice(first.startIndex, fd.startIndex).trim() : undefined;
  return { name, scope, sig: fnSig(name, cppParams(field(fd, 'parameters'), src), ret) };
}

const CPP_CONTAINERS = new Set(['namespace_definition', 'linkage_specification', 'template_declaration', 'preproc_ifdef', 'preproc_if', 'preproc_else', 'preproc_elif', 'declaration_list']);

const cpp: Walker = (root, src) => {
  const out: Def[] = [];
  const classDef = (spec: TSNode, name: string, span: TSNode) => {
    const kw = spec.type === 'class_specifier' ? 'class' : spec.type === 'union_specifier' ? 'union' : 'struct';
    const base = named(spec).find((c) => c.type === 'base_class_clause')?.text;
    out.push({ name, kind: 'class', signature: classSig(kw, name, base, undefined), span });
    for (const m of named(field(spec, 'body'))) {
      const fn = m.type === 'template_declaration' ? named(m).find((c) => c.type === 'function_definition') : m;
      if (fn?.type !== 'function_definition') continue;
      const f = cppFunction(fn, src);
      if (f && f.name !== name) out.push({ owner: name, name: f.name, kind: 'method', signature: f.sig, span: m, body: field(fn, 'body') });
    }
  };
  const walk = (container: TSNode | undefined) => {
    for (const d of named(container)) {
      if (CPP_CONTAINERS.has(d.type)) {
        walk(d.type === 'template_declaration' || d.type.startsWith('preproc') ? d : (field(d, 'body') ?? d));
      } else if (d.type === 'function_definition') {
        const f = cppFunction(d, src);
        if (!f) continue;
        out.push({ owner: f.scope, name: f.name, kind: f.scope ? 'method' : 'function', signature: f.sig, span: d, body: field(d, 'body') });
      } else if (/^(class|struct|union)_specifier$/.test(d.type) && field(d, 'body')) {
        const name = simpleName(field(d, 'name'));
        if (name) classDef(d, name, d);
      } else if (d.type === 'type_definition') {
        const spec = field(d, 'type');
        const name = declaredName(field(d, 'declarator'))?.text;
        if (spec && /^(struct|union|class)_specifier$/.test(spec.type) && field(spec, 'body') && name) classDef(spec, name, d);
      }
    }
  };
  walk(root);
  return out;
};

const WALKERS: Record<Grammar, Walker> = {
  python,
  go,
  java: javaLike(JAVA_TYPES),
  'c-sharp': javaLike(CS_TYPES),
  rust,
  ruby,
  php,
  cpp,
};

// ---------------------------------------------------------------------------------
// Calls (for name-based edges)
// ---------------------------------------------------------------------------------

/** Call-like node types per grammar, with how to get the callee's name. */
const CALLS: Record<Grammar, Record<string, (n: TSNode) => string | undefined>> = {
  python: { call: (n) => simpleName(field(n, 'function')) },
  go: {
    call_expression: (n) => simpleName(field(n, 'function')),
    composite_literal: (n) => simpleName(field(n, 'type')),
  },
  java: {
    method_invocation: (n) => field(n, 'name')?.text,
    object_creation_expression: (n) => simpleName(field(n, 'type')),
  },
  'c-sharp': {
    invocation_expression: (n) => simpleName(field(n, 'function')),
    object_creation_expression: (n) => simpleName(field(n, 'type')),
  },
  rust: {
    call_expression: (n) => simpleName(field(n, 'function')),
    struct_expression: (n) => simpleName(field(n, 'name')),
  },
  ruby: {
    // `Invoice.new(...)` -> Invoice; `calculate_fee(x)` / `obj.total` -> the method name.
    call: (n) => (field(n, 'method')?.text === 'new' ? simpleName(field(n, 'receiver')) : field(n, 'method')?.text),
  },
  php: {
    function_call_expression: (n) => simpleName(field(n, 'function')),
    member_call_expression: (n) => simpleName(field(n, 'name')),
    scoped_call_expression: (n) => simpleName(field(n, 'name')),
    nullsafe_member_call_expression: (n) => simpleName(field(n, 'name')),
    object_creation_expression: (n) => simpleName(named(n).find((c) => c.type !== 'arguments')),
  },
  cpp: {
    call_expression: (n) => simpleName(field(n, 'function')),
    new_expression: (n) => simpleName(field(n, 'type')),
  },
};

function callNames(body: TSNode | undefined, grammar: Grammar): string[] {
  if (!body) return [];
  const table = CALLS[grammar];
  const names = new Set<string>();
  for (const n of body.descendantsOfType(Object.keys(table))) {
    const name = n && table[n.type](n);
    if (name && /^[A-Za-z_]\w*$/.test(name)) names.add(name);
  }
  return [...names];
}

// ---------------------------------------------------------------------------------
// Files -> declarations
// ---------------------------------------------------------------------------------

/** A mapped symbol plus what edges and ranges need. */
interface PolyDecl {
  symbol: MappedSymbol;
  startLine: number;
  endLine: number;
  /** Callee names inside the body (resolved to ids by the repo mapper). */
  calls: string[];
}

const COMMENT_LIKE = /comment|^attribute_item$|^attribute_list$|^annotation$/;

/** First line of a definition, including comments/attributes directly above it (1-based). */
function startLine(span: TSNode): number {
  let row = span.startPosition.row;
  for (let prev = span.previousNamedSibling; prev && COMMENT_LIKE.test(prev.type) && prev.endPosition.row >= row - 1; prev = prev.previousNamedSibling) {
    row = prev.startPosition.row;
  }
  return row + 1;
}

/** Parses `text` as repo file `file` and returns its declarations (empty for unknown languages). */
async function parseDecls(file: string, text: string): Promise<PolyDecl[]> {
  const grammar = grammarFor(file);
  if (!grammar) return [];
  const parser = await parserFor(grammar);
  const tree = parser.parse(text);
  if (!tree) return [];
  try {
    const seen = new Set<string>();
    const out: (PolyDecl & { pos: number; order: number })[] = [];
    for (const d of WALKERS[grammar](tree.rootNode, text)) {
      const idName = d.owner ? `${d.owner}.${d.name}` : d.name;
      const id = `${file}#${idName}`;
      if (seen.has(id)) continue; // overloads, several impl blocks: the first one wins
      seen.add(id);
      out.push({
        symbol: { id, name: d.name, kind: d.kind, signature: d.signature, signatureHash: signatureHash(d.signature), behaviorNote: '' },
        startLine: startLine(d.span),
        endLine: d.span.endPosition.row + 1,
        calls: callNames(d.body, grammar).filter((c) => c !== d.name || d.kind === 'class'),
        pos: d.span.startIndex,
        order: d.kind === 'class' ? 0 : 1,
      });
    }
    return out.sort((a, b) => a.pos - b.pos || a.order - b.order).map(({ pos: _p, order: _o, ...d }) => d);
  } finally {
    tree.delete();
  }
}

const toRel = (root: string, abs: string) => relative(root, abs).split(sep).join('/');

function relIn(repoDir: string, path: string): string {
  const abs = isAbsolute(path) ? path : join(repoDir, path);
  const rel = toRel(repoDir, abs);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`mapper: ${path} is outside ${repoDir}`);
  return rel;
}

/** Same language family for edge resolution (C and C++ share a grammar). */
const sameLanguage = (a: string, b: string) => grammarFor(a) === grammarFor(b);

// ---------------------------------------------------------------------------------
// Repo mapper for tree-sitter languages
// ---------------------------------------------------------------------------------

/**
 * Maps a repo's tree-sitter-language files. Same surface as RepoMapper, but refresh is
 * async (parsing loads wasm). Files are parsed once and cached; edges are resolved by name
 * against every cached file at mapFile time.
 */
export class PolyglotMapper {
  readonly repoDir: string;
  private readonly decls = new Map<string, PolyDecl[]>();
  private byName: Map<string, MappedSymbol[]> | undefined;

  private constructor(repoDir: string) {
    this.repoDir = resolve(repoDir);
  }

  /** Parses every tree-sitter-language file (`files` defaults to listMappableFiles). */
  static async create(repoDir: string, files?: string[]): Promise<PolyglotMapper> {
    const m = new PolyglotMapper(repoDir);
    if (!existsSync(m.repoDir)) throw new Error(`mapper: repo not found: ${m.repoDir}`);
    for (const rel of (files ?? listMappableFiles(m.repoDir)).filter(isPolyMappable)) await m.load(rel);
    return m;
  }

  rel(path: string): string {
    return relIn(this.repoDir, path);
  }

  files(): string[] {
    return [...this.decls.keys()].sort();
  }

  mapFile(path: string): FileMap {
    const file = this.rel(path);
    const decls = this.decls.get(file);
    if (!decls) return { file, symbols: [], edges: [] };
    const edges: MappedEdge[] = [];
    for (const d of decls) {
      const targets = new Set<string>();
      for (const name of d.calls) {
        const id = this.resolveCall(file, name, d.symbol.id);
        if (id) targets.add(id);
      }
      for (const calleeId of [...targets].sort()) edges.push({ callerId: d.symbol.id, calleeId });
    }
    return { file, symbols: decls.map((d) => d.symbol), edges };
  }

  mapAll(): FileMap[] {
    return this.files().map((f) => this.mapFile(f));
  }

  /** Re-reads a file from disk (adding, updating or dropping it). False if not mappable here. */
  async refresh(path: string): Promise<boolean> {
    const file = this.rel(path);
    if (!isPolyMappable(file)) return false;
    if (existsSync(join(this.repoDir, file))) await this.load(file);
    else this.decls.delete(file);
    this.byName = undefined;
    return true;
  }

  /**
   * Files whose calls name a symbol of `path` (so their edges may point into it). Call it
   * before and after refresh, like RepoMapper's, to catch removed and new symbols.
   */
  dependents(path: string): string[] {
    const file = this.rel(path);
    const names = new Set((this.decls.get(file) ?? []).map((d) => d.symbol.name));
    if (!names.size) return [];
    return this.files().filter(
      (f) => f !== file && sameLanguage(f, file) && this.decls.get(f)!.some((d) => d.calls.some((c) => names.has(c))),
    );
  }

  private async load(rel: string): Promise<void> {
    this.decls.set(rel, await parseDecls(rel, readFileSync(join(this.repoDir, rel), 'utf8')));
    this.byName = undefined;
  }

  private resolveCall(file: string, name: string, callerId: string): string | undefined {
    if (!this.byName) {
      this.byName = new Map();
      for (const ds of this.decls.values()) {
        for (const d of ds) if (d.symbol.kind !== 'const') (this.byName.get(d.symbol.name) ?? this.byName.set(d.symbol.name, []).get(d.symbol.name)!).push(d.symbol);
      }
    }
    const candidates = (this.byName.get(name) ?? []).filter((s) => s.id !== callerId);
    const fileOf = (s: MappedSymbol) => s.id.slice(0, s.id.lastIndexOf('#'));
    const local = candidates.filter((s) => fileOf(s) === file);
    if (local.length) return local.length === 1 ? local[0].id : undefined;
    const elsewhere = candidates.filter((s) => sameLanguage(fileOf(s), file));
    return elsewhere.length === 1 ? elsewhere[0].id : undefined;
  }
}

// ---------------------------------------------------------------------------------
// Single files (hooks)
// ---------------------------------------------------------------------------------

/** Symbols of one tree-sitter-language file, parsed alone (no edges). */
export async function mapPolyFile(file: string, text: string): Promise<MappedSymbol[]> {
  if (!isPolyMappable(file)) return [];
  return (await parseDecls(file, text)).map((d) => d.symbol);
}

/** Line spans (1-based, inclusive, with comments/decorators above) of a tree-sitter-language file. */
export async function polySymbolRanges(file: string, text: string): Promise<SymbolRange[]> {
  if (!isPolyMappable(file)) return [];
  return (await parseDecls(file, text)).map((d) => ({ id: d.symbol.id, kind: d.symbol.kind, startLine: d.startLine, endLine: d.endLine }));
}

// ---------------------------------------------------------------------------------
// Any language (async, since tree-sitter's wasm loads asynchronously)
// ---------------------------------------------------------------------------------

/**
 * mapFile for any supported language. TS/JS go to the sync ts-morph mapFile (same result);
 * other languages are parsed with tree-sitter. With edges (the default) the whole repo is
 * mapped to resolve them, so hooks should pass `edges: false`.
 */
export async function mapFileAsync(path: string, opts: { repoDir?: string; edges?: boolean } = {}): Promise<FileMap> {
  const repoDir = resolve(opts.repoDir ?? process.cwd());
  const file = relIn(repoDir, path);
  if (isTsMappable(file)) return mapFile(path, opts);
  if (opts.edges ?? true) return (await createRepoMapper(repoDir)).mapFile(file);
  const abs = join(repoDir, file);
  if (!isPolyMappable(file) || !existsSync(abs)) return { file, symbols: [], edges: [] };
  return { file, symbols: await mapPolyFile(file, readFileSync(abs, 'utf8')), edges: [] };
}

/** symbolRanges for any supported language (`text` is the content of repo file `file`). */
export async function symbolRangesAsync(file: string, text: string): Promise<SymbolRange[]> {
  if (isTsMappable(file)) return symbolRanges(file, text);
  return polySymbolRanges(file, text);
}

/** What the mapper CLI needs from a repo mapper, whatever the languages. */
export interface CodeMapper {
  readonly repoDir: string;
  rel(path: string): string;
  files(): string[];
  mapFile(path: string): FileMap;
  mapAll(): FileMap[];
  /** Re-reads a changed file; false when it isn't a mappable source file. */
  refresh(path: string): Promise<boolean>;
  dependents(path: string): string[];
}

/**
 * Maps a repo in every supported language: TS/JS files through RepoMapper (type-checked
 * edges), the rest through PolyglotMapper (name-based edges). There are no edges between
 * the two groups.
 */
export async function createRepoMapper(repoDir: string): Promise<CodeMapper> {
  const ts = new RepoMapper(repoDir); // checks the repo exists and its size (all languages)
  const poly = await PolyglotMapper.create(ts.repoDir);
  const pick = (rel: string) => (isTsMappable(rel) ? ts : poly);
  const files = () => [...ts.files(), ...poly.files()].sort();
  const mapOne = (path: string) => pick(ts.rel(path)).mapFile(path);
  return {
    repoDir: ts.repoDir,
    rel: (path) => ts.rel(path),
    files,
    mapFile: mapOne,
    mapAll: () => files().map(mapOne),
    refresh: async (path) => {
      const rel = ts.rel(path);
      return isTsMappable(rel) ? ts.refresh(rel) : poly.refresh(rel);
    },
    dependents: (path) => pick(ts.rel(path)).dependents(path),
  };
}
