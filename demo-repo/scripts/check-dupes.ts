// Fails if src/ has more than one date-formatting function (spec section 14, planted
// conflict 2). Agents must not edit this file.
//
// A function counts as a date formatter if its body uses a date-formatting API
// (toLocaleDateString, Intl.DateTimeFormat, getMonth, ...) or its name says it formats a
// date (formatDate, toDisplayDate, dateToString, ...). Only the innermost match counts,
// so a receipt that calls formatDate is not a second formatter, but a receipt that
// formats the date inline is. A thin wrapper whose body only returns a call to another
// date formatter (`function formatDueDate(d) { return formatOrderDate(d); }`) is an alias
// of that helper, not a second formatter.
//
// npx tsx scripts/check-dupes.ts [srcDir]   (default: src next to this script)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(process.argv[2] ?? join(ROOT, 'src'));

const DATE_API = /\b(toLocaleDateString|toLocaleString|toDateString|DateTimeFormat|get(UTC)?Month)\b|['"`]Jan['"`]\s*,\s*['"`]Feb/;
const DATE_NAME = (name: string) => /date|day/i.test(name) && /format|display|string|pretty|human|label|text/i.test(name);

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return tsFiles(path);
    return /\.tsx?$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry) ? [path] : [];
  });
}

function nameOf(node: ts.Node): string {
  if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name) return node.name.getText();
  const parent = node.parent;
  if (parent && (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent))) {
    return parent.name.getText();
  }
  return '<anonymous>';
}

const isFunction = (node: ts.Node) =>
  ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node);

/** `return otherFormatter(...)` (or an arrow returning that call) with no date API in the arguments. */
function isThinWrapper(node: ts.Node, name: string, source: ts.SourceFile): boolean {
  if (!(ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node))) return false;
  let expr: ts.Expression | undefined;
  if (node.body && ts.isBlock(node.body)) {
    const [only, ...rest] = node.body.statements;
    if (rest.length || !only || !ts.isReturnStatement(only)) return false;
    expr = only.expression;
  } else if (node.body) {
    expr = node.body as ts.Expression;
  }
  while (expr && ts.isParenthesizedExpression(expr)) expr = expr.expression;
  if (!expr || !ts.isCallExpression(expr) || !ts.isIdentifier(expr.expression)) return false;
  const callee = expr.expression.text;
  return callee !== name && DATE_NAME(callee) && !expr.arguments.some((a) => DATE_API.test(a.getText(source)));
}

interface Found { file: string; name: string; line: number }
const found: Found[] = [];

for (const file of tsFiles(SRC)) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  // Returns true if this node or anything inside it was counted as a formatter.
  const visit = (node: ts.Node): boolean => {
    let inner = false;
    node.forEachChild((child) => { inner = visit(child) || inner; });
    if (!isFunction(node) || inner) return inner;
    const name = nameOf(node);
    if (isThinWrapper(node, name, source)) return false;
    if (DATE_NAME(name) || DATE_API.test(node.getText(source))) {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      found.push({ file: relative(ROOT, file), name, line });
      return true;
    }
    return false;
  };
  visit(source);
}

for (const f of found) console.log(`  ${f.file}:${f.line}  ${f.name}`);
if (found.length > 1) {
  console.error(`check-dupes: FAIL, ${found.length} date formatters (want at most 1). Reuse one helper.`);
  process.exit(1);
}
console.log(`check-dupes: ok, ${found.length} date formatter${found.length === 1 ? '' : 's'}`);
