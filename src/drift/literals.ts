/** Colours, spacing and corner radii written as plain values in UI code, each framework's common forms. */

import { normalizeHex, rgbToHex } from "../scan/tokens.js";
import type { FrameworkId } from "../scan/types.js";

export type ScaleKind = "spacing" | "radius";

interface ColorLiteral {
  pattern: RegExp;
  hex: (m: RegExpMatchArray) => string | undefined;
}

/** One channel written whole, `0.2` or `51 / 255`, captured as its number and whether it's out of 255. */
const CHANNEL = String.raw`\s{0,20}(\d+(?:\.\d+)?)(\s{0,20}\/\s{0,20}255(?:\.0)?)?\s{0,20}`;
/** `Color(red: …, green: …, blue: …)`, with an `opacity:` or `alpha:` when written, ending at its `)`, so a channel
 * computed some other way (`0.2 * k`) isn't read as a value. */
const SWIFT_RGB = new RegExp(
  String.raw`\b(?:Color|UIColor)\(\s{0,20}(?:\.sRGB\s{0,20},\s{0,20})?red:${CHANNEL},\s{0,20}green:${CHANNEL},\s{0,20}blue:${CHANNEL}(?:,\s{0,20}(?:opacity|alpha):${CHANNEL})?\)`,
  "g",
);

/** A captured channel as 0–1. */
const channel = (value: string | undefined, outOf255: string | undefined) =>
  outOf255 ? Number(value) / 255 : Number(value);

export const COLOR_LITERALS: Record<FrameworkId, ColorLiteral[]> = {
  swiftui: [
    {
      pattern: /\b(?:Color|UIColor)\(\s{0,20}hex:\s{0,20}(?:"#?|0x)([0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?)\b/g,
      hex: (m) => normalizeHex(m[1] ?? ""),
    },
    {
      pattern: SWIFT_RGB,
      hex: (m) =>
        rgbToHex(
          channel(m[1], m[2]),
          channel(m[3], m[4]),
          channel(m[5], m[6]),
          m[7] === undefined ? 1 : channel(m[7], m[8]),
        ),
    },
  ],
  compose: [
    {
      pattern: /\bColor\(\s{0,20}0x([0-9A-Fa-f]{8})\s{0,20}\)/g,
      hex: (m) => normalizeHex(`${m[1]?.slice(2)}${m[1]?.slice(0, 2)}`),
    },
  ],
  "react-native": [
    {
      pattern:
        /\b(?:color|backgroundColor|border(?:Top|Bottom|Left|Right)?Color|tintColor|shadowColor|textDecorationColor|fill|stroke|placeholderTextColor|underlayColor)\s{0,20}[:=]\s{0,20}\{?\s{0,20}['"](#[0-9A-Fa-f]{3,8})['"]/g,
      hex: (m) => normalizeHex(m[1] ?? ""),
    },
  ],
};

/** Each value ends where the expression does (`)`, `,`, `}`), so `13 * 2` isn't read as 13. */
export const SCALE_LITERALS: Record<FrameworkId, { kind: ScaleKind; pattern: RegExp }[]> = {
  swiftui: [
    {
      kind: "spacing",
      pattern:
        /(?:\.padding\((?:\.\w+\s{0,20},\s{0,20})?|\bspacing:\s{0,20})(\d+(?:\.\d+)?)(?=\s{0,20}[),}\]\n;])/g,
    },
    {
      kind: "radius",
      pattern: /\bcornerRadius(?::\s{0,20}|\(\s{0,20})(\d+(?:\.\d+)?)(?=\s{0,20}[),}\]\n;])/g,
    },
  ],
  compose: [
    {
      kind: "spacing",
      pattern:
        /\b(?:padding\((?:\w+\s{0,20}=\s{0,20})?|spacedBy\(\s{0,20})(\d+(?:\.\d+)?)\.dp(?=\s{0,20}[),}\]\n;])/g,
    },
    {
      kind: "radius",
      pattern:
        /\bRoundedCornerShape\(\s{0,20}(?:\w+\s{0,20}=\s{0,20})?(\d+(?:\.\d+)?)\.dp(?=\s{0,20}[),}\]\n;])/g,
    },
  ],
  "react-native": [
    {
      kind: "spacing",
      pattern:
        /\b(?:padding|margin|gap)(?:Horizontal|Vertical|Top|Bottom|Left|Right|Start|End)?\s{0,20}:\s{0,20}(\d+(?:\.\d+)?)(?=\s{0,20}[),}\]\n;])/g,
    },
    {
      kind: "radius",
      pattern:
        /\bborder(?:Top|Bottom)?(?:Left|Right)?Radius\s{0,20}:\s{0,20}(\d+(?:\.\d+)?)(?=\s{0,20}[),}\]\n;])/g,
    },
  ],
};
