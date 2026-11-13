/**
 * Colours from Tailwind (NativeWind, Uniwind): those a `tailwind.config.js` or a CSS `@theme` names, and the class
 * names that use them (`bg-primary-500`, `dark:text-muted`).
 */

import path from "node:path";
import ts from "typescript";
import type { ColorFindings, NamedColor } from "../scan/palette.js";
import { colorOf } from "./css-color.js";
import {
  accessPath,
  eachNode,
  type JsSource,
  lineOf,
  propertyName,
  renderPath,
  unwrapped,
} from "./js-sources.js";
import type { ScanContext } from "./plugin.js";

export const TAILWIND_CONFIG = /(?:^|\/)tailwind\.config\.[cm]?[jt]s$/;
const CSS = /\.css$/;
/** A colour variable in a CSS `@theme`: `--color-charcoal-500: #7d7d7d;`. */
const CSS_COLOR = /--color-([\w-]+)\s*:\s*([^;]+);/g;
/** A block whose variables are the dark scheme's. */
const DARK_BLOCK =
  /(?:@media[^{]*prefers-color-scheme:\s*dark[^{]*|\.dark\b[^{]*|\[data-theme=["']?dark["']?\][^{]*|@variant\s+dark[^{]*)\{/g;
/** Utility prefixes that take a colour: `bg-`, `text-`, `border-t-` and the rest. */
const COLOR_UTILITY =
  /^(?:bg|text|border(?:-[trblxyse])?|ring(?:-offset)?|fill|stroke|from|via|to|divide|outline|decoration|placeholder|shadow|accent|caret)-(.+)$/;
/** How many variables, requires and imports a config value is followed through. */
const MAX_HOPS = 8;

export interface TailwindFindings extends ColorFindings {
  /** The configs and the modules they read colours from, whose colours are Tailwind's names, not objects' paths. */
  files: Set<string>;
}

/** The colours Tailwind names in the project, with the class names using them; empty for an app without Tailwind. */
export async function tailwindColors(ctx: ScanContext, sources: JsSource[]): Promise<TailwindFindings> {
  const files = new Set<string>();
  const named = [...configColors(sources, files), ...(await cssColors(ctx))];
  const found: TailwindFindings = { named, references: [], literals: [], system: [], files };
  if (named.length === 0) return found;
  const names = new Set(named.map((c) => c.name));
  for (const source of sources) {
    eachNode(source.file, (node) => {
      // Class names in quotes, or in a template's text parts (`flex ${a} bg-primary`).
      if (
        ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)
      ) {
        for (const name of classColors(node.text)) {
          if (names.has(name)) found.references.push({ name, reference: name });
        }
      }
      return true;
    });
  }
  return found;
}

/** The colour names a string's class names use: `dark:bg-primary-500/50` uses `primary-500`. */
function classColors(text: string): string[] {
  return text.split(/\s+/).flatMap((word) => {
    const utility = word.slice(word.lastIndexOf(":") + 1).replace(/^!|!$/g, "");
    const name = utility.match(COLOR_UTILITY)?.[1]?.replace(/\/[\w.[\]%]+$/, "");
    return name ? [name] : [];
  });
}

/** A value and the file it's written in, which its names are looked up in. */
interface Located {
  node: ts.Expression;
  source: JsSource;
}

/** The colours `theme.colors` and `theme.extend.colors` name in a Tailwind config, nested names joined by `-`
 * (`charcoal: { 500 }` is `charcoal-500`, `DEFAULT` is the group's own), also from modules the config requires. */
function configColors(sources: JsSource[], files: Set<string>): NamedColor[] {
  const resolver = new Resolver(sources);
  const out: NamedColor[] = [];
  for (const config of sources.filter((s) => TAILWIND_CONFIG.test(s.rel))) {
    files.add(config.rel);
    const root = resolver.exported(config);
    const theme = root && resolver.member(root, "theme");
    const extend = theme && resolver.member(theme, "extend");
    for (const group of [
      theme && resolver.member(theme, "colors"),
      extend && resolver.member(extend, "colors"),
    ]) {
      if (group) flatten(group, [], resolver, files, out, 0);
    }
  }
  return out;
}

function flatten(
  at: Located,
  names: string[],
  resolver: Resolver,
  files: Set<string>,
  out: NamedColor[],
  hops: number,
) {
  const object = hops > MAX_HOPS ? undefined : resolver.object(at);
  if (!object) return;
  files.add(object.source.rel);
  for (const property of object.node.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const key = propertyName(property.name);
    if (key === undefined) continue;
    const parts = key === "DEFAULT" ? names : [...names, key];
    const text = stringValue(property.initializer);
    const light = text === undefined ? undefined : colorOf(text, true);
    const name = parts.join("-");
    if (light && name) {
      out.push({
        name,
        light,
        source: object.source.rel,
        reference: name,
        line: lineOf(property),
        kind: "code",
      });
      continue;
    }
    // A nested group, also one held elsewhere: `brand: require("./brand")`.
    flatten({ node: property.initializer, source: object.source }, parts, resolver, files, out, hops + 1);
  }
}

const stringValue = (node: ts.Expression): string | undefined => {
  const inner = unwrapped(node);
  return ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner) ? inner.text : undefined;
};

/** Follows a config's values through module-level variables, `require(…)` and default imports of local modules. */
class Resolver {
  private readonly byRel: Map<string, JsSource>;

  constructor(sources: JsSource[]) {
    this.byRel = new Map(sources.map((s) => [s.rel, s]));
  }

  /** What a module exports: `module.exports = …` or `export default …`. */
  exported(source: JsSource, hops = 0): Located | undefined {
    for (const statement of source.file.statements) {
      if (ts.isExportAssignment(statement)) return this.value({ node: statement.expression, source }, hops);
      if (
        ts.isExpressionStatement(statement) &&
        ts.isBinaryExpression(statement.expression) &&
        statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        renderPath(accessPath(statement.expression.left) ?? []) === "module.exports"
      ) {
        return this.value({ node: statement.expression.right, source }, hops);
      }
    }
    return undefined;
  }

  /** `name`'s value in an object literal, also written as a variable of that name (`{ theme: { colors } }`). */
  member(at: Located, name: string): Located | undefined {
    const object = this.object(at);
    if (!object) return undefined;
    for (const property of object.node.properties) {
      if (ts.isPropertyAssignment(property) && propertyName(property.name) === name)
        return { node: property.initializer, source: object.source };
      if (ts.isShorthandPropertyAssignment(property) && property.name.text === name)
        return { node: property.name, source: object.source };
    }
    return undefined;
  }

  /** The object literal a value is, wherever it's written. */
  object(at: Located): { node: ts.ObjectLiteralExpression; source: JsSource } | undefined {
    const found = this.value(at, 0);
    const node = found && unwrapped(found.node);
    return found && node && ts.isObjectLiteralExpression(node) ? { node, source: found.source } : undefined;
  }

  /** A value's own expression, past variables, requires and imports; undefined past `MAX_HOPS`, so modules that
   * require each other end. */
  private value({ node, source }: Located, hops: number): Located | undefined {
    if (hops > MAX_HOPS) return undefined;
    const value = unwrapped(node);
    if (ts.isCallExpression(value) && renderPath(accessPath(value.expression) ?? []) === "require") {
      const target = this.moduleAt(value.arguments[0], source);
      return target && this.exported(target, hops + 1);
    }
    if (!ts.isIdentifier(value)) return { node: value, source };
    for (const statement of source.file.statements) {
      if (ts.isVariableStatement(statement)) {
        for (const d of statement.declarationList.declarations)
          if (ts.isIdentifier(d.name) && d.name.text === value.text && d.initializer)
            return this.value({ node: d.initializer, source }, hops + 1);
      }
      if (
        ts.isImportDeclaration(statement) &&
        statement.importClause?.name?.text === value.text &&
        ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        const target = this.moduleAt(statement.moduleSpecifier, source);
        return target && this.exported(target, hops + 1);
      }
    }
    return undefined;
  }

  /** The project's module a relative path names, trying the script extensions and `index`. */
  private moduleAt(specifier: ts.Expression | undefined, from: JsSource): JsSource | undefined {
    if (!specifier || !ts.isStringLiteral(specifier) || !specifier.text.startsWith(".")) return undefined;
    const base = path.posix.join(path.posix.dirname(from.rel), specifier.text);
    for (const ext of ["", ".js", ".ts", ".cjs", ".mjs", ".jsx", ".tsx", "/index.js", "/index.ts"]) {
      const found = this.byRel.get(base + ext);
      if (found) return found;
    }
    return undefined;
  }
}

/** The colours CSS `@theme` blocks name, `--color-*`, with the values a dark block gives them; commented-out
 * declarations aren't read. */
async function cssColors(ctx: ScanContext): Promise<NamedColor[]> {
  const out = new Map<string, NamedColor>();
  const darkValues = new Map<string, string>();
  for (const file of ctx.files.filter((f) => CSS.test(f.rel))) {
    const raw = await ctx.read(file);
    if (!raw?.includes("--color-")) continue;
    // Comments blanked to spaces, keeping every offset and line where it was.
    const text = raw.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
    const dark = darkSpans(text);
    let [line, counted] = [1, 0];
    for (const m of text.matchAll(CSS_COLOR)) {
      const [name, written] = [m[1] ?? "", m[2] ?? ""];
      const value = colorOf(written, true);
      const at = m.index ?? 0;
      for (; counted < at; counted++) if (text[counted] === "\n") line++;
      if (!value) continue;
      if (dark.some(([open, close]) => at > open && at < close)) {
        if (!darkValues.has(name)) darkValues.set(name, value);
        continue;
      }
      if (!out.has(name))
        out.set(name, { name, light: value, source: file.rel, reference: name, line, kind: "code" });
    }
  }
  return [...out.values()].map((c) => {
    const dark = darkValues.get(c.name);
    return dark && dark !== c.light ? { ...c, dark } : c;
  });
}

/** The spans of the blocks in a stylesheet that hold the dark scheme's values. */
function darkSpans(text: string): [number, number][] {
  return [...text.matchAll(DARK_BLOCK)].map((m) => {
    const open = (m.index ?? 0) + m[0].length - 1;
    let depth = 0;
    for (let i = open; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}" && --depth === 0) return [open, i] as [number, number];
    }
    return [open, text.length] as [number, number];
  });
}
