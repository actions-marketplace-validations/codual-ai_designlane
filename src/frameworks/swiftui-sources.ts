import { isTestPath } from "../scan/test-paths.js";
import type { ScanContext } from "./plugin.js";
import { codeOnly, withoutPreviews } from "./swift-source.js";

export interface SwiftSource {
  rel: string;
  text: string;
  /** The text with comments, strings and previews blanked out. */
  code: string;
  swiftUI: boolean;
}

/** Every non-test Swift file, read once, with comments, strings and previews blanked out. */
export async function swiftSources(ctx: ScanContext): Promise<SwiftSource[]> {
  const out: SwiftSource[] = [];
  for (const f of ctx.files.filter((f) => f.rel.endsWith(".swift") && !isTestPath(f.rel))) {
    const text = await ctx.read(f);
    if (!text) continue;
    const code = withoutPreviews(codeOnly(text));
    out.push({ rel: f.rel, text, code, swiftUI: /\bimport\s+SwiftUI\b/.test(code) });
  }
  // A module that re-exports SwiftUI makes it available to every file without an import.
  if (out.some((s) => /@_exported\s+import\s+SwiftUI\b/.test(s.code))) for (const s of out) s.swiftUI = true;
  return out;
}
