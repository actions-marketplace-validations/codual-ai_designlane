import { commonNumbers, dedupeColors, normalizeHex, rgbToHex } from "../scan/tokens.js";
import type { ColorToken, DesignTokens } from "../scan/types.js";
import type { ScanContext } from "./plugin.js";
import type { SwiftSource } from "./swiftui-sources.js";
import { isColorset, parseColorset } from "./xcode-colors.js";

const HEX_COLOR =
  /(?:let|var)\s+(\w+)[ \t]*(?::[ \t]*(?:Color|UIColor))?[ \t]*=[ \t]*(?:Color|UIColor)\([ \t]*hex:[ \t]*"?#?(?:0x)?([0-9A-Fa-f]{6,8})/g;
// Channels as 0–1 floats or as `187 / 255`, in `Color(...)` or `.init(...)`.
const CHANNEL = String.raw`([\d.]+)([ \t]*\/[ \t]*255(?:\.0)?)?`;
const RGB_COLOR = new RegExp(
  String.raw`(?:let|var)\s+(\w+)[ \t]*(?::[ \t]*Color)?[ \t]*=[ \t]*(?:Color|\.init)\([ \t]*(?:\.sRGB[ \t]*,[ \t]*)?red:[ \t]*${CHANNEL}[ \t]*,[ \t]*green:[ \t]*${CHANNEL}[ \t]*,[ \t]*blue:[ \t]*${CHANNEL}(?:[ \t]*,[ \t]*opacity:[ \t]*([\d.]+))?`,
  "g",
);
/** A custom font always comes with a size: `.custom("Inter", size: 17)` (however it's written, including
 * `static let title: Font = .custom(…)`) or `UIFont(name: "Inter", size: 17)`. An app's own `.custom("…")` enum
 * cases have no size, so they don't count. */
const CUSTOM_FONT = /\.custom\(\s*"([^"]+)"\s*,\s*(?:size|fixedSize):|\bUIFont\(\s*name:\s*"([^"]+)"/g;
/** A trailing weight or style: `-Bold`, `_Medium`, ` Italic`. Names can stack them (`Inter-Regular_Medium`). */
const FONT_STYLE =
  /[-_ ](?:Thin|ExtraLight|UltraLight|Light|Regular|Book|Medium|SemiBold|DemiBold|Bold|ExtraBold|Heavy|Black|Italic)$/i;
const SPACING = /(?:\.padding\((?:\.\w+\s*,\s*|\[[^\]]*\]\s*,\s*)?|spacing:\s*)(\d+(?:\.\d+)?)/g;
const RADIUS = /cornerRadius(?::\s*|\(\s*)(\d+(?:\.\d+)?)/g;
/** Declarations are on one line; longer lines are generated data, not worth matching. */
const MAX_LINE = 1000;

/** A SwiftUI app's colours (asset catalog and code), custom font families, and common spacing and corner radii. */
export async function swiftuiTokens(ctx: ScanContext, sources: SwiftSource[]): Promise<DesignTokens> {
  const colors: ColorToken[] = [];
  for (const f of ctx.files.filter((f) => isColorset(f.rel))) {
    const color = parseColorset(f.rel, await ctx.read(f));
    if (color) colors.push(color);
  }
  for (const source of sources) colors.push(...codeColors(source));
  const ui = sources.filter((s) => s.swiftUI).map((s) => s.code);
  return {
    colors: dedupeColors(colors),
    fonts: fontFamilies(sources),
    spacing: commonNumbers(ui, SPACING),
    radii: commonNumbers(ui, RADIUS),
  };
}

/** Matches of `pattern` anywhere in the file, for calls written over several lines, skipping any that start inside a
 * comment or string. `pattern` must not be able to run away on long input. */
function* codeMatchesAcrossLines({ text, code }: SwiftSource, pattern: RegExp) {
  for (const m of text.matchAll(pattern)) if (code[m.index ?? 0] !== " ") yield m;
}

/** Matches of `pattern` on each line, skipping any that start inside a comment or string. */
function* codeMatches({ text, code }: SwiftSource, pattern: RegExp) {
  let offset = 0;
  for (const line of text.split("\n")) {
    if (line.length <= MAX_LINE) {
      for (const m of line.matchAll(pattern)) {
        if (code[offset + (m.index ?? 0)] !== " ") yield m;
      }
    }
    offset += line.length + 1;
  }
}

function codeColors(source: SwiftSource): ColorToken[] {
  const colors: ColorToken[] = [];
  for (const m of codeMatches(source, HEX_COLOR)) {
    const value = normalizeHex(m[2] ?? "");
    if (m[1] && value) colors.push({ name: m[1], light: value, source: source.rel });
  }
  const channel = (value?: string, per255?: string) => (per255 ? Number(value) / 255 : Number(value ?? 0));
  for (const m of codeMatches(source, RGB_COLOR)) {
    if (!m[1]) continue;
    const [r, g, b] = [channel(m[2], m[3]), channel(m[4], m[5]), channel(m[6], m[7])];
    colors.push({ name: m[1], light: rgbToHex(r, g, b, m[8] ?? 1), source: source.rel });
  }
  return colors;
}

/** Font families, most used first: `Inter-Regular` and `Inter-Bold` count as one family, `Inter`. */
function fontFamilies(sources: SwiftSource[]): string[] {
  const counts = new Map<string, number>();
  for (const source of sources) {
    for (const m of codeMatchesAcrossLines(source, CUSTOM_FONT)) {
      const family = fontFamily(m[1] ?? m[2] ?? "");
      if (family) counts.set(family, (counts.get(family) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([family]) => family);
}

/** `Inter-Regular_Medium` → `Inter`: strips stacked weights and styles from a font's name. */
function fontFamily(name: string): string {
  let family = name.trim();
  while (FONT_STYLE.test(family)) family = family.replace(FONT_STYLE, "");
  return family;
}
