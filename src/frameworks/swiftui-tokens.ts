import { type NamedColor, palette } from "../scan/palette.js";
import { numbersByFrequency } from "../scan/tokens.js";
import { typeScale } from "../scan/type-scale.js";
import type { DesignTokens } from "../scan/types.js";
import type { ScanContext } from "./plugin.js";
import { swiftColors } from "./swiftui-colors.js";
import type { SwiftSource } from "./swiftui-sources.js";
import { swiftType } from "./swiftui-type.js";
import { isColorset, parseColorset } from "./xcode-colors.js";

const SPACING = /(?:\.padding\((?:\.\w+\s*,\s*|\[[^\]]*\]\s*,\s*)?|spacing:\s*)(\d+(?:\.\d+)?)/g;
const RADIUS = /cornerRadius(?::\s*|\(\s*)(\d+(?:\.\d+)?)/g;

/** A SwiftUI app's colours (asset catalog and code), type scale and font families, and common spacing and radii. */
export async function swiftuiTokens(ctx: ScanContext, sources: SwiftSource[]): Promise<DesignTokens> {
  const assets: NamedColor[] = [];
  for (const f of ctx.files.filter((f) => isColorset(f.rel))) {
    const color = parseColorset(f.rel, await ctx.read(f));
    if (color) assets.push(color);
  }
  const ui = sources.filter((s) => s.swiftUI).map((s) => s.code);
  return {
    ...palette(swiftColors(sources, assets)),
    ...typeScale(swiftType(sources)),
    spacing: numbersByFrequency(ui, SPACING),
    radii: numbersByFrequency(ui, RADIUS),
  };
}
