/** A Compose app's views as the shared classifier reads them, and the links between its screens. */

import type { ViewFacts } from "../scan/classify.js";
import { groupBy } from "../scan/counting.js";
import { circuitScreens } from "./compose-circuit.js";
import {
  CALL,
  type ComposableFunction,
  composableFunctions,
  overloadFor,
  viewsByName,
  viewsIn,
} from "./compose-functions.js";
import { links, type PartLink, partLinks, samePath, unresolvedCalls } from "./compose-links.js";
import { type Destination, destinations, drawnBy, startRoutes } from "./compose-navigation.js";
import { helperRoutes } from "./compose-routes.js";
import { type KotlinSource, nearestTo, treeOf } from "./kotlin-sources.js";
import type { ViewLink, ViewPlacement, ViewRef } from "./plugin.js";
import { lineNumbers } from "./source-text.js";
import { distinctLinks } from "./view-links.js";

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
  placements: ViewPlacement[];
  unresolvedLinks: number;
}

export function composeViews(sources: KotlinSource[]): ComposeViews {
  const views = composableFunctions(sources);
  const navigation = destinations(sources, views);
  const circuit = circuitScreens(sources, views);
  const all = [...navigation, ...circuit.destinations];
  const rootViews = roots(sources, views);
  const presented = new Set(rootViews);
  for (const d of all) for (const view of drawnBy(d)) presented.add(view);
  const { placedIn, pairs } = placements(views);
  const helpers = helperRoutes(
    sources,
    groupBy(navigation, (d) => d.key),
  );
  const parts = partLinks(views, navigation, helpers);
  const linked = viewLinks([...links(sources, navigation, helpers), ...circuit.links, ...parts.links]);
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
    placements: pairs,
    starts: startViews(sources, all, rootViews),
    unresolvedLinks: unresolvedCalls(navigation) + parts.unresolved + linked.unresolved,
  };
}

/** The views the app's navigation starts on, or, when no start is written, the views its Activities draw first. */
function startViews(sources: KotlinSource[], all: Destination[], rootViews: ComposableFunction[]): ViewRef[] {
  const byKey = groupBy(all, (d) => d.key);
  const fromNavigation = startRoutes(sources).flatMap(({ key, path, source }) => {
    const candidates = (byKey.get(key) ?? []).filter((d) => samePath(path, d.path));
    const start = nearestTo(candidates, source, (d) => d.source);
    return start ? drawnBy(start) : [];
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
      const view = close === undefined ? undefined : viewsIn(source, [[open, close]], byName)[0]?.view;
      return view ? [view] : [];
    }),
  );
}

/** For each view's name, the files whose views place it inside themselves; and which view sits inside which. */
function placements(views: ComposableFunction[]) {
  const byName = viewsByName(views);
  const placedIn = new Map<string, Set<string>>();
  const pairs: ViewPlacement[] = [];
  for (const view of views) {
    for (const m of view.source.code.slice(...view.body).matchAll(CALL)) {
      const name = m[1] ?? "";
      const placed = nearestTo(byName.get(name) ?? [], view.source, (v) => v.source);
      if (!placed || name === view.name) continue;
      const holder = overloadFor(byName, view);
      const files = placedIn.get(name) ?? new Set<string>();
      files.add(view.source.rel);
      placedIn.set(name, files);
      pairs.push({ view: refOf(placed), in: refOf(holder) });
    }
  }
  return { placedIn, pairs };
}

const refOf = (view: ComposableFunction): ViewRef => ({
  name: view.name,
  file: view.source.rel,
  line: view.line,
});

/** One link per pair of views, with its line; links missing a view are counted, not drawn. */
function viewLinks(found: PartLink[]): { links: ViewLink[]; unresolved: number } {
  let unresolved = 0;
  const all = [...groupBy(found, (l) => l.source)].flatMap(([source, list]) => {
    const sorted = [...list].sort((a, b) => a.at - b.at);
    const lines = lineNumbers(
      source.code,
      sorted.map((l) => l.at),
    );
    return sorted.flatMap((link, i) => {
      const from = link.fromView;
      const to = drawnBy(link.to);
      if (!from || to.length === 0) {
        unresolved++;
        return [];
      }
      return to.map((view) => ({
        from: refOf(from),
        to: refOf(view),
        opening: link.opening,
        file: source.rel,
        line: lines[i] ?? 1,
      }));
    });
  });
  // Two navigation setups (phone and TV, say) can lead to the same pair of views.
  return { links: distinctLinks(all), unresolved };
}
