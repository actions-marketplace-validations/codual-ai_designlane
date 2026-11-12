/** Which destination opens which, for Google's navigation libraries, including navigation passed in through
 * callbacks. */

import { groupBy } from "../scan/counting.js";
import type { Opening } from "../scan/types.js";
import { type Destination, routeIn } from "./compose-navigation.js";
import { helperRoutes, NAVIGATE_CALL, type Named, navigation, routesIn } from "./compose-routes.js";
import { callArguments, isDeclared } from "./kotlin-calls.js";
import { type KotlinSource, nearestTo, treeOf } from "./kotlin-sources.js";

/** One destination opening another, how it appears, and where the code does it. */
export interface Link {
  from: Destination;
  to: Destination;
  opening: Opening;
  source: KotlinSource;
  at: number;
}

/** How many enclosing blocks are searched for the function declaring a destination. */
const MAX_ENCLOSING = 12;
/** How far back a function's header is read from its body's `{`. */
const MAX_FUNCTION_HEADER = 600;
/** A function's header right before its body: no braces in between, so it can't reach into the function before. */
const FUNCTION_HEADER = /\bfun\s+(?:<[^>]*>\s*)?(?:[\w.<>?]+\.)?(\w+)\s*\([^{}]*\)[^{}=()]*$/;
/** A call by name, `homeEntry(`, possibly on a receiver. */
const NAMED_CALL = /(?<!\w)(\w+)\s*\(/g;
/** How far back a call is checked for being a declaration, `fun NavGraphBuilder.homeEntry(`. */
const DECLARATION_CHARS = 80;

export function links(sources: KotlinSource[], all: Destination[]): Link[] {
  const byKey = groupBy(all, (d) => d.key);
  const helpers = helperRoutes(sources, byKey);
  const found: Link[] = [];
  const add = (from: Destination, named: Named, source: KotlinSource) => {
    const candidates = (byKey.get(named.key) ?? []).filter((d) => samePath(named.path, d.path));
    const to = nearestTo(candidates, from.source, (d) => d.source);
    // A screen opening itself (another show's details) takes a navigation call; merely naming its own route doesn't.
    const self = to === from || (to?.view !== undefined && to.view === from.view);
    if (!to || (self && !named.explicit)) return;
    // A detail pane opens beside the list pane only; from anywhere else it's pushed.
    const opening = named.replaces
      ? "replace"
      : to.opening === "pane" && !from.listPane
        ? "push"
        : to.opening;
    found.push({ from, to, opening, source, at: named.at });
  };
  for (const from of all) {
    for (const span of from.declared?.own ?? [])
      for (const named of routesIn(from.source, span, byKey, helpers, true)) add(from, named, from.source);
    const view = from.view;
    if (view)
      for (const named of routesIn(view.source, view.body, byKey, helpers, false))
        add(from, named, view.source);
  }
  for (const { from, source, span } of callbacksPassed(sources, all))
    for (const named of routesIn(source, span, byKey, helpers, true)) add(from, named, source);
  return distinct(found);
}

/** The same route, or its end (`Podcast` imported from `Screen.Podcast`); `Icons.Default.Home` isn't `Home`. */
export const samePath = (written: string, path: string) => written === path || path.endsWith(`.${written}`);

/** Navigation calls naming a route the app doesn't declare (a library's, say), so no link can be drawn. */
export function unresolvedCalls(all: Destination[]): number {
  const byKey = groupBy(all, (d) => d.key);
  let count = 0;
  const spansOf = (d: Destination): [KotlinSource, [number, number]][] => [
    ...(d.declared?.own ?? []).map((span): [KotlinSource, [number, number]] => [d.source, span]),
    ...(d.view ? [[d.view.source, d.view.body] as [KotlinSource, [number, number]]] : []),
  ];
  for (const d of all) {
    for (const [source, [start, end]] of spansOf(d)) {
      for (const m of source.code.slice(start, end).matchAll(NAVIGATE_CALL)) {
        if (!navigation(m).navigates) continue;
        const open = start + (m.index ?? 0) + m[0].length - 1;
        const first = callArguments(source, open).args[0];
        const route = first
          ? routeIn(source.written.slice(first.at, first.at + first.value.length))
          : undefined;
        if (route && !(byKey.get(route.key) ?? []).some((c) => samePath(route.path, c.path))) count++;
      }
    }
  }
  return count;
}

function distinct(found: Link[]): Link[] {
  const seen = new Map<Destination, Set<Destination>>();
  return found.filter(({ from, to }) => {
    const targets = seen.get(from) ?? new Set<Destination>();
    seen.set(from, targets);
    if (targets.has(to)) return false;
    targets.add(to);
    return true;
  });
}

function declaringFunction({ source, declared }: Destination): string | undefined {
  if (!declared) return undefined;
  const { enclosing } = treeOf(source);
  let open = enclosing[declared.block[0]] ?? -1;
  for (let level = 0; open !== -1 && level < MAX_ENCLOSING; level++, open = enclosing[open] ?? -1) {
    if (source.code[open] !== "{") continue;
    const name = source.code.slice(Math.max(0, open - MAX_FUNCTION_HEADER), open).match(FUNCTION_HEADER)?.[1];
    if (name) return name;
  }
  return undefined;
}

/** Arguments passed to a function declaring one destination: its callbacks hold that destination's navigation. */
function callbacksPassed(sources: KotlinSource[], all: Destination[]) {
  const single = new Map<string, Destination>();
  for (const [name, list] of groupBy(all, declaringFunction))
    if (name && list.length === 1 && list[0]) single.set(name, list[0]);
  if (single.size === 0) return [];
  return sources.flatMap((source) =>
    [...source.code.matchAll(NAMED_CALL)].flatMap((m) => {
      const from = single.get(m[1] ?? "");
      const at = m.index ?? 0;
      const before = source.code.slice(Math.max(0, at - DECLARATION_CHARS), at);
      if (!from || isDeclared(source.code, at) || /\bfun\s+(?:[\w.<>?]+\.)?$/.test(before)) return [];
      const { close } = callArguments(source, at + m[0].length - 1);
      return close > at ? [{ from, source, span: [at + m[0].length, close] as [number, number] }] : [];
    }),
  );
}
