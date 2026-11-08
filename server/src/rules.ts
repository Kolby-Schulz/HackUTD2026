// Pure helpers for Rule 2 (duplicate implementation, spec section 8). No SpacetimeDB
// imports, so they are unit-tested directly and run unchanged inside reducers.
//
// Two symbols are duplicates when either:
//   (a) their normalized names are equal: lowercase, split on case/_/-, verbs dropped
//       (getInvoice ~ makeInvoice ~ invoice), or
//   (b) both signatures are known, parameter types and return type are identical, and the
//       names share at least one meaningful token (formatDate ~ dateToString).

/** Verbs and connectives that don't change what a helper is about. */
const VERBS = new Set([
  'get',
  'make',
  'create',
  'build',
  'compute',
  'calc',
  'calculate',
  'fetch',
  'do',
  'to',
  'as',
]);

/** The function name in a symbol id: "src/a.ts#Class.method" -> "method". */
export function nameOf(symbolId: string): string {
  const afterHash = symbolId.slice(symbolId.lastIndexOf('#') + 1);
  return afterHash.slice(afterHash.lastIndexOf('.') + 1);
}

/** "toDisplayDate" -> ["to","display","date"]; "date_to_string" -> ["date","to","string"]. */
export function nameTokens(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_\-.$]+/)
    .map((w) => w.toLowerCase())
    .filter(Boolean);
}

/** Lowercase, separators stripped, verbs dropped. "" when only verbs remain. */
export function normalizeName(name: string): string {
  return nameTokens(name)
    .filter((w) => !VERBS.has(w))
    .join('');
}

export interface ParsedSignature {
  params: string[];
  returns: string;
}

/** Splits on commas that are not nested inside <>, (), [] or {}. */
function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const isArrow = ch === '>' && s[i - 1] === '='; // "=>" is not a closing bracket
    if ('<([{'.includes(ch)) depth++;
    if (')]}'.includes(ch) || (ch === '>' && !isArrow)) depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

const squash = (type: string) => type.replace(/\s+/g, '');

/** "number = 0" -> "number", but "(x: number) => string" is left alone. */
function stripDefault(type: string): string {
  const m = /=(?!>)/.exec(type);
  return m ? type.slice(0, m.index) : type;
}

/**
 * Parses "formatDate(d: Date, opts?: Opts): string" into parameter types and return type.
 * Undefined when there is no parameter list or no return type annotation.
 */
export function parseSignature(signature: string): ParsedSignature | undefined {
  const open = signature.indexOf('(');
  if (open < 0) return undefined;
  let depth = 0;
  let close = -1;
  for (let i = open; i < signature.length; i++) {
    if (signature[i] === '(') depth++;
    if (signature[i] === ')' && --depth === 0) {
      close = i;
      break;
    }
  }
  if (close < 0) return undefined;
  const ret = signature.slice(close + 1).trim();
  if (!ret.startsWith(':')) return undefined;
  const returns = squash(ret.slice(1));
  if (!returns) return undefined;
  const params = splitTopLevel(signature.slice(open + 1, close)).map((p) => {
    const colon = p.indexOf(':');
    const type = colon >= 0 ? p.slice(colon + 1) : 'unknown';
    return squash(stripDefault(type));
  });
  return { params, returns };
}

/** Why `a` duplicates `b`, or undefined. Signatures are optional; without both, only names count. */
export function duplicateReason(
  a: { name: string; signature?: string },
  b: { name: string; signature?: string },
): string | undefined {
  const na = normalizeName(a.name);
  const nb = normalizeName(b.name);
  if (na && na === nb) return `same normalized name '${na}'`;

  if (!a.signature || !b.signature) return undefined;
  const sa = parseSignature(a.signature);
  const sb = parseSignature(b.signature);
  if (!sa || !sb) return undefined;
  const sameTypes = sa.returns === sb.returns && sa.params.join(',') === sb.params.join(',');
  if (!sameTypes) return undefined;
  const tb = new Set(nameTokens(b.name).filter((w) => !VERBS.has(w)));
  const shared = nameTokens(a.name).find((w) => !VERBS.has(w) && tb.has(w));
  return shared ? `same types (${sa.params.join(', ')}) => ${sa.returns} and shared name '${shared}'` : undefined;
}
