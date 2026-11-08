import { isTestPath } from "../scan/test-paths.js";
import type { ScanContext } from "./plugin.js";
import { codeOnly, withoutPreviews } from "./swift-source.js";

/** Lines longer than this are generated data, not hand-written declarations, and aren't matched line by line. */
const MAX_LINE = 1000;

export interface SwiftSource {
  rel: string;
  text: string;
  /** The text with comments, strings and previews blanked out. */
  code: string;
  /** `text` split into lines once, since several readers go line by line. */
  lines: string[];
  swiftUI: boolean;
}

/** Every non-test Swift file, read once, with comments, strings and previews blanked out. */
export async function swiftSources(ctx: ScanContext): Promise<SwiftSource[]> {
  const out: SwiftSource[] = [];
  for (const f of ctx.files.filter((f) => f.rel.endsWith(".swift") && !isTestPath(f.rel))) {
    const text = await ctx.read(f);
    if (!text) continue;
    const code = withoutPreviews(codeOnly(text));
    out.push({ rel: f.rel, text, code, lines: text.split("\n"), swiftUI: /\bimport\s+SwiftUI\b/.test(code) });
  }
  // A module that re-exports SwiftUI makes it available to every file without an import.
  if (out.some((s) => /@_exported\s+import\s+SwiftUI\b/.test(s.code))) for (const s of out) s.swiftUI = true;
  return out;
}

/** Matches of `pattern` anywhere in the file, for calls written over several lines, skipping any that start inside a
 * comment or string. `pattern` must not be able to run away on long input. */
export function* matchesInCode({ text, code }: SwiftSource, pattern: RegExp) {
  for (const m of text.matchAll(pattern)) if (code[m.index ?? 0] !== " ") yield m;
}

/** Matches of `pattern` one line at a time, with that line, skipping any that start inside a comment or string. */
export function* matchesPerLine({ lines, code }: SwiftSource, pattern: RegExp) {
  let offset = 0;
  for (const line of lines) {
    if (line.length <= MAX_LINE) {
      for (const m of line.matchAll(pattern)) {
        if (code[offset + (m.index ?? 0)] !== " ") yield { m, line };
      }
    }
    offset += line.length + 1;
  }
}
