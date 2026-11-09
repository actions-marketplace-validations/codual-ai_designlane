/**
 * What a Swift font expression sets, read from its structure: Apple's text styles (`.headline`,
 * `UIFont.preferredFont(forTextStyle: .body)`), system fonts at a size, custom fonts, and the app's own font helpers,
 * with the weight and size changes written after them (`.bold()`, `.weight(.medium)`, `.withSize(32)`). Anything
 * worked out at run time is `computed`, never guessed.
 */

import { COMPUTED, type TypeUse } from "../scan/type-scale.js";
import { type Argument, chain, type Expression } from "./swift-expressions.js";
import { fontName, isTextStyle, type TextStyleName, textStyle, WEIGHTS } from "./swift-font-names.js";

/** The types fonts are made from: SwiftUI's, UIKit's and AppKit's. */
export const FONT_TYPES = new Set(["Font", "UIFont", "NSFont"]);

/** A reference to one of the app's own font helpers: `.scaledBody`, `AppFont.title`, `UIFont.dynamicTypeBody`. */
export interface HelperReference {
  /** The type it's named on; undefined when written as `.name` and found by the type the context expects. */
  owner?: string;
  name: string;
  args: Argument[];
  /** Whether it's called, `.brand(size: 24)`, so it names a helper function rather than a property. */
  called: boolean;
  /** A weight or size set on the helper's font after it: `.dynamicTypeFootnote.semibold()`, `.withSize(32)`. */
  weight?: string;
  size?: number;
  /** Where the reference starts. */
  at: number;
}

/** A font an expression sets: one written out (with the text style it is, if any, and the parameter its size comes
 * straight from, `size: size`, so a helper's call can supply it), or one of the app's helpers. */
export type FontValue =
  | { font: TypeUse; style?: TextStyleName; sizeFrom?: string }
  | { helper: HelperReference };

const SYSTEM_SIZED = new Set([
  "systemFont",
  "monospacedSystemFont",
  "monospacedDigitSystemFont",
  "italicSystemFont",
]);
/** What can follow a font and leave it a font: changes to its weight, size, width or figures. Anything else reads
 * something from the font (`.lineHeight`), which sets no font. */
const KEEPS_FONT = new Set([
  "bold",
  "italic",
  "weight",
  "fontWeight",
  "withSize",
  "width",
  "leading",
  "monospaced",
  "monospacedDigit",
  "smallCaps",
  "lowercaseSmallCaps",
  "uppercaseSmallCaps",
  // A font's descriptor describes that same font, and is used to make it: `UIFont(descriptor: f.fontDescriptor, …)`.
  "fontDescriptor",
]);
/** Conversions that keep a number as it is: `CGFloat(17)`. */
const NUMBER_TYPES = new Set(["CGFloat", "Double", "Float", "Int"]);
/** The labels a font's size is passed with. */
export const SIZE_LABELS = new Set(["size", "ofSize", "fixedSize"]);

/** The fonts `expression` sets: both sides of a ternary, the font a `??` falls back from, the font inside `Font(…)`
 * or `UIFontMetrics(…).scaledFont(for:)`. Nothing for an expression that isn't a font. */
export function fontValues(expression: Expression): FontValue[] {
  const e = expression.kind === "postfix" ? expression.operand : expression;
  if (e.kind === "ternary") return [...fontValues(e.then), ...fontValues(e.otherwise)];
  // `UIFont(name: "Inter", size: 17) ?? .systemFont(ofSize: 17)`: the system font only stands in for the custom one.
  if (e.kind === "binary" && e.operator === "??") return fontValues(e.left);
  // `Font(metrics.scaledFont(for: f) as CTFont)`: a cast leaves the font as it was.
  if (e.kind === "binary" && e.operator.startsWith("as")) return fontValues(e.left);
  const { root, links } = chain(e);
  const base = baseFont(root, links, e.start);
  if (!base) return [];
  // `UIFont.systemFont(ofSize: 12).lineHeight` reads a measurement from a font, which sets no font.
  if (links.slice(base.links).some((l) => !KEEPS_FONT.has(l.name) && !WEIGHTS.has(l.name))) return [];
  return [withChanges(base.value, changesIn(links.slice(base.links)))];
}

/** The font a chain starts with, and how many of its links that took. */
function baseFont(
  root: Expression | undefined,
  links: Link[],
  at: number,
): { value: FontValue; links: number } | undefined {
  if (root?.kind === "call" && root.callee.kind === "name") {
    const name = root.callee.name;
    const only =
      root.args.length === 1 && root.args[0]?.label === undefined ? root.args[0]?.value : undefined;
    // `Font(uiFont)` and `UIFontMetrics(forTextStyle: …).scaledFont(for: font)` wrap another font.
    if (name === "Font" && only) return wrapped(only, 0);
    if (name === "UIFontMetrics" && links[0]?.name === "scaledFont") {
      const font = links[0].args?.find((a) => a.label === "for")?.value;
      return font ? wrapped(font, 1) : undefined;
    }
    if (FONT_TYPES.has(name) && root.args.some((a) => a.label === "name")) {
      return { value: customFont(root.args, "name"), links: 0 };
    }
    return undefined;
  }
  const typed = root?.kind === "name" && (FONT_TYPES.has(root.name) || root.name === "SwiftUI");
  const first = root === undefined || typed ? (links[0]?.name === "Font" ? 1 : 0) : -1;
  if (first === -1) return helperOn(root, links, at);
  const link = links[first];
  if (!link) return undefined;
  const known = knownFont(link.name, link.args);
  if (known) return { value: known, links: first + 1 };
  const owner = root?.kind === "name" && root.name !== "SwiftUI" ? { owner: root.name } : {};
  return {
    value: {
      helper: { ...owner, name: link.name, args: link.args ?? [], called: link.args !== undefined, at },
    },
    links: first + 1,
  };
}

/** The font inside a wrapper, `Font(x)`, carrying on past the wrapper's own links. */
function wrapped(inner: Expression, links: number): { value: FontValue; links: number } | undefined {
  const [value] = fontValues(inner);
  return value ? { value, links: links + 1 } : undefined;
}

/** `Theme.Fonts.title`, `Self.heading`: a helper named on the app's own type, the last link being its name. */
function helperOn(
  root: Expression | undefined,
  links: Link[],
  at: number,
): { value: FontValue; links: number } | undefined {
  if (root?.kind !== "name" || links.length === 0 || !/^[A-Z]/.test(root.name)) return undefined;
  // The helper is the first link that isn't a type name: `Theme.Fonts.title` is `title` on `Fonts`.
  let index = 0;
  while (index < links.length - 1 && /^[A-Z]/.test(links[index]?.name ?? "")) index++;
  const link = links[index];
  if (!link) return undefined;
  const owner = index === 0 ? root.name : (links[index - 1]?.name ?? root.name);
  return {
    value: { helper: { owner, name: link.name, args: link.args ?? [], called: link.args !== undefined, at } },
    links: index + 1,
  };
}

/** A font Apple's frameworks define, named by `name` and called with `args`, if it is one. */
function knownFont(name: string, args: Argument[] | undefined): FontValue | undefined {
  if (isTextStyle(name) && !args) return styled(name);
  if (name === "custom" && args) return customFont(args);
  if (name === "system" && args) {
    const style = args[0]?.label === undefined ? args[0]?.value : undefined;
    const weight = weightOf(args.find((a) => a.label === "weight")?.value);
    if (style?.kind === "member" && !style.base && isTextStyle(style.name)) return styled(style.name, weight);
    return systemFont(args, weight ?? "regular");
  }
  if (SYSTEM_SIZED.has(name) && args)
    return systemFont(args, weightOf(args.find((a) => a.label === "weight")?.value) ?? "regular");
  if (name === "boldSystemFont" && args) return systemFont(args, "bold");
  if (name === "preferredFont" && args) {
    const style = args.find((a) => a.label === "forTextStyle")?.value;
    if (style?.kind === "member" && isTextStyle(style.name)) return styled(style.name);
    return { font: { kind: "text-style", family: "System", weight: COMPUTED } };
  }
  return undefined;
}

const styled = (style: TextStyleName, weight?: string): FontValue => ({
  font: textStyle(style, weight),
  style,
});

function systemFont(args: Argument[], weight: string): FontValue {
  const size = args.find((a) => SIZE_LABELS.has(a.label ?? ""))?.value;
  return { font: { kind: "system", family: "System", ...sized(size), weight }, ...sizeSource(size) };
}

/** `.custom("Inter-Bold", size: 17)` or `UIFont(name: "Inter", size: 17)`; a family that's a constant is unknown. */
function customFont(args: Argument[], familyLabel?: string): FontValue {
  const family = (familyLabel ? args.find((a) => a.label === familyLabel) : args[0])?.value;
  const named = family?.kind === "string" ? fontName(family.value) : { family: "", weight: COMPUTED };
  const size = args.find((a) => SIZE_LABELS.has(a.label ?? ""))?.value;
  return {
    font: { kind: "custom", family: named.family, ...sized(size), weight: named.weight },
    ...sizeSource(size),
  };
}

type Link = { name: string; args?: Argument[] };

/** The weight and size changes in a chain of links after a font: `.bold()`, `.weight(.medium)`, `.withSize(32)`. A
 * later `.font(…)` replaces the font, so the changes stop there. */
export function changesIn(links: Link[]): { weight?: string; size?: number } {
  let weight: string | undefined;
  let size: number | undefined;
  for (const { name, args } of links) {
    if (name === "font") break;
    if (name === "bold") weight = boldness(args) ?? weight;
    else if ((name === "weight" || name === "fontWeight") && args)
      weight = weightOf(args[0]?.value) ?? COMPUTED;
    // UIKit apps add weight methods of their own: `UIFont.dynamicTypeFootnote.semibold()`.
    else if (WEIGHTS.has(name) && args?.length === 0) weight = name;
    else if (name === "withSize" && args) size = sized(args[0]?.value).size;
  }
  return { ...(weight ? { weight } : {}), ...(size === undefined ? {} : { size }) };
}

/** `value` with the given weight and size changes applied. */
export function withChanges(value: FontValue, changes: { weight?: string; size?: number }): FontValue {
  if ("helper" in value) return { helper: { ...value.helper, ...changes } };
  const restyled = value.style && changes.weight ? textStyle(value.style, changes.weight) : value.font;
  return { ...value, font: { ...restyled, ...changes } };
}

/** `.bold()` is bold, `.bold(true)` too; `.bold(false)` changes nothing; `.bold(isOn)` can't be read. */
function boldness(args: Argument[] | undefined): string | undefined {
  const value = args?.[0]?.value;
  if (!value) return "bold";
  if (value.kind === "name" && value.name === "true") return "bold";
  return value.kind === "name" && value.name === "false" ? undefined : COMPUTED;
}

/** `.bold`, `Font.Weight.bold` or `UIFont.Weight.bold` as a weight; anything else is worked out at run time. */
function weightOf(value: Expression | undefined): string | undefined {
  if (!value) return undefined;
  return value.kind === "member" && WEIGHTS.has(value.name) ? value.name : COMPUTED;
}

/** A size written as a number, `17` or `CGFloat(17)`; nothing for one worked out at run time (`adaptive(14)`). */
function sized(value: Expression | undefined): { size?: number } {
  const converted =
    value?.kind === "call" && value.callee.kind === "name" && NUMBER_TYPES.has(value.callee.name);
  // Only an unlabelled conversion keeps the number as it is: `CGFloat(exactly: 17)` may give no number at all.
  const plain = converted && value.args.length === 1 && value.args[0]?.label === undefined;
  const number = plain ? value.args[0]?.value : value;
  return number?.kind === "number" ? { size: number.value } : {};
}

function sizeSource(value: Expression | undefined): { sizeFrom?: string } {
  return value?.kind === "name" ? { sizeFrom: value.name } : {};
}
