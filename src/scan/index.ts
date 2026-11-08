import path from "node:path";
import type { FrameworkPlugin, ScanContext } from "../frameworks/plugin.js";
import { swiftui } from "../frameworks/swiftui.js";
import { classify } from "./classify.js";
import { listFiles, readText, type SourceFile } from "./files.js";
import type { ScanResult, ScreenRef } from "./types.js";

const frameworks: readonly FrameworkPlugin[] = [swiftui];

async function createContext(root: string): Promise<ScanContext> {
  const abs = path.resolve(root);
  const { files, truncated, unreadable } = await listFiles(abs);
  return { root: abs, files, truncated, unreadable, read: (file: SourceFile) => readText(file.abs) };
}

/** Views with the same file and name (nested types, `#if` branches) are told apart by line. */
function uniqueIds(screens: ScreenRef[]): ScreenRef[] {
  const counts = new Map<string, number>();
  for (const s of screens) counts.set(s.id, (counts.get(s.id) ?? 0) + 1);
  return screens.map((s) => ((counts.get(s.id) ?? 0) > 1 ? { ...s, id: `${s.id}@${s.line}` } : s));
}

const bestFirst = (a: ScreenRef, b: ScreenRef) =>
  b.score - a.score || a.name.localeCompare(b.name, "en", { numeric: true });

/** Finds every supported framework in the project, its screens (best first) and its design tokens. */
export async function scanRepo(root: string): Promise<ScanResult> {
  const ctx = await createContext(root);
  const result: ScanResult = {
    root: ctx.root,
    frameworks: [],
    filesScanned: ctx.files.length,
    truncated: ctx.truncated,
    unreadable: ctx.unreadable,
  };
  for (const plugin of frameworks) {
    if (!(await plugin.detect(ctx))) continue;
    result.frameworks.push({
      framework: plugin.id,
      platforms: plugin.platforms,
      screens: uniqueIds(classify(plugin.id, await plugin.views(ctx))).sort(bestFirst),
      tokens: await plugin.extractTokens(ctx),
    });
  }
  return result;
}
