/** What tokens.json and DESIGN.md call each value, worked out once so both files name every token the same way. */

import type { ColorToken, TypeStyle } from "../scan/types.js";

/** A token's key: the app's own name, or `hex-33a854` for a colour the code never names. Anything but letters,
 * digits, `_` and `-` becomes `-`, since keys can't contain `.`, `{` or `}` in either format. */
export function tokenKey(name: string): string {
  const key = name.startsWith("#") ? `hex-${name.slice(1)}` : name;
  return key.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "") || "unnamed";
}

/** Gives each of `keys` its own: a key already taken gets `-2`, `-3`, …, so two names that read the same (`a.b` and
 * `a-b`, or `x`'s dark `x-dark` and a real `x-dark`) never overwrite each other. */
function claim(taken: Set<string>, key: string): string {
  let unique = key;
  for (let n = 2; taken.has(unique); n++) unique = `${key}-${n}`;
  taken.add(unique);
  return unique;
}

export interface KeyedColor {
  color: ColorToken;
  key: string;
  /** The key of its dark value, when it has one. */
  darkKey?: string;
}

export function keyedColors(colors: ColorToken[]): KeyedColor[] {
  const taken = new Set<string>();
  const keyed = colors.map((color) => ({ color, key: claim(taken, tokenKey(color.name)) }));
  return keyed.map((k) => (k.color.dark ? { ...k, darkKey: claim(taken, `${k.key}-dark`) } : k));
}

/** A text style's values that the code sets: a size or weight it computes is left out. */
export interface TypeValues {
  fontFamily?: string;
  /** In points. */
  fontSize?: number;
  fontWeight?: number;
}

export interface KeyedStyle {
  style: TypeStyle;
  key: string;
  values: TypeValues;
}

/** Font weights as the numbers both formats use. */
const WEIGHT_NUMBERS: Record<string, number> = {
  thin: 100,
  ultraLight: 200,
  light: 300,
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  heavy: 800,
  black: 900,
};

/** A text style's key: the app's own name (`senbaCaption`, `headline`), or a description made into one
 * (`System 15 semibold` is `system-15-semibold`; `System, computed size semibold` is `system-semibold`). */
function typeStyleKey(style: TypeStyle): string {
  if (style.kind === "app" || style.kind === "text-style") return tokenKey(style.name);
  const words =
    style.name
      .toLowerCase()
      .replace(/computed (?:size|weight)/g, "")
      .match(/[a-z0-9.]+/g) ?? [];
  return tokenKey(words.join("-"));
}

export function keyedStyles(styles: TypeStyle[]): KeyedStyle[] {
  const taken = new Set<string>();
  return styles.map((style) => {
    const weight = WEIGHT_NUMBERS[style.weight];
    // The platform font on Apple platforms is SF Pro; an empty family (a helper mixing several) has none.
    const family = style.family === "System" ? "SF Pro" : style.family;
    const values: TypeValues = {
      ...(family ? { fontFamily: family } : {}),
      ...(style.size !== undefined ? { fontSize: style.size } : {}),
      ...(weight !== undefined ? { fontWeight: weight } : {}),
    };
    return { style, key: claim(taken, typeStyleKey(style)), values };
  });
}

/** A dimension's key, `space-16` or `radius-0_5`: never a bare number, which JavaScript would reorder. */
export const dimensionKey = (prefix: string, value: number) => `${prefix}-${String(value).replace(".", "_")}`;
