/** What both frameworks' link readers share: a view's key, and one link per pair of views and way of opening. */

import type { ViewLink, ViewRef } from "./plugin.js";

/** A view's key, by where it's declared: `App/Home.swift#Home@3`. */
export const viewKey = (view: ViewRef) => `${view.file}#${view.name}@${view.line}`;

/** One link per pair of views and way of opening (a sheet and a push between the same two are two links), at the first
 * place the code makes it. */
export function distinctLinks<L extends Pick<ViewLink, "opening"> & { from: ViewRef; to: ViewRef }>(
  links: L[],
): L[] {
  return distinctBy(links, (l) => `${viewKey(l.from)}>${viewKey(l.to)}:${l.opening}`);
}

/** The first of each group of items sharing a key, in order. */
export function distinctBy<T>(items: T[], keyOf: (item: T) => string): T[] {
  const firsts = new Map<string, T>();
  for (const item of items) {
    const key = keyOf(item);
    if (!firsts.has(key)) firsts.set(key, item);
  }
  return [...firsts.values()];
}
