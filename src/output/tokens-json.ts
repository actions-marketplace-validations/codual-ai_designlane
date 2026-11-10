/** The scan as W3C design tokens (DTCG 2025.10), which Figma, Tokens Studio and Style Dictionary import. */

import path from "node:path";
import type { DesignTokens, ScanResult } from "../scan/types.js";
import { dimensionKey, keyedColors, keyedStyles, tokenKey } from "./token-names.js";

interface ColorValue {
  colorSpace: "srgb";
  components: [number, number, number];
  alpha?: number;
  hex: string;
}

interface Token {
  $type: string;
  $value: unknown;
  $description?: string;
  $extensions?: Extensions;
}

/** Designmap's own data on a token or group, which DTCG keeps under `$extensions`. */
type Extensions = { designmap: Record<string, unknown> };

export interface TokenGroup {
  [key: string]: Token | TokenGroup | Extensions | string | undefined;
  $description?: string;
  $extensions?: Extensions;
}

const round = (n: number) => Math.round(n * 1000) / 1000;
const channel = (hex: string, at: number) => round(Number.parseInt(hex.slice(at, at + 2), 16) / 255);
/** Sizes are in points; DTCG's nearest unit is px, which is what a point is at 1x. */
const px = (value: number) => ({ value, unit: "px" });
const uses = (n: number) => `${n} use${n === 1 ? "" : "s"}`;

/** Where a token comes from, for a tool syncing it elsewhere: how the code refers to it, its file, and its uses. */
const origin = (token: { reference?: string; source?: string; uses: number }) => ({
  ...(token.reference ? { reference: token.reference } : {}),
  ...(token.source ? { source: token.source } : {}),
  uses: token.uses,
});

/** `#rrggbb` or `#rrggbbaa` as a DTCG colour. */
export function colorValue(hex: string): ColorValue {
  const h = hex.replace("#", "");
  const value: ColorValue = {
    colorSpace: "srgb",
    components: [channel(h, 0), channel(h, 2), channel(h, 4)],
    hex: `#${h.slice(0, 6)}`,
  };
  if (h.length === 8) value.alpha = channel(h, 6);
  return value;
}

function colors(tokens: DesignTokens): TokenGroup {
  const group: TokenGroup = { $description: "Most used first" };
  for (const { color, key } of keyedColors(tokens.colors)) {
    const where = color.kind === "inline" ? "Written without a name in" : "From";
    group[key] = {
      $type: "color",
      $value: colorValue(color.light),
      $description: `${where} ${color.source}, ${uses(color.uses)}`,
      $extensions: {
        designmap: {
          ...origin(color),
          // DTCG has no modes yet, so a dark value rides here.
          ...(color.dark ? { modes: { dark: colorValue(color.dark) } } : {}),
        },
      },
    };
  }
  return group;
}

/** Each text style as a group of the values the code sets. A DTCG typography token needs line height and letter
 * spacing too, which the code rarely sets, so the values stand as their own tokens rather than as one invented. */
function typography(tokens: DesignTokens): TokenGroup {
  const group: TokenGroup = { $description: "Most used first" };
  for (const { style, key, values } of keyedStyles(tokens.typeStyles)) {
    const { fontFamily, fontSize, fontWeight } = values;
    if (!fontFamily && fontSize === undefined && fontWeight === undefined) continue;
    group[key] = {
      $description: `${style.name}, ${uses(style.uses)}`,
      $extensions: { designmap: { name: style.name, ...origin(style) } },
      ...(fontFamily ? { fontFamily: { $type: "fontFamily", $value: fontFamily } } : {}),
      ...(fontSize !== undefined ? { fontSize: { $type: "dimension", $value: px(fontSize) } } : {}),
      ...(fontWeight !== undefined ? { fontWeight: { $type: "fontWeight", $value: fontWeight } } : {}),
    };
  }
  return group;
}

function dimensions(prefix: string, values: number[], description: string): TokenGroup {
  const group: TokenGroup = { $description: description };
  for (const v of [...values].sort((a, b) => a - b)) {
    group[dimensionKey(prefix, v)] = { $type: "dimension", $value: px(v) };
  }
  return group;
}

function frameworkGroup(tokens: DesignTokens): TokenGroup {
  const group: TokenGroup = {};
  if (tokens.colors.length) group.color = colors(tokens);
  const type = typography(tokens);
  if (Object.keys(type).length > 1) group.typography = type;
  if (tokens.fonts.length) {
    group.fontFamily = Object.fromEntries(
      tokens.fonts.map((f) => [tokenKey(f), { $type: "fontFamily", $value: f }]),
    );
  }
  if (tokens.spacing.length) {
    group.spacing = dimensions(
      "space",
      tokens.spacing,
      "The UI code's most common spacing values, smallest first",
    );
  }
  if (tokens.radii.length) {
    group.radius = dimensions(
      "radius",
      tokens.radii,
      "The UI code's most common corner radii, smallest first",
    );
  }
  return group;
}

/** One framework gives a flat file; a project with several gets one group per framework. */
export function toDesignTokens(scan: ScanResult): TokenGroup {
  const $description = `Read from the code of ${path.basename(scan.root)} by Designmap`;
  const [only, ...more] = scan.frameworks;
  if (only && more.length === 0) return { $description, ...frameworkGroup(only.tokens) };
  return {
    $description,
    ...Object.fromEntries(scan.frameworks.map((f) => [f.framework, frameworkGroup(f.tokens)])),
  };
}
