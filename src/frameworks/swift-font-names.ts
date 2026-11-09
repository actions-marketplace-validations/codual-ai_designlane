/** The names fonts are written with in Swift: Apple's text styles, weights, and custom font names. */

import { COMPUTED, type TypeUse, weightLabel } from "../scan/type-scale.js";

/** Apple's text styles at the default text size, as point size and weight. UIKit writes `title1` and `caption1`. */
const TEXT_STYLES = {
  largeTitle: [34, "regular"],
  title: [28, "regular"],
  title1: [28, "regular"],
  title2: [22, "regular"],
  title3: [20, "regular"],
  headline: [17, "semibold"],
  body: [17, "regular"],
  callout: [16, "regular"],
  subheadline: [15, "regular"],
  footnote: [13, "regular"],
  caption: [12, "regular"],
  caption1: [12, "regular"],
  caption2: [11, "regular"],
} as const satisfies Record<string, readonly [number, string]>;
export type TextStyleName = keyof typeof TEXT_STYLES;
export const isTextStyle = (name: string): name is TextStyleName => Object.hasOwn(TEXT_STYLES, name);

/** The weights Swift names: `.bold`, `UIFont.Weight.semibold`. */
export const WEIGHTS = new Set([
  "ultraLight",
  "thin",
  "light",
  "regular",
  "medium",
  "semibold",
  "bold",
  "heavy",
  "black",
]);

/** Weight words in custom font names, lower-cased, as weights: `Inter-SemiBold` is `semibold`. */
const NAMED_WEIGHTS: Record<string, string> = {
  thin: "thin",
  extralight: "ultraLight",
  ultralight: "ultraLight",
  light: "light",
  regular: "regular",
  book: "regular",
  medium: "medium",
  semibold: "semibold",
  demibold: "semibold",
  bold: "bold",
  extrabold: "heavy",
  heavy: "heavy",
  black: "black",
};
/** A trailing weight or style in a font's name: `-Bold`, `_Medium`, ` Italic`, or `BoldItalic` run together. */
const NAME_STYLES = [...Object.keys(NAMED_WEIGHTS), "italic"];
const SEPARATED_STYLE = new RegExp(`[-_ ](${NAME_STYLES.join("|")})$`, "i");
const JOINED_STYLE = new RegExp(`(?<=[a-z])(${NAME_STYLES.flatMap(spellings).join("|")})$`);
/** A Swift string interpolation, `\(weight)`, which can't be read. */
const INTERPOLATION = /\\\([^()]*\)/g;

/** The text style at Apple's default size; a changed weight shows in its name (`headline regular`). */
export function textStyle(name: TextStyleName, weight?: string): TypeUse {
  const [size, defaultWeight] = TEXT_STYLES[name];
  const changed = weight !== undefined && weight !== defaultWeight;
  return {
    kind: "text-style",
    family: "System",
    size,
    weight: weight ?? defaultWeight,
    style: changed ? `${name} ${weightLabel(weight)}` : name,
  };
}

/** `Inter-Regular_Medium` → family `Inter`, weight `medium`: the last weight word wins. `"Inter-\(w)"` is Inter at a
 * computed weight; a name that is all interpolation, `"\(base)"`, is an unknown family. */
export function fontName(name: string): { family: string; weight: string } {
  const interpolated = name.includes("\\(");
  let family = name.replace(INTERPOLATION, "").trim();
  let weight: string | undefined;
  for (let m = trailingStyle(family); m; m = trailingStyle(family)) {
    weight ??= NAMED_WEIGHTS[(m[1] ?? m[2] ?? "").toLowerCase()];
    family = family.slice(0, m.index);
  }
  return { family: family.replace(/[-_ ]+$/, ""), weight: weight ?? (interpolated ? COMPUTED : "regular") };
}

const trailingStyle = (name: string) => SEPARATED_STYLE.exec(name) ?? JOINED_STYLE.exec(name);

/** How a style word is capitalised when run into a name: `Bold`, and both `Semibold` and `SemiBold`. */
function spellings(word: string): string[] {
  const capital = word.charAt(0).toUpperCase() + word.slice(1);
  const compound = capital.replace(
    /^(Extra|Ultra|Semi|Demi)(\w)/,
    (_, prefix, next) => prefix + next.toUpperCase(),
  );
  return compound === capital ? [capital] : [capital, compound];
}
