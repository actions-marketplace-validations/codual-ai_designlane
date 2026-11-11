/** tokens.json's colours and fonts in Figma's terms, kept apart from the Figma API so they can be tested. */

import { sameRgba } from "../../src/sync/plan.js";
import type { Rgba, TextValue } from "../../src/sync/tokens-file.js";

const channel = (hex: string, at: number) => Number.parseInt(hex.slice(at, at + 2), 16) / 255;
const byte = (value: number) =>
  Math.round(value * 255)
    .toString(16)
    .padStart(2, "0");

export const toFigmaColor = ({ hex, alpha }: Rgba): RGBA => ({
  r: channel(hex, 1),
  g: channel(hex, 3),
  b: channel(hex, 5),
  a: alpha,
});

export const fromFigmaColor = ({ r, g, b, a }: RGBA): Rgba => ({
  hex: `#${byte(r)}${byte(g)}${byte(b)}`,
  alpha: a,
});

const REGULAR_WEIGHT = 400;
const ITALIC_SUFFIX = /\s*Italic$/i;

/** The style names fonts use for each weight, most common spelling first: `Semibold` in SF Pro, `Semi Bold` in
 * Inter. */
const WEIGHT_STYLES: Record<number, string[]> = {
  100: ["Thin"],
  200: ["Ultralight", "Extra Light", "ExtraLight"],
  300: ["Light"],
  400: ["Regular"],
  500: ["Medium"],
  600: ["Semibold", "Semi Bold", "SemiBold"],
  700: ["Bold"],
  800: ["Heavy", "Extra Bold", "ExtraBold"],
  900: ["Black"],
};

/** The name, among a family's `styles`, it uses for `weight`, or undefined when it has none. */
function styleForWeight(weight: number, styles: string[]): string | undefined {
  return (WEIGHT_STYLES[weight] ?? []).find((name) => styles.includes(name));
}

/** The weight a font style name stands for, or regular for a name that names none. */
export function weightOfStyle(style: string): number {
  const plain = style.replace(ITALIC_SUFFIX, "").toLowerCase();
  const found = Object.entries(WEIGHT_STYLES).find(([, names]) =>
    names.some((name) => name.toLowerCase() === plain),
  );
  return found ? Number(found[0]) : REGULAR_WEIGHT;
}

/** iOS's system font, for a new style the code gives no family. */
const DEFAULT_FAMILY = "SF Pro";

/** What the code says of a text style's font. */
export type FontValue = Pick<TextValue, "family" | "weight">;

/** The font a text style gets from the code's `value`, given its `current` font (none for a new style) and the styles
 * of each family the file has. What the code doesn't set keeps the style's own; its own style stays when it has the
 * code's weight, so an italic stays italic. `style` is missing when the family doesn't have one that fits. Used both
 * to plan and to apply, so the two never disagree. */
export function fontFor(
  value: FontValue,
  current: FontName | undefined,
  fontStyles: Map<string, string[]>,
): { family: string; style?: string } {
  const family = value.family ?? current?.family ?? DEFAULT_FAMILY;
  const styles = fontStyles.get(family) ?? [];
  const own = current?.style;
  if (own && styles.includes(own) && (value.weight === undefined || weightOfStyle(own) === value.weight)) {
    return { family, style: own };
  }
  const style = styleForWeight(value.weight ?? REGULAR_WEIGHT, styles);
  return style ? { family, style } : { family };
}

/** The font the code asks for, in words: "SF Pro", or "SF Pro at weight 600". */
export const describeFont = (family: string, weight: number | undefined) =>
  weight === undefined ? family : `${family} at weight ${weight}`;

/** Whether a colour looks different in dark mode; a dark value equal to the light one is no dark value at all. */
export const hasOwnDark = (light: Rgba, dark: Rgba | undefined) =>
  dark !== undefined && !sameRgba(dark, light);
