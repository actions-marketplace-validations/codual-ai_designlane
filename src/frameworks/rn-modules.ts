/**
 * How a React Native app's files connect: what each declares, imports and exports, and the module a specifier names
 * (relative, or through a path alias like `~/views/Room` or `@pages/Settings`), so a name used in one file can be
 * followed to what another declares.
 */

import path from "node:path";
import ts from "typescript";
import { type JsSource, propertyName } from "./js-sources.js";

/** A name a file imports: from a specifier, by the name it's exported as (`default`, `*` for a namespace). */
export interface Imported {
  from: string;
  name: string;
}

/** What a file exports under a name: one of its own names, or one another module exports. */
export type Exported = { local: string } | { from: string; name: string };

/** One file's names. */
export interface ModuleNames {
  imports: Map<string, Imported>;
  /** By exported name; `default` for the default export. */
  exports: Map<string, Exported>;
  /** `export * from "…"`. */
  stars: string[];
  /** The default export written as an expression (`export default withX(Home)`). */
  defaultExpression?: ts.Expression;
}

const SCRIPT_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js"];

/** A file's path without its platform and extension: `List.ios.tsx` and `List.android.tsx` are one module, `List`. */
export const stemOf = (rel: string) => rel.replace(/(?:\.(?:ios|android|native|web))?\.[jt]sx?$/, "");
/** React Native's platform variants of a file: `Home.ios.tsx`, `Home.android.tsx`, `Home.native.tsx`. */
const PLATFORMS = ["", ".ios", ".android", ".native"];

export class Modules {
  private readonly byRel: Map<string, JsSource>;
  /** Files by the end of their path without extension (`views/RoomView/index`), for path aliases. */
  private readonly byEnd = new Map<string, JsSource[]>();
  private readonly names = new Map<JsSource, ModuleNames>();

  /** `packages`: the names the project's package.json files depend on, which an import of names a package. */
  constructor(
    readonly sources: JsSource[],
    private readonly packages: Set<string> = new Set(),
  ) {
    this.byRel = new Map(sources.map((s) => [s.rel, s]));
    for (const s of sources) {
      const parts = s.rel.replace(/(?:\.(?:ios|android|native|web))?\.[jt]sx?$/, "").split("/");
      for (let i = 0; i < parts.length; i++) {
        const end = parts.slice(i).join("/");
        this.byEnd.set(end, [...(this.byEnd.get(end) ?? []), s]);
      }
    }
  }

  namesOf(source: JsSource): ModuleNames {
    let found = this.names.get(source);
    if (!found) {
      found = readNames(source);
      this.names.set(source, found);
    }
    return found;
  }

  /**
   * The project's files a specifier names, every platform variant of it (`./Home` is `Home.ios.tsx` and
   * `Home.android.tsx`). A relative one is joined to the file's folder. A package the project depends on
   * (`@gorhom/bottom-sheet`, `date-fns/sub`) is none of its files. Any other is a path alias, matched by its end:
   * with the alias's sigil dropped (`@components/Button` is `components/Button`), then without its first parts, where
   * a folder's `index` is the folder (`Button/index.tsx` beside `Button/Button.tsx`) and otherwise one file must match.
   */
  resolve(specifier: string, from: JsSource): JsSource[] {
    if (specifier.startsWith(".")) return this.at(path.posix.join(path.posix.dirname(from.rel), specifier));
    const parts = specifier.split("/");
    const pkg = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? "");
    if (this.packages.has(pkg)) return [];
    const ends = [
      [(parts[0] ?? "").replace(/^[@~#]/, ""), ...parts.slice(1)].join("/"),
      ...[1, 2].filter((drop) => drop < parts.length).map((drop) => parts.slice(drop).join("/")),
    ];
    for (const end of ends) {
      if (!end) continue;
      const index = this.unique(this.byEnd.get(`${end}/index`));
      if (index) return index;
      const file = this.unique(this.byEnd.get(end));
      if (file) return file;
    }
    return [];
  }

  /** The files of one module (its platform variants), or none when several modules match. */
  private unique(files: JsSource[] | undefined): JsSource[] | undefined {
    if (!files?.length) return undefined;
    const stems = new Set(files.map((f) => stemOf(f.rel)));
    return stems.size === 1 ? files.filter((f) => !/\.web\.[jt]sx?$/.test(f.rel)) : undefined;
  }

  private at(base: string): JsSource[] {
    const found: JsSource[] = [];
    for (const stem of [base, `${base}/index`])
      for (const platform of PLATFORMS)
        for (const ext of SCRIPT_EXTENSIONS) {
          const file =
            this.byRel.get(stem + platform + ext) ?? (platform === "" ? this.byRel.get(stem) : undefined);
          if (file && !found.includes(file)) found.push(file);
        }
    return found.length > 0 ? found : [this.byRel.get(base)].filter((f): f is JsSource => f !== undefined);
  }
}

function readNames(source: JsSource): ModuleNames {
  const names: ModuleNames = { imports: new Map(), exports: new Map(), stars: [] };
  for (const s of source.file.statements) {
    if (ts.isImportDeclaration(s) && ts.isStringLiteral(s.moduleSpecifier)) {
      const from = s.moduleSpecifier.text;
      const clause = s.importClause;
      if (clause?.name) names.imports.set(clause.name.text, { from, name: "default" });
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings))
        names.imports.set(bindings.name.text, { from, name: "*" });
      if (bindings && ts.isNamedImports(bindings))
        for (const e of bindings.elements)
          names.imports.set(e.name.text, { from, name: e.propertyName?.text ?? e.name.text });
    } else if (ts.isExportDeclaration(s)) {
      const from =
        s.moduleSpecifier && ts.isStringLiteral(s.moduleSpecifier) ? s.moduleSpecifier.text : undefined;
      if (!s.exportClause && from) names.stars.push(from);
      if (s.exportClause && ts.isNamedExports(s.exportClause))
        for (const e of s.exportClause.elements) {
          const local = e.propertyName?.text ?? e.name.text;
          names.exports.set(e.name.text, from ? { from, name: local } : { local });
        }
    } else if (ts.isExportAssignment(s) && !s.isExportEquals) {
      names.defaultExpression = s.expression;
    } else if (isExported(s)) {
      const isDefault =
        ts.canHaveModifiers(s) && ts.getModifiers(s)?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
      for (const name of declaredNames(s)) names.exports.set(isDefault ? "default" : name, { local: name });
    } else if (
      ts.isExpressionStatement(s) &&
      ts.isBinaryExpression(s.expression) &&
      s.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      s.expression.left.getText() === "module.exports"
    ) {
      names.defaultExpression = s.expression.right;
    }
  }
  return names;
}

const isExported = (s: ts.Statement) =>
  ts.canHaveModifiers(s) &&
  (ts.getModifiers(s)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false);

/** The names a declaration statement declares: `function X`, `class X`, `const X = …, Y = …`. */
export function declaredNames(s: ts.Statement): string[] {
  if ((ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s)) && s.name) return [s.name.text];
  if (ts.isVariableStatement(s))
    return s.declarationList.declarations.flatMap((d) => (ts.isIdentifier(d.name) ? [d.name.text] : []));
  return [];
}

/** A property's value in an object literal, also written as a variable of that name (`{ screens }`). */
export function memberOf(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const p of object.properties) {
    if (ts.isPropertyAssignment(p) && propertyName(p.name) === name) return p.initializer;
    if (ts.isShorthandPropertyAssignment(p) && p.name.text === name) return p.name;
  }
  return undefined;
}
