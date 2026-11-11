import type { ViewFacts } from "../scan/classify.js";
import type { FrameworkPlugin } from "./plugin.js";
import { lineNumbers } from "./source-text.js";
import { type StructDecl, structs } from "./swift-source.js";
import { hostedViews } from "./swiftui-hosting.js";
import { type SwiftSource, swiftSources } from "./swiftui-sources.js";
import { swiftuiTokens } from "./swiftui-tokens.js";
import { type ViewUsage, viewUsages } from "./swiftui-usage.js";

/** Page-like elements in SwiftUI code. */
const PAGE_ELEMENTS = [
  /NavigationStack|NavigationView|NavigationSplitView/,
  /\.navigationTitle\(/,
  /\bList\s*[({]|\bForm\s*\{/,
  /\bScrollView\b/,
  /\bTabView\b/,
  /\.toolbar\s*\{/,
];

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
      childFiles: usage?.childIn.size ?? 0,
      holdsViews: view.holdsViews,
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

export const swiftui: FrameworkPlugin = {
  id: "swiftui",
  platforms: ["ios"],

  async scan(ctx) {
    const sources = await swiftSources(ctx);
    const swiftUI = sources.filter((s) => s.swiftUI);
    if (swiftUI.length === 0) return undefined;
    return { views: viewsIn(swiftUI, sources), tokens: await swiftuiTokens(ctx, sources) };
  },
};

/** The views declared in the SwiftUI files, with how the app shows them, read from every Swift file. */
function viewsIn(sources: SwiftSource[], everySource: SwiftSource[]): ViewFacts[] {
  const views = sources.map((s) => structs(s.code).filter(isView));
  const all = views.flat();
  const names = new Set(all.map((v) => v.name));
  const containers = new Set(all.filter((v) => v.holdsViews).map((v) => v.name));
  const usages = viewUsages(sources, names, containers);
  // Hosted from UIKit: a page, or part of one, counted like being placed inside another view.
  for (const { name, file, asPage } of hostedViews(everySource, names, containers)) {
    const usage = usages.get(name) ?? { presented: false, routed: false, childIn: new Set<string>() };
    usages.set(name, usage);
    if (asPage) usage.presented = true;
    else usage.childIn.add(file);
  }
  return sources.flatMap((source, i) => viewFacts(source, views[i] ?? [], usages));
}
