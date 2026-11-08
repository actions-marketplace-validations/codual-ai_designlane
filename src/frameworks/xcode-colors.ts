import { z } from "zod";
import { rgbToHex } from "../scan/tokens.js";
import type { ColorToken } from "../scan/types.js";

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

/** Asset-catalog components, as RGB channels or as a grayscale `white` value. */
function componentsToHex(c: Record<string, string>): string {
  const alpha = c.alpha ?? 1;
  if (c.white !== undefined && c.red === undefined) return rgbToHex(c.white, c.white, c.white, alpha);
  return rgbToHex(c.red ?? 0, c.green ?? 0, c.blue ?? 0, alpha);
}

/** An Xcode asset-catalog colour (`Name.colorset/Contents.json`), with its dark variant when it has one. */
export function parseColorset(rel: string, text: string | undefined): ColorToken | undefined {
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
  let light: string | undefined;
  let dark: string | undefined;
  for (const entry of parsed.data.colors ?? []) {
    const components = entry.color?.components;
    const appearances = entry.appearances ?? [];
    if (!components || appearances.some((a) => a.value !== "dark" && a.value !== "light")) continue;
    if (appearances.some((a) => a.appearance === "luminosity" && a.value === "dark"))
      dark = componentsToHex(components);
    else light ??= componentsToHex(components);
  }
  if (!light) return undefined;
  return { name, light, ...(dark && dark !== light ? { dark } : {}), source: rel };
}
