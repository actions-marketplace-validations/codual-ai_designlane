/** The scan as W3C design tokens (DTCG 2025.10), which Figma, Tokens Studio and Style Dictionary import. */

import path from "node:path";
import type { z } from "zod";
import type { ColorToken, DesignTokens, ScanResult } from "../scan/types.js";
import { dimensionKey, keyedColors, keyedStyles, tokenKey } from "./token-names.js";
import type { ColorTokenEntry, ColorValue, DesignTokensFile } from "./tokens-schema.js";

/** A group of the file, as the schema types it. */
type Group<K extends "color" | "typography" | "spacing" | "radius"> = NonNullable<DesignTokensFile[K]>;

const round = (n: number) => Math.round(n * 1000) / 1000;
const channel = (hex: string, at: number) => round(Number.parseInt(hex.slice(at, at + 2), 16) / 255);
/** Sizes are in points; DTCG's nearest unit is px, which is what a point is at 1x. */
const px = (value: number) => ({ value, unit: "px" as const });
const uses = (n: number) => `${n} use${n === 1 ? "" : "s"}`;

/** `#rrggbb` or `#rrggbbaa` as a DTCG colour. */
export function colorValue(hex: string): z.input<typeof ColorValue> {
  const h = hex.replace("#", "");
  const value: z.input<typeof ColorValue> = {
    colorSpace: "srgb",
    components: [channel(h, 0), channel(h, 2), channel(h, 4)],
    hex: `#${h.slice(0, 6)}`,
  };
  if (h.length === 8) value.alpha = channel(h, 6);
  return value;
}

function colorEntry(color: ColorToken): z.input<typeof ColorTokenEntry> {
  const where = color.kind === "inline" ? "Written without a name in" : "From";
  return {
    $type: "color",
    $value: colorValue(color.light),
    $description: `${where} ${color.source}, ${uses(color.uses)}`,
    $extensions: {
      designmap: {
        ...(color.reference ? { reference: color.reference } : {}),
        source: color.source,
        ...(color.line ? { line: color.line } : {}),
        uses: color.uses,
        ...(color.dark ? { modes: { dark: colorValue(color.dark) } } : {}),
      },
    },
  };
}

function colors(tokens: DesignTokens): Group<"color"> {
  const group: Group<"color"> = { $description: "Most used first" };
  for (const { color, key } of keyedColors(tokens.colors)) group[key] = colorEntry(color);
  return group;
}

/** Each text style as a group of the values the code sets. A DTCG typography token needs line height and letter
 * spacing too, which the code rarely sets, so the values stand as their own tokens rather than as one invented. */
function typography(tokens: DesignTokens): Group<"typography"> {
  const group: Group<"typography"> = { $description: "Most used first" };
  for (const { style, key, values } of keyedStyles(tokens.typeStyles)) {
    const { fontFamily, fontSize, fontWeight } = values;
    if (!fontFamily && fontSize === undefined && fontWeight === undefined) continue;
    group[key] = {
      $description: `${style.name}, ${uses(style.uses)}`,
      $extensions: {
        designmap: {
          name: style.name,
          ...(style.reference ? { reference: style.reference } : {}),
          uses: style.uses,
        },
      },
      ...(fontFamily ? { fontFamily: { $type: "fontFamily", $value: fontFamily } } : {}),
      ...(fontSize !== undefined ? { fontSize: { $type: "dimension", $value: px(fontSize) } } : {}),
      ...(fontWeight !== undefined ? { fontWeight: { $type: "fontWeight", $value: fontWeight } } : {}),
    };
  }
  return group;
}

function dimensions(prefix: string, values: number[], description: string): Group<"spacing"> {
  const group: Group<"spacing"> = { $description: description };
  for (const v of [...values].sort((a, b) => a - b))
    group[dimensionKey(prefix, v)] = { $type: "dimension", $value: px(v) };
  return group;
}

/**
 * The tokens of the app's framework. Designmap reads one framework today, so the file has one app's groups; a scan
 * that couldn't read the whole app says so, so a sync doesn't take what it missed for what the code dropped.
 */
export function toDesignTokens(scan: ScanResult): DesignTokensFile {
  const app = path.basename(scan.root);
  const partial = scan.truncated || scan.unreadable.length > 0;
  const file: DesignTokensFile = {
    $description: `Read from the code of ${app} by Designmap`,
    $extensions: { designmap: { app, ...(partial ? { partial: true } : {}) } },
  };
  const tokens = scan.frameworks[0]?.tokens;
  if (!tokens) return file;
  if (tokens.colors.length) file.color = colors(tokens);
  const type = typography(tokens);
  if (Object.keys(type).length > 1) file.typography = type;
  if (tokens.fonts.length) {
    file.fontFamily = Object.fromEntries(
      tokens.fonts.map((f) => [tokenKey(f), { $type: "fontFamily", $value: f }]),
    );
  }
  if (tokens.spacing.length) {
    file.spacing = dimensions(
      "space",
      tokens.spacing,
      "Every spacing value the UI code uses, smallest first",
    );
  }
  if (tokens.radii.length) {
    file.radius = dimensions("radius", tokens.radii, "Every corner radius the UI code uses, smallest first");
  }
  return file;
}
