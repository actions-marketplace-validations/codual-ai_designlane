import type { ViewFacts } from "../scan/classify.js";
import { isTestPath } from "../scan/test-paths.js";
import { commonNumbers, dedupeColors, normalizeHex, rgbToHex } from "../scan/tokens.js";
import type { ColorToken } from "../scan/types.js";
import type { FrameworkPlugin, ScanContext } from "./plugin.js";
import { codeOnly, lineNumbers, type StructDecl, structs, withoutPreviews } from "./swift-source.js";
import { type ViewUsage, viewUsages } from "./swiftui-usage.js";
import { isColorset, parseColorset } from "./xcode-colors.js";

/** Page-like elements in SwiftUI code. */
const PAGE_ELEMENTS = [
  /NavigationStack|NavigationView|NavigationSplitView/,
  /\.navigationTitle\(/,
  /\bList\s*[({]|\bForm\s*\{/,
  /\bScrollView\b/,
  /\bTabView\b/,
  /\.toolbar\s*\{/,
];

const HEX_COLOR =
  /(?:let|var)\s+(\w+)[ \t]*(?::[ \t]*(?:Color|UIColor))?[ \t]*=[ \t]*(?:Color|UIColor)\([ \t]*hex:[ \t]*"?#?(?:0x)?([0-9A-Fa-f]{6,8})/g;
// Channels as 0–1 floats or as `187 / 255`, in `Color(...)` or `.init(...)`.
const CHANNEL = String.raw`([\d.]+)([ \t]*\/[ \t]*255(?:\.0)?)?`;
const RGB_COLOR = new RegExp(
  String.raw`(?:let|var)\s+(\w+)[ \t]*(?::[ \t]*Color)?[ \t]*=[ \t]*(?:Color|\.init)\([ \t]*(?:\.sRGB[ \t]*,[ \t]*)?red:[ \t]*${CHANNEL}[ \t]*,[ \t]*green:[ \t]*${CHANNEL}[ \t]*,[ \t]*blue:[ \t]*${CHANNEL}(?:[ \t]*,[ \t]*opacity:[ \t]*([\d.]+))?`,
  "g",
);
const CUSTOM_FONT = /\.custom\(\s*"([^"]+)"/g;
const FONT_WEIGHT =
  /[-_ ]?(Thin|ExtraLight|UltraLight|Light|Regular|Book|Medium|SemiBold|DemiBold|Bold|ExtraBold|Heavy|Black)?(Italic)?$/i;
const SPACING = /(?:\.padding\((?:\.\w+\s*,\s*|\[[^\]]*\]\s*,\s*)?|spacing:\s*)(\d+(?:\.\d+)?)/g;
const RADIUS = /cornerRadius(?::\s*|\(\s*)(\d+(?:\.\d+)?)/g;
/** Declarations are on one line; longer lines are generated data, not worth matching. */
const MAX_LINE = 1000;

interface SwiftSource {
  rel: string;
  text: string;
  /** The text with comments, strings and previews blanked out. */
  code: string;
  swiftUI: boolean;
}

const sourceCache = new WeakMap<ScanContext, Promise<SwiftSource[]>>();

/** Every non-test Swift file, read once per scan. */
function swiftSources(ctx: ScanContext): Promise<SwiftSource[]> {
  let sources = sourceCache.get(ctx);
  if (!sources) {
    sources = readSwiftSources(ctx);
    sourceCache.set(ctx, sources);
  }
  return sources;
}

async function readSwiftSources(ctx: ScanContext): Promise<SwiftSource[]> {
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

const isView = (s: StructDecl) => s.conformances.some((c) => c === "View" || c === "SwiftUI.View");

function viewFacts(
  { rel, code }: SwiftSource,
  views: StructDecl[],
  usages: Map<string, ViewUsage>,
): ViewFacts[] {
  const lines = lineNumbers(
    code,
    views.map((v) => v.start),
  );
  return views.map((view, i) => {
    const body = ownBody(code, views, i);
    const usage = usages.get(view.name);
    return {
      name: view.name,
      file: rel,
      line: lines[i] ?? 1,
      pageElements: PAGE_ELEMENTS.filter((pattern) => pattern.test(body)).length,
      bodyLines: body.split("\n").length,
      presented: usage?.presented ?? false,
      routed: usage?.routed ?? false,
      childFiles: usage?.childFiles ?? 0,
    };
  });
}

/** The body of `views[index]` with any views declared inside it blanked out, so they don't count towards it. */
function ownBody(code: string, views: StructDecl[], index: number): string {
  const view = views[index];
  if (!view) return "";
  const body = code.slice(view.open, view.close + 1).split("");
  for (let k = index + 1; k < views.length; k++) {
    const inner = views[k];
    if (!inner || inner.start > view.close) break;
    body.fill(" ", inner.start - view.open, inner.close + 1 - view.open);
  }
  return body.join("");
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
    for (const m of codeMatches(source, CUSTOM_FONT)) {
      const family = (m[1] ?? "").replace(FONT_WEIGHT, "").trim();
      if (family) counts.set(family, (counts.get(family) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([family]) => family);
}

export const swiftui: FrameworkPlugin = {
  id: "swiftui",
  platforms: ["ios"],

  async detect(ctx) {
    return (await swiftSources(ctx)).some((s) => s.swiftUI);
  },

  async views(ctx) {
    const sources = (await swiftSources(ctx)).filter((s) => s.swiftUI);
    const views = sources.map((s) => structs(s.code).filter(isView));
    const all = views.flat();
    const containers = new Set(all.filter((v) => v.holdsViews).map((v) => v.name));
    const usages = viewUsages(sources, new Set(all.map((v) => v.name)), containers);
    return sources.flatMap((source, i) => viewFacts(source, views[i] ?? [], usages));
  },

  async extractTokens(ctx) {
    const colors: ColorToken[] = [];
    for (const f of ctx.files.filter((f) => isColorset(f.rel))) {
      const color = parseColorset(f.rel, await ctx.read(f));
      if (color) colors.push(color);
    }
    const sources = await swiftSources(ctx);
    for (const source of sources) colors.push(...codeColors(source));
    const ui = sources.filter((s) => s.swiftUI).map((s) => s.code);
    return {
      colors: dedupeColors(colors),
      fonts: fontFamilies(sources),
      spacing: commonNumbers(ui, SPACING),
      radii: commonNumbers(ui, RADIUS),
    };
  },
};
