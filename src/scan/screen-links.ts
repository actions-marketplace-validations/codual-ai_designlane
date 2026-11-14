/** Links between views as links between screens: a link made from a part of a screen (a row, a toolbar) is credited
 * to the screens that hold it, keeping the part as `via`. */

import type { ViewLink, ViewPlacement } from "../frameworks/plugin.js";
import { distinctBy, viewKey } from "../frameworks/view-links.js";
import { byCode } from "./counting.js";
import type { ScreenLink, ScreenRef } from "./types.js";

/** How many parts deep a link's view may sit inside the screen credited with it. */
const MAX_LEVELS = 4;

export function screenLinks(
  screens: ScreenRef[],
  links: ViewLink[],
  placements: ViewPlacement[],
): { links: ScreenLink[]; unresolved: number } {
  const byKey = new Map(screens.map((s) => [viewKey(s), s]));
  const parents = new Map<string, string[]>();
  for (const { view, in: holder } of placements) {
    const list = parents.get(viewKey(view)) ?? [];
    list.push(viewKey(holder));
    parents.set(viewKey(view), list);
  }
  // Each branch walks up until it reaches a screen: a row placed in a screen and in a list of another screen counts
  // for both.
  /** The screens holding a part, and whether the walk stopped at MAX_LEVELS before reaching every one. */
  const screensHolding = (key: string): { screens: ScreenRef[]; cutShort: boolean } => {
    const found = new Map<string, ScreenRef>();
    const seen = new Set([key]);
    let level = [key];
    for (let depth = 0; depth < MAX_LEVELS && level.length; depth++) {
      const next: string[] = [];
      for (const k of level.flatMap((k) => parents.get(k) ?? [])) {
        if (seen.has(k)) continue;
        seen.add(k);
        const screen = byKey.get(k);
        if (screen?.kind === "screen") found.set(screen.id, screen);
        else next.push(k);
      }
      level = next;
    }
    return { screens: [...found.values()], cutShort: level.length > 0 };
  };
  let unresolved = 0;
  const credited = links.flatMap((link): ScreenLink[] => {
    const [from, to] = [byKey.get(viewKey(link.from)), byKey.get(viewKey(link.to))];
    if (!from || !to) {
      unresolved++;
      return [];
    }
    const base = { to: to.id, opening: link.opening, file: link.file, line: link.line };
    if (from.kind === "screen") return [{ ...base, from: from.id }];
    const { screens, cutShort } = screensHolding(viewKey(link.from));
    // Too deep to credit to a screen: counted rather than shown from a part.
    if (cutShort && screens.length === 0) {
      unresolved++;
      return [];
    }
    if (screens.length === 0) return [{ ...base, from: from.id }];
    return screens.map((screen) => ({ ...base, from: screen.id, via: from.id }));
  });
  credited.sort(
    (a, b) => byCode(a.from, b.from) || byCode(a.to, b.to) || byCode(a.file, b.file) || a.line - b.line,
  );
  // One link per pair of views and way of opening, as in each framework's own links: two parts of a screen opening
  // the same page are two places in the code, kept apart by `via`.
  const distinct = distinctBy(credited, (l) => `${l.from}>${l.to}:${l.opening}:${l.via ?? ""}`);
  return { links: distinct, unresolved };
}
