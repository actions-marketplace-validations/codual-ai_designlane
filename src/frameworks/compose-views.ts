/** A Compose app's views as the shared classifier reads them, and the links between its screens. */

import type { ViewFacts } from "../scan/classify.js";
import { groupBy } from "../scan/counting.js";
import { circuitScreens } from "./compose-circuit.js";
import {
  CALL,
  type ComposableFunction,
  composableFunctions,
  firstViewIn,
  viewsByName,
} from "./compose-functions.js";
import { type Link, links, samePath, unresolvedCalls } from "./compose-links.js";
import { type Destination, destinations, startRoutes } from "./compose-navigation.js";
import { type KotlinSource, nearestTo, treeOf } from "./kotlin-sources.js";
import type { ViewLink, ViewRef } from "./plugin.js";
import { lineNumbers } from "./source-text.js";

/** Things inside a view's own body that make it look like a whole page: app bars, lists, scrolling, tabs. */
const PAGE_ELEMENTS = [
  /\bScaffold\s*[({]/,
  /\b(?:CenterAligned|Large|Medium)?TopAppBar\s*\(/,
  /\bLazy(?:Column|VerticalGrid|VerticalStaggeredGrid)\s*[({]/,
  /\.verticalScroll\s*\(/,
  /\b(?:NavigationBar|NavigationRail|NavigationSuiteScaffold)\s*[({]/,
  /\b(?:Primary|Secondary|Scrollable)?TabRow\s*\(/,
  /\bHorizontalPager\s*\(/,
];
/** The block an Activity's UI starts in: what it draws first is a screen. */
const ROOT = /\bsetContent\s*\{/g;
/** Navigation libraries whose screens and links aren't read yet, by the package they're imported from. */
const UNREAD_NAVIGATION: [RegExp, string][] = [
  [/\bimport\s+com\.bumble\.appyx\./, "Appyx"],
  [/\bimport\s+cafe\.adriel\.voyager\./, "Voyager"],
  [/\bimport\s+com\.arkivanov\.decompose\./, "Decompose"],
];

/** The navigation libraries `sources` import that aren't read. */
export const navigationNotRead = (sources: KotlinSource[]) =>
  UNREAD_NAVIGATION.flatMap(([imported, name]) => (sources.some((s) => imported.test(s.code)) ? [name] : []));

export interface ComposeViews {
  views: ViewFacts[];
  links: ViewLink[];
  starts: ViewRef[];
  unresolvedLinks: number;
}

export function composeViews(sources: KotlinSource[]): ComposeViews {
  const views = composableFunctions(sources);
  const navigation = destinations(sources, views);
  const circuit = circuitScreens(sources, views);
  const all = [...navigation, ...circuit.destinations];
  const rootViews = roots(sources, views);
  const presented = new Set(rootViews);
  for (const d of all) if (d.view) presented.add(d.view);
  const placedIn = placements(views);
  const linked = viewLinks([...links(sources, navigation), ...circuit.links]);
  return {
    views: views.map((view) => {
      const body = view.source.code.slice(...view.body);
      return {
        name: view.name,
        file: view.source.rel,
        line: view.line,
        pageElements: PAGE_ELEMENTS.filter((pattern) => pattern.test(body)).length,
        bodyLines: body.split("\n").length,
        presented: presented.has(view),
        routed: false,
        childFiles: placedIn.get(view.name)?.size ?? 0,
        holdsViews: view.holdsViews,
      };
    }),
    links: linked.links,
    starts: startViews(sources, all, rootViews),
    unresolvedLinks: unresolvedCalls(navigation) + linked.unresolved,
  };
}

/** The views the app's navigation starts on, or, when no start is written, the views its Activities draw first. */
function startViews(sources: KotlinSource[], all: Destination[], rootViews: ComposableFunction[]): ViewRef[] {
  const byKey = groupBy(all, (d) => d.key);
  const fromNavigation = startRoutes(sources).flatMap(({ key, path, source }) => {
    const candidates = (byKey.get(key) ?? []).filter((d) => samePath(path, d.path));
    const view = nearestTo(candidates, source, (d) => d.source)?.view;
    return view ? [view] : [];
  });
  const starts = fromNavigation.length ? fromNavigation : rootViews;
  return [...new Set(starts)].map(refOf);
}

/** The views each Activity's `setContent { … }` draws first, past any theme wrapping them. */
function roots(sources: KotlinSource[], views: ComposableFunction[]): ComposableFunction[] {
  const byName = viewsByName(views);
  return sources.flatMap((source) =>
    [...source.code.matchAll(ROOT)].flatMap((m) => {
      const open = (m.index ?? 0) + m[0].length - 1;
      const close = treeOf(source).closeOf.get(open);
      const view = close === undefined ? undefined : firstViewIn(source, [[open, close]], byName);
      return view ? [view] : [];
    }),
  );
}

/** For each view's name, the files whose views place it inside themselves. */
function placements(views: ComposableFunction[]): Map<string, Set<string>> {
  const names = new Set(views.map((v) => v.name));
  const placedIn = new Map<string, Set<string>>();
  for (const view of views) {
    for (const m of view.source.code.slice(...view.body).matchAll(CALL)) {
      const name = m[1] ?? "";
      if (!names.has(name) || name === view.name) continue;
      const files = placedIn.get(name) ?? new Set<string>();
      files.add(view.source.rel);
      placedIn.set(name, files);
    }
  }
  return placedIn;
}

const refOf = (view: ComposableFunction): ViewRef => ({
  name: view.name,
  file: view.source.rel,
  line: view.line,
});

/** One link per pair of views, with its line; links missing a view are counted, not drawn. */
function viewLinks(found: Link[]): { links: ViewLink[]; unresolved: number } {
  const seen = new Set<string>();
  let unresolved = 0;
  const all = [...groupBy(found, (l) => l.source)].flatMap(([source, list]) => {
    const sorted = [...list].sort((a, b) => a.at - b.at);
    const lines = lineNumbers(
      source.code,
      sorted.map((l) => l.at),
    );
    return sorted.flatMap((link, i) => {
      if (!link.from.view || !link.to.view) {
        unresolved++;
        return [];
      }
      const [from, to] = [refOf(link.from.view), refOf(link.to.view)];
      // Two navigation setups can lead to the same pair of views.
      const pair = `${from.file}#${from.name}@${from.line}>${to.file}#${to.name}@${to.line}`;
      if (seen.has(pair)) return [];
      seen.add(pair);
      return [{ from, to, opening: link.opening, file: source.rel, line: lines[i] ?? 1 }];
    });
  });
  return { links: all, unresolved };
}
