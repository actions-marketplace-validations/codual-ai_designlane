/** An Android app's colour resources: `<color name="brand">#FF6650A4</color>` in `res/values`, with the Dark value
 * from `res/values-night`, and colours that point at others (`@color/brand`) followed. */

import { androidHex } from "./compose-color-values.js";

export interface ResourceColor {
  name: string;
  light: string;
  dark?: string;
  source: string;
}

/** Where colour resources live: `res/values/colors.xml`, `res/values-night/themes.xml` and the like. */
export const RESOURCE_FILE = /(?:^|\/)res\/values[\w-]*\/[^/]+\.xml$/;
const RESOURCE = /<color\s+name\s*=\s*"([\w.]+)"\s*>\s*([^<]*?)\s*<\/color>/g;
const VALUES_FOLDER = /(?:^|\/)res\/(values[\w-]*)\//;
/** Colours pointing at colours this many times over are a loop, not a palette. */
const MAX_LINKS = 8;

/** The app's own resources come before a build variant's (`src/debug/res`), and `values-night` before a qualified
 * one (`values-night-v31`), so the first value found for a colour is the one the app ships with by default. */
export const resourcePriority = (rel: string) =>
  (/(?:^|\/)src\/main\//.test(rel) ? 0 : 2) + (/\/values-night\//.test(rel) ? 0 : 1);

/** The resource folder a file is in (`values`, `values-night-v31`), if it's one of the `values` folders. */
export const valuesFolder = (rel: string) => rel.match(VALUES_FOLDER)?.[1];

export function resourceColors(files: { rel: string; text: string }[]): ResourceColor[] {
  const light = new Map<string, { value: string; source: string }>();
  const dark = new Map<string, string>();
  for (const { rel, text } of [...files].sort((a, b) => resourcePriority(a.rel) - resourcePriority(b.rel))) {
    const folder = valuesFolder(rel);
    const night = folder ? /-night\b/.test(folder) : false;
    if (folder !== "values" && !night) continue;
    for (const m of text.matchAll(RESOURCE)) {
      const [name, value] = [m[1] ?? "", m[2] ?? ""];
      if (night && !dark.has(name)) dark.set(name, value);
      else if (!night && !light.has(name)) light.set(name, { value, source: rel });
    }
  }
  const lightOf = (name: string) => light.get(name)?.value;
  const darkOf = (name: string) => dark.get(name) ?? lightOf(name);
  return [...light].flatMap(([name, { value, source }]) => {
    const hex = resolve(value, lightOf);
    if (!hex) return [];
    // A colour pointing at another is dark wherever that one is.
    const night = resolve(dark.get(name) ?? value, darkOf);
    return [{ name, light: hex, ...(night && night !== hex && { dark: night }), source }];
  });
}

function resolve(value: string, table: (name: string) => string | undefined, links = 0): string | undefined {
  const link = value.match(/^@color\/([\w.]+)$/)?.[1];
  if (!link) return androidHex(value);
  const next = table(link);
  return next && links < MAX_LINKS ? resolve(next, table, links + 1) : undefined;
}
