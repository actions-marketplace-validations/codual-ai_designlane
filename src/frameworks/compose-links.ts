/** Which destination opens which, for Google's navigation libraries, including navigation passed in through
 * callbacks. */

import { groupBy } from "../scan/counting.js";
import type { Opening } from "../scan/types.js";
import type { ComposableFunction, DrawnView } from "./compose-functions.js";
import { type Destination, drawingViews, drawnBy, routeIn } from "./compose-navigation.js";
import { helperRoutes, NAVIGATE_CALL, type Named, navigation, routesIn } from "./compose-routes.js";
import { callArguments, isDeclared } from "./kotlin-calls.js";
import { type KotlinSource, nearestTo, treeOf } from "./kotlin-sources.js";

/** One destination opening another, how it appears, and where the code does it. */
export interface Link {
  from: Destination;
  /** The view of `from` the link is made from: the one whose call or body makes it, or each it may draw. */
  fromView: ComposableFunction | undefined;
  to: Destination;
  opening: Opening;
  source: KotlinSource;
  at: number;
}

/** How many enclosing blocks are searched for the function declaring a destination. */
const MAX_ENCLOSING = 12;
/** How far back a function's header is read from its body's `{`. */
const MAX_FUNCTION_HEADER = 600;
/** A function's header right before its body, read from the last `fun` (see `functionNameBefore`). */
const FUNCTION_HEADER = /\bfun\s+(?:<[^>]*>\s*)?(?:[\w.<>?]+\.)?(\w+)\s*\([^{}]*\)[^{}=()]*$/;
const FUN_KEYWORD = /\bfun\s/g;

/** The name of the function whose header ends `head`. It's read from the last `fun`: a one-line function before it
 * (`fun NavController.navigateToForYou() = navigate(ForYouRoute)`) has no braces to stop at. */
function functionNameBefore(head: string): string | undefined {
  const last = [...head.matchAll(FUN_KEYWORD)].at(-1)?.index;
  return last === undefined ? undefined : head.slice(last).match(FUNCTION_HEADER)?.[1];
}
/** A call by name, `homeEntry(`, possibly on a receiver. */
const NAMED_CALL = /(?<!\w)(\w+)\s*\(/g;
/** How far back a call is checked for being a declaration, `fun NavGraphBuilder.homeEntry(`. */
const DECLARATION_CHARS = 80;

export function links(sources: KotlinSource[], all: Destination[]): Link[] {
  const byKey = groupBy(all, (d) => d.key);
  const helpers = helperRoutes(sources, byKey);
  const found: Link[] = [];
  const add = (
    from: Destination,
    named: Named,
    source: KotlinSource,
    madeIn = viewsMaking(from, source, named.at),
  ) => {
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
    for (const fromView of madeIn) found.push({ from, fromView, to, opening, source, at: named.at });
  };
  for (const from of all) {
    for (const span of from.declared?.own ?? [])
      for (const named of routesIn(from.source, span, byKey, helpers, true)) add(from, named, from.source);
    for (const view of drawingViews(from))
      for (const named of routesIn(view.source, view.body, byKey, helpers, false))
        add(from, named, view.source, [view]);
  }
  for (const { from, source, span, param } of callbacksPassed(sources, all)) {
    const madeIn = param ? usingParameter(from, param) : undefined;
    for (const named of routesIn(source, span, byKey, helpers, true)) add(from, named, source, madeIn);
  }
  return distinct(found);
}

/** The views of `from` a link made at `at` in `source` is made from: the one whose call holds it
 * (`ScientificTuner(onOpen = { navigate(…) })`), or every view it may draw, for navigation they share (a callback
 * handed to each, an effect beside them). */
function viewsMaking(
  from: Destination,
  source: KotlinSource,
  at: number,
): (ComposableFunction | undefined)[] {
  const drawing = source === from.source ? callHolding(from.drawn ?? [], at) : undefined;
  if (drawing) return [drawing.view];
  const views = drawnBy(from);
  return views.length > 0 ? views : [undefined];
}

/** The drawn view whose call holds `at`, by binary search: calls are in order and don't overlap. */
function callHolding(drawn: DrawnView[], at: number): DrawnView | undefined {
  let [low, high] = [0, drawn.length - 1];
  while (low <= high) {
    const mid = (low + high) >> 1;
    const d = drawn[mid];
    if (!d) return undefined;
    if (at < d.call[0]) high = mid - 1;
    else if (at >= d.call[1]) low = mid + 1;
    else return d;
  }
  return undefined;
}

/** The views of `from` that hand a parameter of the function declaring it on as an argument's value
 * (`Beta(onOpen = onB)`, not `Beta(onB = …)`) or in their trailing block; all it may draw when none does. */
function usingParameter(from: Destination, param: string): (ComposableFunction | undefined)[] | undefined {
  const named = new RegExp(String.raw`\b${param}\b`);
  const using = (from.drawn ?? []).filter((d) => {
    if (from.source.code[d.open] === "{") return named.test(from.source.code.slice(d.open, d.call[1]));
    const { args, close } = callArguments(from.source, d.open);
    return args.some((a) => named.test(a.value)) || named.test(from.source.code.slice(close + 1, d.call[1]));
  });
  return using.length > 0 ? [...new Set(using.map((d) => d.view))] : undefined;
}

/** The same route, or its end (`Podcast` imported from `Screen.Podcast`); `Icons.Default.Home` isn't `Home`. */
export const samePath = (written: string, path: string) => written === path || path.endsWith(`.${written}`);

/** Navigation calls naming a route the app doesn't declare (a library's, say), so no link can be drawn. */
export function unresolvedCalls(all: Destination[]): number {
  const byKey = groupBy(all, (d) => d.key);
  let count = 0;
  const spansOf = (d: Destination): [KotlinSource, [number, number]][] => [
    ...(d.declared?.own ?? []).map((span): [KotlinSource, [number, number]] => [d.source, span]),
    ...drawingViews(d).map((v): [KotlinSource, [number, number]] => [v.source, v.body]),
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
  const seen = new Map<Destination, Map<ComposableFunction | undefined, Set<Destination>>>();
  return found.filter(({ from, fromView, to }) => {
    const byView = seen.get(from) ?? new Map<ComposableFunction | undefined, Set<Destination>>();
    seen.set(from, byView);
    const targets = byView.get(fromView) ?? new Set<Destination>();
    byView.set(fromView, targets);
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
    const name = functionNameBefore(source.code.slice(Math.max(0, open - MAX_FUNCTION_HEADER), open));
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
      const { args, close } = callArguments(source, at + m[0].length - 1);
      if (close <= at) return [];
      // Each argument on its own: a named callback is used by the view whose call names it.
      return args.map((a) => ({
        from,
        source,
        param: a.name,
        span: [a.at, a.at + a.value.length] as [number, number],
      }));
    }),
  );
}
