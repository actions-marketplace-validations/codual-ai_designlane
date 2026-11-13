/** A React Native app's JavaScript and TypeScript files, each parsed once by TypeScript's own parser. */

import ts from "typescript";
import { isTestPath } from "../scan/test-paths.js";
import type { ScanContext } from "./plugin.js";

export interface JsSource {
  rel: string;
  text: string;
  /** The parsed file: syntax only, nothing type-checked. */
  file: ts.SourceFile;
  /** Imports from `react-native` (or a package built on it, `react-native-web`). */
  reactNative: boolean;
}

/** `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs` and `.cjs`; type declarations (`.d.ts`) hold no values. */
const SCRIPT = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const DECLARATIONS = /\.d\.[cm]?ts$/;
/** Stories and generated or bundled output aren't the app's own code. */
const NOT_APP = /(?:\.stories\.[jt]sx?$|(?:^|\/)(?:dist|build|coverage|vendor|__generated__)\/|\.min\.js$)/;
const RN_IMPORT = /^react-native(?:-web)?$/;

/** Every non-test script file, read and parsed once. */
export async function jsSources(ctx: ScanContext): Promise<JsSource[]> {
  const out: JsSource[] = [];
  for (const f of ctx.files) {
    if (!SCRIPT.test(f.rel) || DECLARATIONS.test(f.rel) || NOT_APP.test(f.rel) || isTestPath(f.rel)) continue;
    const text = await ctx.read(f);
    if (!text) continue;
    const file = ts.createSourceFile(f.rel, text, ts.ScriptTarget.Latest, true, scriptKind(f.rel));
    out.push({ rel: f.rel, text, file, reactNative: importsReactNative(file) });
  }
  return out;
}

/** JSX is allowed in every `.js` file, as React Native's own tooling allows it. */
function scriptKind(rel: string): ts.ScriptKind {
  if (rel.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (/\.[cm]?ts$/.test(rel)) return ts.ScriptKind.TS;
  return ts.ScriptKind.JSX;
}

function importsReactNative(file: ts.SourceFile): boolean {
  return file.statements.some(
    (s) =>
      ts.isImportDeclaration(s) &&
      ts.isStringLiteral(s.moduleSpecifier) &&
      RN_IMPORT.test(s.moduleSpecifier.text),
  );
}

/** The 1-based line `node` starts on. */
export const lineOf = (node: ts.Node) =>
  node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1;

/** `node` without the wrappers that don't change its value: `( … )`, `… as const`, `… satisfies T`, `x!`. */
export function unwrapped(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** A property's name as written (`surface`, `"surface-dark"`, `200`), or undefined when it's computed. */
export function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name))
    return name.text;
  return undefined;
}

/** `a.b.c` as written, for a chain of names only (`theme.colors.surface`); undefined for calls or `[…]` in it. */
export function dottedName(node: ts.Expression): string | undefined {
  const inner = unwrapped(node);
  if (ts.isIdentifier(inner)) return inner.text;
  if (ts.isPropertyAccessExpression(inner) && ts.isIdentifier(inner.name)) {
    const left = dottedName(inner.expression);
    return left === undefined ? undefined : `${left}.${inner.name.text}`;
  }
  return undefined;
}

/** The names a chain reaches through, with static `[…]` too: `colors.blue[500]` is `colors`, `blue`, `500`. */
export function accessPath(node: ts.Expression): string[] | undefined {
  const inner = unwrapped(node);
  if (ts.isIdentifier(inner)) return [inner.text];
  if (ts.isPropertyAccessExpression(inner) && ts.isIdentifier(inner.name)) {
    const left = accessPath(inner.expression);
    return left && [...left, inner.name.text];
  }
  if (ts.isElementAccessExpression(inner)) {
    const key = unwrapped(inner.argumentExpression);
    const part =
      ts.isStringLiteral(key) || ts.isNumericLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key)
        ? key.text
        : undefined;
    const left = part === undefined ? undefined : accessPath(inner.expression);
    return left && part !== undefined ? [...left, part] : undefined;
  }
  return undefined;
}

/** A path as code reaches it: `colors.blue[500]`, `colors["brand-blue"]`. */
export function renderPath(parts: string[]): string {
  return parts
    .map((part, i) => {
      if (i === 0) return part;
      if (/^[A-Za-z_$][\w$]*$/.test(part)) return `.${part}`;
      return /^\d+$/.test(part) ? `[${part}]` : `[${JSON.stringify(part)}]`;
    })
    .join("");
}

/** Visits `root` and the nodes under it, depth first in source order, without recursion (deeply nested code, a long
 * `"a" + "b" + …`, would overflow the stack); `visit` returns false to skip a node's children. */
export function eachNode(root: ts.Node, visit: (node: ts.Node) => boolean): void {
  const stack: ts.Node[] = [root];
  for (let node = stack.pop(); node; node = stack.pop()) {
    if (!visit(node)) continue;
    const children: ts.Node[] = [];
    ts.forEachChild(node, (child) => {
      children.push(child);
    });
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i] as ts.Node);
  }
}
