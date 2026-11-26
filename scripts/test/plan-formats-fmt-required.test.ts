import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// EXF-748: the formatter argument of packages/schema stays optional (it defaults to
// DEFAULT_FORMATTER, i.e. US dollars and MM/DD/YYYY). A screen or service that calls such a
// function without passing the plan's formatter would silently show the default format.
// The list of functions is derived from the source; the calls are found with the TypeScript
// compiler's AST, so multi-line calls, nested calls and comments or strings cannot fool it.
const root = new URL("../..", import.meta.url).pathname;
const SCHEMA_SRC = join(root, "packages/schema/src");
const SCAN = ["apps/web/src", "apps/worker/src"].map((d) => join(root, d));

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(p);
  }
  return out;
}

const parse = (file: string) =>
  ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

const isExported = (n: ts.Node) =>
  ts.canHaveModifiers(n) &&
  (ts.getModifiers(n) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

const defaultsToFormatter = (p: ts.ParameterDeclaration) =>
  !!p.initializer && ts.isIdentifier(p.initializer) && p.initializer.text === "DEFAULT_FORMATTER";

/** Exported functions (declarations and const arrows) whose last parameter defaults to DEFAULT_FORMATTER. */
function formatterFunctions(): Map<string, { arity: number; file: string }> {
  const found = new Map<string, { arity: number; file: string }>();
  for (const file of walk(SCHEMA_SRC)) {
    if (file.endsWith("plan-formats.ts")) continue;
    const consider = (name: string, fn: ts.SignatureDeclaration) => {
      const last = fn.parameters[fn.parameters.length - 1];
      if (last && defaultsToFormatter(last))
        found.set(name, { arity: fn.parameters.length, file: relative(root, file) });
    };
    for (const st of parse(file).statements) {
      if (!isExported(st)) continue;
      if (ts.isFunctionDeclaration(st) && st.name) consider(st.name.text, st);
      else if (ts.isVariableStatement(st))
        for (const d of st.declarationList.declarations)
          if (
            ts.isIdentifier(d.name) &&
            d.initializer &&
            (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))
          )
            consider(d.name.text, d.initializer);
    }
  }
  return found;
}

/** Calls (and bare references, e.g. `.map(reportMoney)`) that cannot pass the formatter. */
function formatterlessUses(
  files: string[],
  fns: Map<string, { arity: number; file: string }>,
): string[] {
  const bad: string[] = [];
  for (const file of files) {
    const sf = parse(file);
    const at = (n: ts.Node) => {
      const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
      return `${relative(root, file)}:${line + 1}: ${n.getText(sf).split("\n")[0]}`;
    };
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n)) {
        const c = n.expression;
        const name = ts.isIdentifier(c)
          ? c.text
          : ts.isPropertyAccessExpression(c)
            ? c.name.text
            : null;
        const fn = name ? fns.get(name) : undefined;
        const spread = n.arguments.some(ts.isSpreadElement);
        if (fn && !spread && n.arguments.length < fn.arity) bad.push(at(n));
      } else if (
        ts.isIdentifier(n) &&
        fns.has(n.text) &&
        n.parent &&
        !ts.isImportSpecifier(n.parent) &&
        !ts.isExportSpecifier(n.parent) &&
        !(ts.isCallExpression(n.parent) && n.parent.expression === n) &&
        !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n) &&
        !(ts.isPropertyAssignment(n.parent) && n.parent.name === n) &&
        !(ts.isFunctionDeclaration(n.parent) && n.parent.name === n) &&
        !(ts.isVariableDeclaration(n.parent) && n.parent.name === n) &&
        !ts.isParameter(n.parent) &&
        !ts.isTypeQueryNode(n.parent) // `typeof fn` in a type is not a use
      ) {
        bad.push(`${at(n)}  (passed as a value: it will be called without the formatter)`);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return bad;
}

describe("EXF-748: formatter-defaulting functions are always given the plan's formatter", () => {
  const fns = formatterFunctions();

  it("finds the formatter-defaulting functions in packages/schema/src", () => {
    const names = [...fns.keys()].sort();
    console.log(`${names.length} functions found: ${names.join(", ")}`);
    expect(names).toEqual(
      expect.arrayContaining(["formatAmountEntry", "formatEntryDate", "reportMoney"]),
    );
    expect(names.length).toBeGreaterThanOrEqual(25);
  });

  it("no file under apps/web/src or apps/worker/src calls one without a formatter", () => {
    const files = SCAN.flatMap((d) => walk(d));
    expect(files.length).toBeGreaterThan(50);
    expect(formatterlessUses(files, fns)).toEqual([]);
  });
});
