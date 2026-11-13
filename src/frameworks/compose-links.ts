/** Which destination opens which, for Google's navigation libraries, including navigation passed in through
 * callbacks. */

import { groupBy } from "../scan/counting.js";
import type { Opening } from "../scan/types.js";
import {
  CALL,
  type ComposableFunction,
  type DrawnView,
  EFFECT,
  overloadFor,
  viewsByName,
} from "./compose-functions.js";
import { type Destination, drawingViews, drawnBy, routeIn } from "./compose-navigation.js";
import {
  graphSpans,
  type Helpers,
  HOST_CALL,
  NAVIGATE_CALL,
  type Named,
  navigation,
  overlaps,
  routesIn,
} from "./compose-routes.js";
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

/** A link made by a view that only sits in screens (a row, a menu): `screenLinks` credits it to the screens
 * holding it. */
export type PartLink = Pick<Link, "fromView" | "to" | "opening" | "source" | "at">;

/** How many parts deep a part is followed up to a list pane, as `screenLinks` credits it. */
const MAX_LEVELS = 4;
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

export function links(sources: KotlinSource[], all: Destination[], helpers: Helpers): Link[] {
  const byKey = groupBy(all, (d) => d.key);
  const blocks = graphSpans(byKey);
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
      for (const span of ownBody(view, blocks))
        for (const named of routesIn(view.source, span, byKey, helpers, false))
          add(from, named, view.source, [view]);
  }
  for (const { from, source, span, param } of callbacksPassed(sources, all)) {
    const madeIn = param ? usingParameter(from, param) : undefined;
    for (const named of routesIn(source, span, byKey, helpers, true)) add(from, named, source, madeIn);
  }
  return distinct(found);
}

/** Links made by views no destination draws, navigating by themselves (`navController.navigate("artist/$id")` in a
 * song's menu). The app's frame is left out (see `frames`), and so are parts only it places (a rail around each
 * screen). */
export function partLinks(
  views: ComposableFunction[],
  all: Destination[],
  helpers: Helpers,
): { links: PartLink[]; unresolved: number } {
  const byKey = groupBy(all, (d) => d.key);
  const drawn = new Set(all.flatMap(drawingViews));
  const drawing = new Set([...drawn].map(sameView));
  const listPanes = new Set(
    all
      .filter((d) => d.listPane)
      .flatMap(drawingViews)
      .map(sameView),
  );
  const byName = viewsByName(views);
  const { outside, holders } = frames(views, byName, all, drawing);
  const found: PartLink[] = [];
  let unresolved = 0;
  for (const view of views) {
    // An effect beside a screen is read as a helper of the destination drawing it (see `navigationByFunction`). A
    // drawn view's other overloads (`Home(state, nav)` behind `Home(nav)`) are read here, credited to it.
    if (drawn.has(view) || outside.has(sameView(view)) || EFFECT.test(view.name)) continue;
    const seen = new Set<string>();
    for (const named of routesIn(view.source, view.body, byKey, helpers, false)) {
      if (ownCallback(view, named.at)) continue;
      const candidates = (byKey.get(named.key) ?? []).filter((d) => samePath(named.path, d.path));
      const to = nearestTo(candidates, view.source, (d) => d.source);
      if (!to) continue;
      // A detail pane opens beside the list pane holding the part; from anywhere else it's pushed. One opening is
      // credited to every screen holding the part, so it's a pane only when each of them is a list pane.
      const screens = to.opening === "pane" ? screensHolding(view, holders, drawing) : [];
      const pane = screens.length > 0 && screens.every((k) => listPanes.has(k));
      const opening = named.replaces ? "replace" : to.opening === "pane" && !pane ? "push" : to.opening;
      const key = `${to.key}:${to.path}:${opening}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Placements name the overload standing for the rest.
      found.push({ fromView: overloadFor(byName, view), to, opening, source: view.source, at: named.at });
    }
    unresolved += unresolvedIn(view.source, view.body, byKey);
  }
  return { links: found, unresolved };
}

/** Overloads in one file are one view, as placements can't tell them apart. */
const sameView = (view: ComposableFunction) => `${view.source.rel}#${view.name}`;

/** Whether the helper named `at` is the view's own parameter (`navigateToArtist: (String) -> Unit`), called bare. */
function ownCallback(view: ComposableFunction, at: number): boolean {
  const { code } = view.source;
  if (code[at] === "(") return false;
  const name = code.slice(at).match(/^[\w.?]+/)?.[0] ?? "";
  if (name.includes(".") || code.slice(at - 2, at) === "::") return false;
  return parameterNames(view).includes(name);
}

/** A parameter's name at the start of its part of the list, past annotations and modifiers. */
const PARAMETER =
  /^\s*(?:@[\w.]+(?:\([^()]*\))?\s+)*(?:(?:val|var|crossinline|noinline|vararg)\s+)*(\w+)\s*:/;

/** The names in a view's own parameter list, not those inside a parameter's function type
 * (`onEvent: (navigateToArtist: String) -> Unit`). */
function parameterNames(view: ComposableFunction): string[] {
  const { code } = view.source;
  let fun = view.body[0];
  do fun = code.lastIndexOf("fun", fun - 1);
  while (fun > 0 && (/\w/.test(code[fun - 1] ?? "") || /\w/.test(code[fun + 3] ?? "")));
  const open = code.indexOf("(", fun + 3);
  const close = open === -1 ? undefined : treeOf(view.source).closeOf.get(open);
  if (fun < 0 || close === undefined || close > view.body[0]) return [];
  const names: string[] = [];
  let [depth, start] = [0, open + 1];
  for (let i = open + 1; i <= close; i++) {
    const c = code[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if ((c === ")" || c === "]" || c === "}") && i < close) depth--;
    if ((c === "," && depth === 0) || i === close) {
      const found = code.slice(start, i).match(PARAMETER)?.[1];
      if (found) names.push(found);
      start = i + 1;
    }
  }
  return names;
}

/** The drawn views (by `sameView`) a part sits in, up to `MAX_LEVELS` deep: the screens it's credited to. */
function screensHolding(
  view: ComposableFunction,
  holders: Map<string, Set<ComposableFunction>>,
  drawing: Set<string>,
): string[] {
  const found = new Set<string>();
  let level = [sameView(view)];
  const seen = new Set(level);
  for (let depth = 0; depth < MAX_LEVELS && level.length; depth++) {
    const next: string[] = [];
    for (const key of level)
      for (const holder of holders.get(key) ?? []) {
        const k = sameView(holder);
        if (seen.has(k)) continue;
        seen.add(k);
        if (drawing.has(k)) found.add(k);
        else next.push(k);
      }
    level = next;
  }
  return [...found];
}

const HOST = new RegExp(HOST_CALL.source);

/** The views outside every screen, by `sameView`: those holding the app's navigation (a `NavHost(…)`, a graph's
 * destinations) and those placing them, up to a view a destination draws, which make the app's frame; and the parts
 * only the frame places. The frame's links (a top bar's search) belong to every screen it shows, which isn't read yet.
 * Also, for each view, the views placing it. */
function frames(
  views: ComposableFunction[],
  byName: Map<string, ComposableFunction[]>,
  all: Destination[],
  drawing: Set<string>,
) {
  const graphs = graphSpans(groupBy(all, (d) => d.key));
  const holders = new Map<string, Set<ComposableFunction>>();
  const placed = new Map<string, Set<string>>();
  const add = <T>(map: Map<string, Set<T>>, key: string, item: T) => {
    const set = map.get(key);
    if (set) set.add(item);
    else map.set(key, new Set([item]));
  };
  const pending: ComposableFunction[] = [];
  for (const view of views) {
    const body = view.source.code.slice(...view.body);
    if (overlaps(graphs.get(view.source) ?? [], view.body) || HOST.test(body)) pending.push(view);
    for (const m of body.matchAll(CALL)) {
      const part = nearestTo(byName.get(m[1] ?? "") ?? [], view.source, (v) => v.source);
      if (!part || sameView(part) === sameView(view)) continue;
      add(holders, sameView(part), view);
      add(placed, sameView(view), sameView(part));
    }
  }
  // A screen holding a nested graph (tabs under its own bar), itself or through views in it, isn't the frame: its
  // parts are its own.
  const inScreens = new Set(drawing);
  const down = [...drawing];
  for (let key = down.pop(); key; key = down.pop())
    for (const part of placed.get(key) ?? [])
      if (!inScreens.has(part)) {
        inScreens.add(part);
        down.push(part);
      }
  const outside = new Set<string>();
  for (let view = pending.pop(); view; view = pending.pop()) {
    const key = sameView(view);
    if (outside.has(key) || inScreens.has(key)) continue;
    outside.add(key);
    pending.push(...(holders.get(key) ?? []));
  }
  // A part only the frame places is outside screens too (a rail around each). Only one level down: a frame-only part's
  // own parts (a player sheet's menus) stay, since the frame's overlays open screens of their own.
  const frame = new Set(outside);
  for (const key of frame)
    for (const part of placed.get(key) ?? [])
      if (!inScreens.has(part) && [...(holders.get(part) ?? [])].every((h) => frame.has(sameView(h))))
        outside.add(part);
  return { outside, holders };
}

/** A view's body without the destinations declared in it (a nested `NavHost`): their links are read with them.
 * `blocks` are disjoint and in order (`graphSpans`). */
function ownBody(
  view: ComposableFunction,
  blocks: Map<KotlinSource, [number, number][]>,
): [number, number][] {
  const [start, end] = view.body;
  const spans: [number, number][] = [];
  let at = start;
  for (const [open, close] of blocks.get(view.source) ?? []) {
    if (close <= at || open >= end) continue;
    if (open > at) spans.push([at, open]);
    at = Math.max(at, close);
  }
  if (at < end) spans.push([at, end]);
  return spans;
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
  const blocks = graphSpans(byKey);
  let count = 0;
  for (const d of all) {
    for (const span of d.declared?.own ?? []) count += unresolvedIn(d.source, span, byKey);
    for (const v of drawingViews(d))
      for (const span of ownBody(v, blocks)) count += unresolvedIn(v.source, span, byKey);
  }
  return count;
}

/** Navigation calls in a span naming a route the app doesn't declare. */
function unresolvedIn(
  source: KotlinSource,
  [start, end]: [number, number],
  byKey: Map<string, Destination[]>,
) {
  let count = 0;
  for (const m of source.code.slice(start, end).matchAll(NAVIGATE_CALL)) {
    if (!navigation(m).navigates) continue;
    const open = start + (m.index ?? 0) + m[0].length - 1;
    const first = callArguments(source, open).args[0];
    const route = first ? routeIn(source.written.slice(first.at, first.at + first.value.length)) : undefined;
    if (route && !(byKey.get(route.key) ?? []).some((c) => samePath(route.path, c.path))) count++;
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
