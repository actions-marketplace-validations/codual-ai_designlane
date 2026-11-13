/**
 * A React Native app's text styles, spacing and corner radii: the styles its typography objects name
 * (`typography.title = { fontSize: 22, fontWeight: "700" }`), each style written in place (a style sheet's, a `style`
 * prop's), and the padding, margins, gaps and radii its styles set.
 */

import ts from "typescript";
import type { TypeFindings, TypeUse } from "../scan/type-scale.js";
import type { TypeStyle } from "../scan/types.js";
import {
  accessPath,
  defaultExport,
  dottedName,
  eachNode,
  fileName,
  type JsSource,
  lineOf,
  objectIn,
  propertyName,
  renderPath,
  unwrapped,
} from "./js-sources.js";
import { familyAndWeight, WEIGHTS } from "./rn-fonts.js";
import { countUses, type Font, type Named, StyleIndex, UNKNOWN } from "./rn-named.js";
import { Values } from "./rn-values.js";

const SPACING =
  /^(?:(?:padding|margin)(?:Top|Right|Bottom|Left|Horizontal|Vertical|Start|End|Block|Inline)?|gap|rowGap|columnGap)$/;
const RADIUS = /^border(?:Top|Bottom)?(?:Left|Right|Start|End)?Radius$/;

export interface RnType extends TypeFindings {
  /** The text styles the app's typography objects name, each with how many times the code reaches it. */
  named: TypeStyle[];
  /** Each spacing value a style sets, once per place. */
  spacing: number[];
  /** Each corner radius a style sets, once per place. */
  radii: number[];
}

/** `skip` holds the files that aren't the app's styles (a Tailwind config). */
export function rnType(sources: JsSource[], skip: Set<string> = new Set()): RnType {
  const read = sources.filter((s) => !skip.has(s.rel));
  const values = new Values(read);
  const none = new StyleIndex([]);
  const all = namedStyles(read, values, none, "named");
  const named = once(all);
  // A module-level style sheet's styles aren't the app's named styles, but a style spreading one takes its font
  // (`...sharedStyles.textRegular`).
  const index = new StyleIndex(named);
  const sheets = new StyleIndex(namedStyles(read, values, none, "sheet"));
  // By path first, in either (`common.label` is the sheet's), and by a name alone only after.
  const spreads = (parts: string[], from: JsSource) =>
    index.find(parts, from) ??
    sheets.find(parts, from) ??
    index.find(parts, from, true) ??
    sheets.find(parts, from, true);
  // A named style spreading another (`title: { ...fonts.body, fontSize: 24 }`) takes its font.
  for (const style of named)
    style.font = styleOf(style.object, style.source, values, spreads).font ?? style.font;
  // The named styles, platform copies included, and the branches of a `Platform.select` a style reads, aren't styles of
  // their own.
  const own = new Set<ts.Node>(all.map((n) => n.object));
  for (const n of all)
    for (const branch of styleOf(n.object, n.source, values, spreads).branches) own.add(branch);
  const uses: TypeUse[] = [];
  const spacing: number[] = [];
  const radii: number[] = [];
  const inStyles = new Set<ts.Node>();
  for (const source of read) {
    eachNode(source.file, (node) => {
      if (!ts.isObjectLiteralExpression(node)) return true;
      const style = styleOf(node, source, values, spreads);
      for (const branch of style.branches) own.add(branch);
      // A style setting its own family or size is a style of its own, even over a named one it spreads; a style that
      // only spreads one is a use of that one.
      if (style.font && style.ownFont && !own.has(node)) {
        uses.push({ ...useOf(style.font), file: source.rel, line: lineOf(node) });
        for (const spread of style.spreads) inStyles.add(spread);
        for (const read of style.fromNamed) inStyles.add(read);
      }
      spacing.push(...style.spacing);
      radii.push(...style.radii);
      return true;
    });
  }
  countUses(read, index, inStyles);
  const styles = named.map((n): TypeStyle => {
    const { family, size, weight } = useOf(n.font);
    return {
      name: n.path[n.path.length - 1] ?? "",
      kind: "app",
      family,
      ...(size === undefined ? {} : { size }),
      weight,
      reference: renderPath(n.path),
      uses: n.uses,
    };
  });
  return {
    named: styles,
    uses,
    // A named style's family is listed even when nothing reaches the style.
    helperFonts: styles
      .filter((s) => s.family !== "System" && s.family !== "")
      .map((s) => ({ kind: "custom", family: s.family, weight: s.weight })),
    spacing,
    radii,
  };
}

/** What a style object sets: its font, if it sets one, and its spacing and radii. */
interface Style {
  font?: Font;
  /** Sets a family or size itself, not only through a named style it spreads. */
  ownFont: boolean;
  /** Takes a font from a named style it spreads. */
  spreadFont: boolean;
  /** The spread expressions giving it a font. */
  spreads: ts.Expression[];
  /** Values read from a named style (`fontSize: typography.title.fontSize`), counted as this style's, not the named
   * one's. */
  fromNamed: ts.Expression[];
  /** The `Platform.select` branches it reads, which aren't styles of their own. */
  branches: ts.ObjectLiteralExpression[];
  spacing: number[];
  radii: number[];
}

type Spreads = (parts: string[], from: JsSource) => Named | undefined;

function styleOf(
  object: ts.ObjectLiteralExpression,
  source: JsSource,
  values: Values,
  spreads: Spreads,
): Style {
  const style: Style = {
    ownFont: false,
    spreadFont: false,
    spreads: [],
    fromNamed: [],
    branches: [],
    spacing: [],
    radii: [],
  };
  let font: Font = {};
  let touched = false;
  for (const property of object.properties) {
    // A named style spread in (`...fontFamily.EXP_NEUE, fontSize: 15`) gives what it sets; later properties replace it.
    if (ts.isSpreadAssignment(property)) {
      // `...Platform.select({ ios: { fontFamily: "Inter" }, android: … })`: iOS's values, as the design shows them.
      const platform = platformBranch(property.expression);
      if (platform) {
        style.branches.push(...platformBranches(property.expression));
        const inner = styleOf(platform, source, values, spreads);
        if (inner.font) {
          font = { ...font, ...inner.font };
          touched = true;
          style.ownFont ||= inner.ownFont;
          style.spreadFont ||= inner.spreadFont;
        }
        continue;
      }
      const parts = accessPath(property.expression);
      const base = parts && spreads(parts, source)?.font;
      if (base) {
        font = { ...font, ...base };
        touched = style.spreadFont = true;
        style.spreads.push(property.expression);
      } else if (parts?.some((p) => /font|typo|text/i.test(p))) {
        // A font style the code can't read (`...fontFamilyScale.strong`) leaves family and weight unknown.
        font = { ...font, family: UNKNOWN, weight: UNKNOWN };
        touched = true;
      }
      continue;
    }
    let key: string | undefined;
    let written: ts.Expression | undefined;
    if (ts.isShorthandPropertyAssignment(property)) [key, written] = [property.name.text, property.name];
    else if (ts.isPropertyAssignment(property))
      [key, written] = [propertyName(property.name), property.initializer];
    if (key === undefined || written === undefined) continue;
    let value = values.of(written, source);
    // `fontSize: typography.title.fontSize`: the named style's own value, a use of this style rather than of it.
    if (FONT_KEYS.has(key)) {
      const parts = accessPath(written);
      const from =
        parts && parts.length > 2 && parts.at(-1) === key ? spreads(parts.slice(0, -1), source) : undefined;
      const field = from?.font[key === "fontSize" ? "size" : key === "fontFamily" ? "family" : "weight"];
      if (from) style.fromNamed.push(written);
      if (field !== undefined && field !== UNKNOWN && key === "fontWeight") font.weight = field as string;
      else if (field !== undefined && field !== UNKNOWN) value = field;
    }
    if (SPACING.test(key) && typeof value === "number" && value > 0) style.spacing.push(value);
    else if (RADIUS.test(key) && typeof value === "number" && value > 0) style.radii.push(value);
    else if (key === "fontSize" || key === "fontFamily") {
      // A value the code works out replaces one a spread gave.
      if (key === "fontSize") font.size = typeof value === "number" ? value : UNKNOWN;
      else font.family = typeof value === "string" ? value : UNKNOWN;
      touched = style.ownFont = true;
    } else if (key === "fontWeight") {
      if (!style.fromNamed.includes(written))
        font.weight = value === undefined ? UNKNOWN : (WEIGHTS[String(value)] ?? UNKNOWN);
      touched = true;
    }
  }
  // A weight alone (`{ fontWeight: "bold" }`) changes a style rather than making one.
  if (touched && (style.ownFont || style.spreadFont)) style.font = font;
  return style;
}

/** A font as a use of the type scale: the system font when it names none, an unknown one when the code works it out,
 * and the family and weight a font file's name carries (`Inter-SemiBold`). */
function useOf(font: Font): TypeUse {
  const read = typeof font.family === "string" ? familyAndWeight(font.family) : undefined;
  const family = read?.family ?? (font.family === UNKNOWN ? "" : "System");
  const weight = font.weight === UNKNOWN ? "computed" : (font.weight ?? read?.weight ?? "regular");
  return {
    kind: family === "System" ? "system" : "custom",
    family,
    ...(typeof font.size === "number" ? { size: font.size } : {}),
    weight,
  };
}

/**
 * The text styles module-level objects name, `typography.title = { fontSize, fontWeight }`, by the path the code
 * uses; `export default { title: … }` is named by its file. With `"sheet"`, the styles of module-level style sheets
 * (`const sharedStyles = StyleSheet.create({ … })`) instead, written for screens rather than named for the app.
 */
function namedStyles(
  sources: JsSource[],
  values: Values,
  index: StyleIndex,
  kind: "named" | "sheet",
): Named[] {
  const out: Named[] = [];
  const spreads: Spreads = (parts, from) => index.find(parts, from, true);
  for (const source of sources) {
    const walk = (object: ts.ObjectLiteralExpression, at: string[]) => {
      const style = styleOf(object, source, values, spreads);
      if (style.font && style.ownFont && at.length > 1) {
        out.push({ path: at, source, object, font: style.font, uses: 0 });
        return;
      }
      for (const property of object.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        const key = propertyName(property.name);
        const value = unwrapped(property.initializer);
        if (key !== undefined && ts.isObjectLiteralExpression(value)) walk(value, [...at, key]);
      }
    };
    for (const statement of source.file.statements) {
      const exported = defaultExport(statement);
      const object = exported && (kind === "named" ? objectIn(exported) : sheetIn(exported));
      if (object) walk(object, [fileName(source)]);
      if (!ts.isVariableStatement(statement)) continue;
      for (const d of statement.declarationList.declarations) {
        const value = d.initializer && (kind === "named" ? objectIn(d.initializer) : sheetIn(d.initializer));
        if (ts.isIdentifier(d.name) && value) walk(value, [d.name.text]);
      }
    }
  }
  return out;
}

const FONT_KEYS = new Set(["fontSize", "fontFamily", "fontWeight"]);

/** Every branch object of `Platform.select({ ios: { … }, android: { … } })`. */
function platformBranches(node: ts.Expression): ts.ObjectLiteralExpression[] {
  const call = unwrapped(node);
  const options = ts.isCallExpression(call) && call.arguments[0] && unwrapped(call.arguments[0]);
  if (!options || !ts.isObjectLiteralExpression(options)) return [];
  return options.properties.flatMap((p) => {
    const value = ts.isPropertyAssignment(p) ? unwrapped(p.initializer) : undefined;
    return value && ts.isObjectLiteralExpression(value) ? [value] : [];
  });
}

/** The iOS branch of `Platform.select({ ios: { … }, … })`, or its first. */
function platformBranch(node: ts.Expression): ts.ObjectLiteralExpression | undefined {
  const call = unwrapped(node);
  if (!ts.isCallExpression(call) || dottedName(call.expression) !== "Platform.select") return undefined;
  const options = call.arguments[0] && unwrapped(call.arguments[0]);
  if (!options || !ts.isObjectLiteralExpression(options)) return undefined;
  const branches = options.properties.filter(ts.isPropertyAssignment);
  const chosen = branches.find((b) => propertyName(b.name) === "ios") ?? branches[0];
  const value = chosen && unwrapped(chosen.initializer);
  return value && ts.isObjectLiteralExpression(value) ? value : undefined;
}

/** The object `StyleSheet.create({ … })` makes a style sheet of. */
function sheetIn(node: ts.Expression): ts.ObjectLiteralExpression | undefined {
  const value = unwrapped(node);
  if (!ts.isCallExpression(value) || dottedName(value.expression) !== "StyleSheet.create") return undefined;
  const first = value.arguments[0] && unwrapped(value.arguments[0]);
  return first && ts.isObjectLiteralExpression(first) ? first : undefined;
}

/** One named style per path and font: a platform's copy of a style (`singleFontFamily` and `multiFontFamily` both
 * defining `fontFamily.EXP_NEUE`) is the same style. */
function once(named: Named[]): Named[] {
  const seen = new Set<string>();
  return named.filter((n) => {
    const { family, size, weight } = useOf(n.font);
    const key = [n.path.join("\0"), family.toLowerCase().replace(/[^a-z0-9]/g, ""), size, weight].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
