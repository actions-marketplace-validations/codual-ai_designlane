import { byNumber, mostCommon } from "./counting.js";

/** A 0–255 channel as two hex digits; anything that isn't a number reads as 0. */
const byte = (n: number) =>
  Math.round(Number.isFinite(n) ? Math.max(0, Math.min(255, n)) : 0)
    .toString(16)
    .padStart(2, "0");

/** `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`, with or without `#`, as lowercase `#rrggbb[aa]`. */
export function normalizeHex(input: string): string | undefined {
  let hex = input.trim().replace(/^#/, "").toLowerCase();
  if (!/^[0-9a-f]+$/.test(hex)) return undefined;
  if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join("");
  if (hex.length !== 6 && hex.length !== 8) return undefined;
  if (hex.length === 8 && hex.endsWith("ff")) hex = hex.slice(0, 6);
  return `#${hex}`;
}

/** Red, green, blue and opacity, each 0–1 (values outside are clamped), as `#rrggbb[aa]`. */
export function rgbToHex(r: number, g: number, b: number, a = 1): string {
  return `#${byte(r * 255)}${byte(g * 255)}${byte(b * 255)}${a >= 1 ? "" : byte(a * 255)}`;
}

/** The most common numbers `pattern` captures across `texts`, for spacing and corner radii. */
export function commonNumbers(texts: string[], pattern: RegExp, limit = MAX_SCALE_VALUES): number[] {
  const values = texts.flatMap((text) => [...text.matchAll(pattern)].map((m) => Number(m[1])));
  const inRange = values.filter((n) => Number.isFinite(n) && n > 0 && n <= MAX_SCALE_VALUE);
  return mostCommon(inRange, byNumber)
    .slice(0, limit)
    .map(({ value }) => value);
}

/** Spacing and radii above this are layout sizes, not part of a scale. */
const MAX_SCALE_VALUE = 64;
const MAX_SCALE_VALUES = 6;
