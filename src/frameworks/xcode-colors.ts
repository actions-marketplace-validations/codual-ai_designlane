import { z } from "zod";
import type { NamedColor } from "../scan/palette.js";
import { rgbToHex } from "../scan/tokens.js";

const COLORSET = /([^/]+)\.colorset\/Contents\.json$/;

export const isColorset = (rel: string) => COLORSET.test(rel);

const Colorset = z.object({
  colors: z
    .array(
      z.object({
        appearances: z.array(z.object({ appearance: z.string(), value: z.string() })).optional(),
        color: z.object({ components: z.record(z.string(), z.string()).optional() }).optional(),
      }),
    )
    .optional(),
});

/** Asset-catalog components (RGB channels, or a grayscale `white` value) as `#rrggbb[aa]`, or undefined when a
 * channel can't be read (empty, `0x` with no digits, text). */
function componentsToHex(c: Record<string, string>): string | undefined {
  // Xcode always writes opacity as a decimal (`1.000`), whatever format the colour channels use.
  const alpha = c.alpha === undefined ? 1 : Number(c.alpha);
  const channels =
    c.white !== undefined && c.red === undefined
      ? [c.white, c.white, c.white].map(component)
      : [c.red, c.green, c.blue].map((v) => component(v ?? "0"));
  const [r, g, b] = channels;
  if (r === undefined || g === undefined || b === undefined || !Number.isFinite(alpha)) return undefined;
  return rgbToHex(r, g, b, alpha);
}

/** A channel in one of Xcode's three input formats, as 0–1: hexadecimal (`0xFF`), floating point (`1.000`), or
 * 8-bit (`255`, a whole number). The format, not the size, decides: `1` is 8-bit, so 1/255. */
function component(value: string): number | undefined {
  const n = /^0x[0-9a-f]+$/i.test(value) ? Number.parseInt(value, 16) / 255 : readNumber(value);
  return Number.isFinite(n) ? n : undefined;
}

/** A decimal (`1.000`) as itself, a whole number (`255`) as 8-bit; anything else is not a number. */
const readNumber = (value: string) =>
  /^-?\d+$/.test(value) ? Number(value) / 255 : /^-?\d*\.\d+$/.test(value) ? Number(value) : Number.NaN;

/** An Xcode asset-catalog colour (`Name.colorset/Contents.json`), with its dark variant when it has one. */
export function parseColorset(rel: string, text: string | undefined): NamedColor | undefined {
  const name = rel.match(COLORSET)?.[1];
  if (!name || !text) return undefined;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }
  const parsed = Colorset.safeParse(json);
  if (!parsed.success) return undefined;
  // Xcode's "Any, Light, Dark" appearances give a colour for any appearance plus explicit light and dark ones. The
  // app shows the explicit one for its mode, and the "any" one where there's none. Each takes its first readable entry.
  let anyAppearance: string | undefined;
  let explicitLight: string | undefined;
  let dark: string | undefined;
  for (const entry of parsed.data.colors ?? []) {
    const components = entry.color?.components;
    const appearances = entry.appearances ?? [];
    if (!components || appearances.some((a) => a.value !== "dark" && a.value !== "light")) continue;
    const luminosity = appearances.find((a) => a.appearance === "luminosity")?.value;
    if (luminosity === "dark") dark ??= componentsToHex(components);
    else if (luminosity === "light") explicitLight ??= componentsToHex(components);
    else anyAppearance ??= componentsToHex(components);
  }
  const light = explicitLight ?? anyAppearance;
  if (!light) return undefined;
  const darkMode = dark ?? anyAppearance;
  return {
    name,
    light,
    ...(darkMode && darkMode !== light ? { dark: darkMode } : {}),
    source: rel,
    kind: "asset",
  };
}
