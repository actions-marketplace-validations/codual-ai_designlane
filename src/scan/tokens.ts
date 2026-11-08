import type { ColorToken } from "./types.js";

const byte = (n: number) =>
  Math.round(Math.max(0, Math.min(255, n)))
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

/** Channels as 0–1 floats, 0–255 integers or `0x` hex strings, the forms Xcode and Swift code use. */
export function rgbToHex(r: string | number, g: string | number, b: string | number, a: string | number = 1) {
  const channel = (v: string | number) => {
    if (typeof v === "string" && v.startsWith("0x")) return Number.parseInt(v, 16);
    const n = Number(v);
    return n <= 1 ? n * 255 : n;
  };
  const alpha = Number(a);
  return `#${byte(channel(r))}${byte(channel(g))}${byte(channel(b))}${alpha >= 1 ? "" : byte(alpha * 255)}`;
}

/** The most common numbers `pattern` captures across `texts`, for spacing and corner radii. */
export function commonNumbers(texts: string[], pattern: RegExp, limit = 6): number[] {
  const counts = new Map<number, number>();
  for (const text of texts) {
    for (const m of text.matchAll(pattern)) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > 0 && n <= 64) counts.set(n, (counts.get(n) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, limit)
    .map(([n]) => n);
}

/** The first colour of each name, ignoring case, capped so the list stays small enough to hand an agent. */
export function dedupeColors(colors: ColorToken[], limit = 40): ColorToken[] {
  const seen = new Set<string>();
  return colors
    .filter((c) => {
      const key = c.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}
