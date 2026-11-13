/** Colours as CSS and React Native write them. */

import { normalizeHex, rgbToHex } from "../scan/tokens.js";

/** CSS colour names, for colours a theme gives by name (`surface: "white"`). */
export const CSS_NAMES: Record<string, string> = {
  transparent: "#00000000",
  white: "#ffffff",
  black: "#000000",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  yellow: "#ffff00",
  orange: "#ffa500",
  purple: "#800080",
  pink: "#ffc0cb",
  gray: "#808080",
  grey: "#808080",
  lightgray: "#d3d3d3",
  lightgrey: "#d3d3d3",
  darkgray: "#a9a9a9",
  darkgrey: "#a9a9a9",
};

const NUMBER = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?`;
/** A function's arguments, comma- or space-separated, with an optional `/ alpha`. */
const ARGUMENTS = new RegExp(
  String.raw`^(\w+)\(\s*(${NUMBER}(?:deg|%)?)(?:\s*,\s*|\s+)(${NUMBER}%?)(?:\s*,\s*|\s+)(${NUMBER}%?)(?:\s*[,/]\s*(${NUMBER}%?))?\s*\)$`,
  "i",
);

/** `#rgb[a]`, `#rrggbb[aa]`, `rgb()`, `rgba()`, `hsl()`, `hsla()` or `oklch()` as `#rrggbb[aa]`; with `names`, a CSS
 * colour name too. Undefined for anything else. */
export function colorOf(text: string, names = false): string | undefined {
  const value = text.trim();
  if (value.startsWith("#")) return normalizeHex(value);
  if (names && CSS_NAMES[value.toLowerCase()]) return CSS_NAMES[value.toLowerCase()];
  const m = value.match(ARGUMENTS);
  if (!m) return undefined;
  const fn = (m[1] ?? "").toLowerCase();
  const [a, b, c] = [m[2] ?? "", m[3] ?? "", m[4] ?? ""];
  const alpha = m[5] === undefined ? 1 : fraction(m[5], 1);
  if (fn === "rgb" || fn === "rgba")
    return rgbToHex(fraction(a, 255), fraction(b, 255), fraction(c, 255), alpha);
  if (fn === "hsl" || fn === "hsla")
    return hslToHex(Number.parseFloat(a), fraction(b, 100), fraction(c, 100), alpha);
  // OKLCH's chroma is a number; as a percentage, 100% is 0.4.
  const chroma = b.endsWith("%") ? (Number.parseFloat(b) / 100) * 0.4 : Number.parseFloat(b);
  if (fn === "oklch") return oklchToHex(fraction(a, 1), chroma, Number.parseFloat(c), alpha);
  return undefined;
}

/** A number, or a percentage, as a share of `whole`. */
const fraction = (text: string, whole: number) =>
  text.endsWith("%") ? Number.parseFloat(text) / 100 : Number.parseFloat(text) / whole;

function hslToHex(degrees: number, s: number, l: number, alpha: number): string {
  const hue = ((degrees % 360) + 360) % 360;
  const k = (n: number) => (n + hue / 30) % 12;
  const chroma = s * Math.min(l, 1 - l);
  const f = (n: number) => l - chroma * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return rgbToHex(f(0), f(8), f(4), alpha);
}

/** OKLCH (lightness 0–1, chroma, hue in degrees) through OKLab to sRGB, clamped to what sRGB shows. */
function oklchToHex(l: number, chroma: number, hue: number, alpha: number): string {
  const rad = (hue * Math.PI) / 180;
  const [labA, labB] = [chroma * Math.cos(rad), chroma * Math.sin(rad)];
  const l1 = (l + 0.3963377774 * labA + 0.2158037573 * labB) ** 3;
  const m1 = (l - 0.1055613458 * labA - 0.0638541728 * labB) ** 3;
  const s1 = (l - 0.0894841775 * labA - 1.291485548 * labB) ** 3;
  const linear = [
    4.0767416621 * l1 - 3.3077115913 * m1 + 0.2309699292 * s1,
    -1.2684380046 * l1 + 2.6097574011 * m1 - 0.3413193965 * s1,
    -0.0041960863 * l1 - 0.7034186147 * m1 + 1.707614701 * s1,
  ];
  const gamma = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
  const [r, g, b] = linear.map((x) => gamma(Math.max(0, Math.min(1, x))));
  return rgbToHex(r ?? 0, g ?? 0, b ?? 0, alpha);
}
