/** The strings and numbers a React Native app's module-level objects and constants hold, for reading a style's
 * values through them. */

import path from "node:path";
import ts from "typescript";
import {
  accessPath,
  defaultExport,
  fileName,
  type JsSource,
  objectIn,
  propertyName,
  shadowed,
  unwrapped,
} from "./js-sources.js";

/** The strings and numbers module-level objects and constants hold, to read `fontSize: sizes.title` and
 * `padding: spacing.md`: in the file using them, in the file they're imported from, else by a path only one value
 * has. A local name of the same spelling (a parameter `SIZE`) isn't the constant. */
/** How many paths holding other paths are followed to a value. */
const MAX_HOPS = 5;

export class Values {
  private readonly byFile = new Map<JsSource, Map<string, string | number>>();
  private readonly unique = new Map<string, string | number | null>();
  private readonly byRel: Map<string, JsSource>;
  private readonly imports = new Map<JsSource, Map<string, { from: string; name: string }>>();
  private readonly defaults = new Map<JsSource, string>();
  /** Paths whose value is another path (`h1: variables.fontSizeXLarge`), by file. */
  private readonly aliases = new Map<JsSource, Map<string, string[]>>();

  constructor(sources: JsSource[]) {
    this.byRel = new Map(sources.map((s) => [s.rel, s]));
    for (const source of sources) {
      const own = new Map<string, string | number>();
      const aliases = new Map<string, string[]>();
      const imports = new Map<string, { from: string; name: string }>();
      // A path only one value has, whole (`variables.fontSizeNormal`, for a file imported through a path alias),
      // never by its end: a bare `size` isn't another file's `ICON.size`.
      const add = (at: string[], value: string | number) => {
        const key = at.join("\0");
        own.set(key, value);
        if (at.length > 1)
          this.unique.set(key, this.unique.has(key) && this.unique.get(key) !== value ? null : value);
      };
      const walk = (object: ts.ObjectLiteralExpression, at: string[]) => {
        for (const property of object.properties) {
          if (!ts.isPropertyAssignment(property)) continue;
          const key = propertyName(property.name);
          if (key === undefined) continue;
          const value = unwrapped(property.initializer);
          if (ts.isObjectLiteralExpression(value)) walk(value, [...at, key]);
          else {
            const literal = literalOf(value);
            if (literal !== undefined) add([...at, key], literal);
            const alias = literal === undefined ? accessPath(value) : undefined;
            if (alias) aliases.set([...at, key].join("\0"), alias);
          }
        }
      };
      for (const statement of source.file.statements) {
        // `export default { fontSizeNormal: 15 }` is imported by the file's name: `variables.fontSizeNormal`.
        const exported = defaultExport(statement);
        if (exported) {
          const inner = unwrapped(exported);
          this.defaults.set(source, ts.isIdentifier(inner) ? inner.text : fileName(source));
          const object = objectIn(exported);
          if (object) walk(object, [fileName(source)]);
        }
        if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
          const from = statement.moduleSpecifier.text;
          const clause = statement.importClause;
          if (clause?.name) imports.set(clause.name.text, { from, name: "default" });
          const bindings = clause?.namedBindings;
          if (bindings && ts.isNamedImports(bindings))
            for (const e of bindings.elements)
              imports.set(e.name.text, { from, name: e.propertyName?.text ?? e.name.text });
        }
        if (!ts.isVariableStatement(statement)) continue;
        for (const d of statement.declarationList.declarations) {
          if (!ts.isIdentifier(d.name) || !d.initializer) continue;
          const value = objectIn(d.initializer);
          if (value) walk(value, [d.name.text]);
          const literal = literalOf(unwrapped(d.initializer));
          if (literal !== undefined) add([d.name.text], literal);
          const alias = literal === undefined && !value ? accessPath(d.initializer) : undefined;
          if (alias) aliases.set(d.name.text, alias);
        }
      }
      this.byFile.set(source, own);
      this.aliases.set(source, aliases);
      this.imports.set(source, imports);
    }
  }

  /** A value as written, or as a constant or object path holds it; undefined when it's worked out as the app runs. */
  of(node: ts.Expression, source: JsSource): string | number | undefined {
    const inner = unwrapped(node);
    const literal = literalOf(inner);
    if (literal !== undefined) return literal;
    if (ts.isIdentifier(inner) && shadowed(inner)) return undefined;
    const parts = accessPath(inner);
    return parts ? this.at(parts, source, 0) : undefined;
  }

  /** The value a path holds, in `source` or the file it imports the path's start from, following a path that holds
   * another (`fontScale.h1` → `variables.fontSizeXLarge`) up to `MAX_HOPS` times. */
  private at(parts: string[], source: JsSource, hops: number): string | number | undefined {
    if (hops > MAX_HOPS) return undefined;
    const key = parts.join("\0");
    const own = this.byFile.get(source)?.get(key);
    if (own !== undefined) return own;
    const ownAlias = this.aliases.get(source)?.get(key);
    if (ownAlias) return this.at(ownAlias, source, hops + 1);
    const binding = this.imports.get(source)?.get(parts[0] ?? "");
    const target = binding && this.moduleAt(binding.from, source);
    if (binding && target) {
      const root = binding.name === "default" ? this.defaults.get(target) : binding.name;
      const there = root === undefined ? undefined : [root, ...parts.slice(1)].join("\0");
      const value = there === undefined ? undefined : this.byFile.get(target)?.get(there);
      if (value !== undefined) return value;
      const alias = there === undefined ? undefined : this.aliases.get(target)?.get(there);
      if (alias) return this.at(alias, target, hops + 1);
    }
    return this.unique.get(key) ?? undefined;
  }

  private moduleAt(specifier: string, from: JsSource): JsSource | undefined {
    if (!specifier.startsWith(".")) return undefined;
    const base = path.posix.join(path.posix.dirname(from.rel), specifier);
    for (const ext of ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.js"]) {
      const found = this.byRel.get(base + ext);
      if (found) return found;
    }
    return undefined;
  }
}

/** A helper scaling a size to the phone (`scale(14)`, `moderateScale(16)`, `RFValue(12)`,
 * `getValueUsingPixelRatio(15, 19)`), whose first number is the size the design gives; not a percentage of the screen
 * (`hp(30)`) or arithmetic (`Math.max(16, …)`). */
const SCALER = /(?:scale|normali[sz]e|pixelratio|^rfvalue$|^rf$|^ms$|^vs$|^s$)/i;

/** A value as written; a size scaled to the phone's settings is the size written first, as the design gives it. */
export function literalOf(node: ts.Expression): string | number | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  // A font stack built as a template (`Expensify Neue, ${FALLBACK}`) starts with the family it names.
  if (ts.isTemplateExpression(node) && node.head.text.includes(",")) return node.head.text;
  if (ts.isCallExpression(node) && SCALER.test(accessPath(node.expression)?.at(-1) ?? "")) {
    const first = node.arguments[0] && unwrapped(node.arguments[0]);
    return first && ts.isNumericLiteral(first) ? Number(first.text) : undefined;
  }
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (
    ts.isPrefixUnaryExpression(node) &&
    node.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(node.operand)
  )
    return -Number(node.operand.text);
  return undefined;
}
