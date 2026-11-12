import path from "node:path";
import { compose } from "../frameworks/compose.js";
import type { FrameworkPlugin, ScanContext, ViewLink, ViewRef } from "../frameworks/plugin.js";
import { swiftui } from "../frameworks/swiftui.js";
import { classify } from "./classify.js";
import { listFiles, readText, type SourceFile } from "./files.js";
import type { ScanResult, ScreenLink, ScreenRef } from "./types.js";

const frameworks: readonly FrameworkPlugin[] = [swiftui, compose];

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

/** Each view's screen id, by where the view is declared. */
function screenIds(screens: ScreenRef[]): (view: ViewRef) => string | undefined {
  const idOf = new Map(screens.map((s) => [`${s.file}#${s.name}@${s.line}`, s.id]));
  return (v) => idOf.get(`${v.file}#${v.name}@${v.line}`);
}

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Each link between views as a link between their screens' ids, in the same order on every run. */
function screenLinks(id: (view: ViewRef) => string | undefined, links: ViewLink[]): ScreenLink[] {
  return links
    .flatMap(({ from, to, opening, file, line }) => {
      const [fromId, toId] = [id(from), id(to)];
      return fromId && toId ? [{ from: fromId, to: toId, opening, file, line }] : [];
    })
    .sort(
      (a, b) => byText(a.from, b.from) || byText(a.to, b.to) || byText(a.file, b.file) || a.line - b.line,
    );
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
    const found = await plugin.scan(ctx);
    if (!found) continue;
    const screens = uniqueIds(classify(plugin.id, found.views));
    const id = screenIds(screens);
    const links = screenLinks(id, found.links ?? []);
    const starts = (found.starts ?? []).flatMap((v) => id(v) ?? []);
    result.frameworks.push({
      framework: plugin.id,
      platforms: plugin.platforms,
      screens: screens.sort(bestFirst),
      tokens: found.tokens,
      ...(found.links && { links }),
      ...(starts.length > 0 && { starts }),
      ...(found.unresolvedLinks && { unresolvedLinks: found.unresolvedLinks }),
      ...(found.navigationNotRead?.length && { navigationNotRead: found.navigationNotRead }),
      ...(found.themesOutside?.length ? { themesOutside: found.themesOutside } : {}),
    });
  }
  return result;
}
