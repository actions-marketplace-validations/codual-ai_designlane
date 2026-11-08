/**
 * Turns every colour a framework plugin found into the app's palette, built for apps whose palette was never
 * written down: colours are ranked by how often the code uses them, near-identical shades are merged, and pasted
 * copies of a named colour count as uses of that colour.
 */

import { byText, mostCommon } from "./counting.js";
import type { ColorToken, DesignTokens } from "./types.js";

/** A colour the app gives a name: an asset catalog entry or a constant in code. */
export interface NamedColor {
  name: string;
  light: string;
  dark?: string;
  /** The file it was defined in. */
  source: string;
  kind: "asset" | "code";
}

export interface ColorFindings {
  named: NamedColor[];
  /** Each place the code uses a named colour by name (`Color("Brand")`, `.brand`). */
  references: string[];
  /** Each colour value written without a name, as `#rrggbb[aa]`, with the file it's in. */
  literals: { hex: string; file: string }[];
  /** Each use of a platform colour (`.red`, `.systemBackground`) by name. */
  system: string[];
}

/** Colours this close (distance between their RGBA values, out of 255) are one colour written twice. */
const SAME_COLOR = 8;
/** The palette stops here so it stays small enough to hand an agent; the rest is counted, not dropped silently. */
const MAX_COLORS = 40;

type Palette = Pick<DesignTokens, "colors" | "colorsOmitted" | "systemColors">;

export function palette(found: ColorFindings): Palette {
  const named = distinctNamed(found.named).map((c): ColorToken => ({ ...c, uses: 0 }));
  const byName = new Map<string, ColorToken>();
  for (const color of named) if (!byName.has(nameKey(color.name))) byName.set(nameKey(color.name), color);
  for (const reference of found.references) {
    const color = byName.get(nameKey(reference));
    if (color) color.uses++;
  }
  const firstFile = new Map<string, string>();
  for (const { hex, file } of found.literals) if (!firstFile.has(hex)) firstFile.set(hex, file);
  const namedGrid = new ColorGrid(named);
  const unnamed = new ColorGrid([]);
  for (const { value: hex, count } of mostCommon(
    found.literals.map((l) => l.hex),
    byText,
  )) {
    const match = namedGrid.closest(hex) ?? unnamed.closest(hex);
    if (match) match.uses += count;
    else
      unnamed.add({ name: hex, light: hex, source: firstFile.get(hex) ?? "", kind: "inline", uses: count });
  }
  const ranked = [...named, ...unnamed.colors].sort((a, b) => b.uses - a.uses);
  return {
    colors: ranked.slice(0, MAX_COLORS),
    colorsOmitted: Math.max(0, ranked.length - MAX_COLORS),
    systemColors: mostCommon(found.system, byText).map(({ value, count }) => ({ name: value, uses: count })),
  };
}

/** `Brand`, `brand` and `brand-color` are one name; generated accessors change the case of asset names. */
export const nameKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

/** One entry per name and value: the same name with two values (a light and a dark `bg`) keeps both. */
function distinctNamed(colors: NamedColor[]): NamedColor[] {
  const seen = new Set<string>();
  return colors.filter((c) => {
    const key = `${nameKey(c.name)}${c.light}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

interface Entry {
  color: ColorToken;
  rgba: number[];
  order: number;
}

/**
 * Colours bucketed by their channels, so finding the closest colour within `SAME_COLOR` only checks neighbouring
 * buckets. Each bucket keeps one colour per value (the first), so thousands of identical colours stay fast too.
 */
class ColorGrid {
  readonly colors: ColorToken[] = [];
  private readonly buckets = new Map<string, Map<string, Entry>>();

  constructor(colors: ColorToken[]) {
    for (const color of colors) this.add(color);
  }

  add(color: ColorToken): void {
    const rgba = channels(color.light);
    const key = bucketOf(rgba).join(",");
    const bucket = this.buckets.get(key) ?? new Map<string, Entry>();
    if (!bucket.has(color.light)) bucket.set(color.light, { color, rgba, order: this.colors.length });
    this.buckets.set(key, bucket);
    this.colors.push(color);
  }

  /** The closest colour within `SAME_COLOR` of `hex`; on a tie, the one added first. */
  closest(hex: string): ColorToken | undefined {
    const target = channels(hex);
    let best: (Entry & { distance: number }) | undefined;
    for (const key of neighbours(bucketOf(target))) {
      for (const entry of this.buckets.get(key)?.values() ?? []) {
        const d = distance(entry.rgba, target);
        if (d > SAME_COLOR) continue;
        if (!best || d < best.distance || (d === best.distance && entry.order < best.order)) {
          best = { ...entry, distance: d };
        }
      }
    }
    return best?.color;
  }
}

const bucketOf = (rgba: number[]) => rgba.map((v) => Math.floor(v / SAME_COLOR));

/** The bucket keys within one step of `bucket` on every channel: 3⁴ of them. */
function neighbours(bucket: number[]): string[] {
  let keys: number[][] = [[]];
  for (const v of bucket) keys = keys.flatMap((k) => [v - 1, v, v + 1].map((n) => [...k, n]));
  return keys.map((k) => k.join(","));
}

const distance = (a: number[], b: number[]) => Math.hypot(...a.map((v, i) => v - (b[i] ?? 0)));

/** `#rrggbb[aa]` as [r, g, b, a], 0–255. */
const channels = (hex: string) =>
  [1, 3, 5, 7].map((i) => (i === 7 && hex.length < 9 ? 255 : Number.parseInt(hex.slice(i, i + 2), 16)));
