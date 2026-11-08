import { byText, mostCommon } from "../scan/counting.js";
import { type NamedColor, palette } from "../scan/palette.js";
import { commonNumbers } from "../scan/tokens.js";
import type { DesignTokens } from "../scan/types.js";
import type { ScanContext } from "./plugin.js";
import { swiftColors } from "./swiftui-colors.js";
import { matchesInCode, type SwiftSource } from "./swiftui-sources.js";
import { isColorset, parseColorset } from "./xcode-colors.js";

/** A custom font always comes with a size: `.custom("Inter", size: 17)` (however it's written, including
 * `static let title: Font = .custom(…)`) or `UIFont(name: "Inter", size: 17)`. An app's own `.custom("…")` enum
 * cases have no size, so they don't count. */
const CUSTOM_FONT = /\.custom\(\s*"([^"]+)"\s*,\s*(?:size|fixedSize):|\bUIFont\(\s*name:\s*"([^"]+)"/g;
/** A trailing weight or style: `-Bold`, `_Medium`, ` Italic`. Names can stack them (`Inter-Regular_Medium`). */
const FONT_STYLE =
  /[-_ ](?:Thin|ExtraLight|UltraLight|Light|Regular|Book|Medium|SemiBold|DemiBold|Bold|ExtraBold|Heavy|Black|Italic)$/i;
const SPACING = /(?:\.padding\((?:\.\w+\s*,\s*|\[[^\]]*\]\s*,\s*)?|spacing:\s*)(\d+(?:\.\d+)?)/g;
const RADIUS = /cornerRadius(?::\s*|\(\s*)(\d+(?:\.\d+)?)/g;

/** A SwiftUI app's colours (asset catalog and code), custom font families, and common spacing and corner radii. */
export async function swiftuiTokens(ctx: ScanContext, sources: SwiftSource[]): Promise<DesignTokens> {
  const assets: NamedColor[] = [];
  for (const f of ctx.files.filter((f) => isColorset(f.rel))) {
    const color = parseColorset(f.rel, await ctx.read(f));
    if (color) assets.push(color);
  }
  const ui = sources.filter((s) => s.swiftUI).map((s) => s.code);
  return {
    ...palette(swiftColors(sources, assets)),
    fonts: fontFamilies(sources),
    spacing: commonNumbers(ui, SPACING),
    radii: commonNumbers(ui, RADIUS),
  };
}

/** Font families, most used first: `Inter-Regular` and `Inter-Bold` count as one family, `Inter`. */
function fontFamilies(sources: SwiftSource[]): string[] {
  const families = sources.flatMap((source) =>
    [...matchesInCode(source, CUSTOM_FONT)].map((m) => fontFamily(m[1] ?? m[2] ?? "")),
  );
  return mostCommon(families.filter(Boolean), byText)
    .slice(0, MAX_FONTS)
    .map(({ value }) => value);
}

const MAX_FONTS = 6;

/** `Inter-Regular_Medium` → `Inter`: strips stacked weights and styles from a font's name. */
function fontFamily(name: string): string {
  let family = name.trim();
  while (FONT_STYLE.test(family)) family = family.replace(FONT_STYLE, "");
  return family;
}
