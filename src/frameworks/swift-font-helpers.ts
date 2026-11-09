/**
 * An app's own fonts: `static var scaledBody: Font { … }`, `static let brand = Font.custom(…)`,
 * `class var dynamicTypeBody: UIFont { … }`, on `Font`, `UIFont`, `NSFont` or the app's own types. Each is read
 * from its body; a helper whose font is worked out at run time is `computed`, never guessed from its name.
 */

import { firstAtOrAfter } from "../scan/sorted.js";
import { COMPUTED, type TypeUse } from "../scan/type-scale.js";
import { expressionAt } from "./swift-expressions.js";
import { FONT_TYPES, type FontValue, fontValues } from "./swift-font-reading.js";
import type { FontSite } from "./swift-font-sites.js";
import { type SwiftTokens, tokenIndexAt } from "./swift-tokens.js";

export type Range = [start: number, end: number];

export interface FontHelper {
  name: string;
  /** The type it's declared on (`Font`, `UIFont`, `AppFont`), or empty at the top level. */
  owner: string;
  /** A function, `static func brand(size:) -> Font`, rather than a property: a type can declare both by one name. */
  isFunction: boolean;
  font: TypeUse;
  /** Its body, whose fonts count through the helper's uses rather than on their own. */
  body: Range;
  /** Whether its body passes a parameter straight on as the size, so a call's size is the font's. */
  sizeParameter: boolean;
  /** The fonts written in its body, and where. */
  written: { font: TypeUse; at: number }[];
}

const DECLARERS = new Set(["static", "class"]);
const MEMBERS = new Set(["let", "var", "func"]);
const TYPE_KEYWORDS = new Set(["extension", "struct", "class", "enum", "actor"]);
/** How far back from a `{` a type's declaration (`extension Font where … {`) can start. */
const MAX_TYPE_HEADER_TOKENS = 64;
/** How many brackets out from a declaration its type is looked for; real types nest a few deep. */
const MAX_OWNER_DEPTH = 16;
/** How far into a helper's body its fonts are looked for; real helpers are a few lines. */
const MAX_BODY_TOKENS = 512;
/** How many of a body's fonts are compared to find what they share. */
const MAX_BODY_FONTS = 8;

/** The font helpers declared in `file`, given the fonts found in it. */
export function fontHelpers(file: SwiftTokens, sites: FontSite[]): FontHelper[] {
  const helpers: FontHelper[] = [];
  const ordered = [...sites].sort((a, b) => a.at - b.at);
  const starts = ordered.map((s) => s.at);
  file.tokens.forEach((token, i) => {
    if (!DECLARERS.has(token.text) || !MEMBERS.has(file.tokens[i + 1]?.text ?? "")) return;
    const declaration = declarationAt(file, i + 2);
    if (!declaration) return;
    const [start, end] = declaration.body;
    const sitesInBody: FontSite[] = [];
    for (
      let k = firstAtOrAfter(starts, start);
      sitesInBody.length < MAX_BODY_FONTS && (ordered[k]?.at ?? end) < end;
      k++
    ) {
      sitesInBody.push(ordered[k] as FontSite);
    }
    // A body's expression can also be a font site (`{ UIFont.preferredFont(…) }`): each place is read once.
    const read = bodyValues(file, declaration.body);
    const readAt = new Set(read.map((r) => r.at));
    const all = [
      ...read,
      ...sitesInBody.filter((s) => !readAt.has(s.at)).map((s) => ({ value: s.value, at: s.at })),
    ];
    const fonts = all
      .slice(0, MAX_BODY_FONTS)
      .flatMap(({ value, at }) => ("font" in value ? [{ ...value, at }] : []));
    const font = shared(fonts.map((v) => v.font));
    const sizeParameter = fonts.some(
      (v) => v.sizeFrom !== undefined && declaration.parameters.includes(v.sizeFrom),
    );
    helpers.push({
      name: declaration.name,
      owner: ownerAt(file, i),
      isFunction: file.tokens[i + 1]?.text === "func",
      font: { ...font, kind: "app", style: declaration.name },
      body: declaration.body,
      sizeParameter,
      written: fonts.map(({ font, at }) => ({ font, at })),
    });
  });
  return helpers;
}

/** The helper declared from the name at `at`: `name(parameters) -> Font {`, `name: UIFont {`, `name = Font.custom(…)`. */
function declarationAt(
  file: SwiftTokens,
  at: number,
): { name: string; parameters: string[]; body: Range } | undefined {
  const { tokens, match } = file;
  const name = tokens[at];
  if (name?.kind !== "name") return undefined;
  let i = at + 1;
  const parameters: string[] = [];
  if (tokens[i]?.text === "(") {
    const close = match[i] ?? -1;
    if (close === -1) return undefined;
    // `(_ size: CGFloat, weight w: Font.Weight)`: the name before each `:` is the one the body uses.
    for (let k = i + 1; k < close; k++)
      if (tokens[k + 1]?.text === ":" && tokens[k]?.kind === "name") parameters.push(tokens[k]?.text ?? "");
    i = close + 1;
  }
  const typed = tokens[i]?.text === ":" || tokens[i]?.text === "->";
  if (typed) {
    i++;
    if (tokens[i]?.text === "SwiftUI" && tokens[i + 1]?.text === ".") i += 2;
    // `Font` but not `Font.Weight` or `Font.TextStyle`.
    if (!FONT_TYPES.has(tokens[i]?.text ?? "") || tokens[i + 1]?.text === ".") return undefined;
    i++;
  } else if (tokens[i]?.text !== "=" || !FONT_TYPES.has(tokens[i + 1]?.text ?? "")) return undefined;
  const body = bodyAt(file, i);
  return body && { name: name.text, parameters, body };
}

/** A helper's body: its `{ … }`, or the expression after `=`. */
function bodyAt(file: SwiftTokens, at: number): Range | undefined {
  const token = file.tokens[at];
  if (token?.text === "{") {
    const close = file.tokens[file.match[at] ?? -1];
    return close ? [token.start, close.end] : undefined;
  }
  if (token?.text !== "=") return undefined;
  const value = expressionAt(file, file.tokens[at + 1]?.start ?? file.text.length);
  return value && [token.start, value.end];
}

/** The fonts a body returns: its expression after `=`, its single expression `{ .title }`, or each `return`. */
function bodyValues(file: SwiftTokens, [start, end]: Range): { value: FontValue; at: number }[] {
  const values: { value: FontValue; at: number }[] = [];
  const readAt = (index: number) => {
    const expression = expressionAt(file, file.tokens[index]?.start ?? end);
    if (expression && expression.end <= end) {
      for (const value of fontValues(expression)) values.push({ value, at: expression.start });
    }
  };
  const first = tokenIndexAt(file, start);
  const opener = file.tokens[first]?.text;
  if (opener === "=") readAt(first + 1);
  else if (opener === "{") {
    readAt(file.tokens[first + 1]?.text === "return" ? first + 2 : first + 1);
    const stop = first + MAX_BODY_TOKENS;
    for (let i = first + 1; i < stop && (file.tokens[i]?.start ?? end) < end; i++) {
      if (file.tokens[i]?.text === "return") readAt(i + 1);
    }
  }
  return values;
}

/** What a helper's fonts share; a family, size or weight that differs between them (a `switch`) has no one value. */
function shared(fonts: TypeUse[]): TypeUse {
  const [one] = fonts;
  if (!one) return { kind: "app", family: "", weight: COMPUTED };
  const same = <K extends "family" | "size" | "weight">(key: K) => fonts.every((f) => f[key] === one[key]);
  return {
    kind: "app",
    family: same("family") ? one.family : "",
    ...(same("size") && one.size !== undefined ? { size: one.size } : {}),
    weight: same("weight") ? one.weight : COMPUTED,
  };
}

/** The type the token at `index` is declared in: the nearest enclosing `extension Font {`, `enum AppFont {`, …. */
export function ownerAt(file: SwiftTokens, index: number): string {
  let open = file.enclosing[index] ?? -1;
  for (let depth = 0; open !== -1 && depth < MAX_OWNER_DEPTH; depth++, open = file.enclosing[open] ?? -1) {
    if (file.tokens[open]?.text !== "{") continue;
    for (let k = open - 1; k >= 0 && k >= open - MAX_TYPE_HEADER_TOKENS; k--) {
      const token = file.tokens[k];
      if (!token || token.text === "{" || token.text === "}") break;
      if (!TYPE_KEYWORDS.has(token.text) || file.tokens[k + 1]?.kind !== "name") continue;
      // `extension SwiftUI.Font`: the type is the last part of its name.
      let name = k + 1;
      while (file.tokens[name + 1]?.text === "." && file.tokens[name + 2]?.kind === "name") name += 2;
      return file.tokens[name]?.text ?? "";
    }
  }
  return "";
}
