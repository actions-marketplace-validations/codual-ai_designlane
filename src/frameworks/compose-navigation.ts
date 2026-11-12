/** The destinations a Compose app declares with Navigation Compose or Navigation 3, and the view that draws each. */

import { groupBy } from "../scan/counting.js";
import type { Opening } from "../scan/types.js";
import { type ComposableFunction, firstViewIn, viewsByName } from "./compose-functions.js";
import { type Argument, callArguments, isDeclared } from "./kotlin-calls.js";
import { type KotlinSource, treeOf } from "./kotlin-sources.js";

/** Where a destination is declared, and its block's own parts (without nested destinations). */
export interface Declaration {
  start: number;
  block: [number, number];
  own: [number, number][];
}

/** A place the app can navigate to, and the view that draws it. */
export interface Destination {
  /** What navigation names it by: a route type's or constant's last part, or a route string's fixed start. */
  key: string;
  /** The route as written, without a package or a trailing `.route`: `Screen.Podcast`, `Routes.HOME`, `home`. */
  path: string;
  opening: Opening;
  source: KotlinSource;
  /** The list a detail pane opens beside (`listPane()`): only what it opens shows as a pane. */
  listPane?: true;
  /** Where it's declared; Circuit screens are classes, without a block of their own. */
  declared?: Declaration;
  view?: ComposableFunction;
}

/** How long a route type between `<` and `>` may be. */
const MAX_TYPE_ARGUMENT = 120;
/** A call declaring a destination: `composable`, an app's wrapper of it, `entry`, `dialog`, `bottomSheet` or
 * `NavEntry`. */
const DESTINATION_CALL = new RegExp(
  `(?<![\\w.@])(\\w*[cC]omposable\\w*|entry|dialog|bottomSheet|NavEntry)\\s*(<[^<>(){}]{1,${MAX_TYPE_ARGUMENT}}>)?\\s*([({])`,
  "g",
);
/** How much space may sit between a call's `)` and its trailing block. */
const MAX_GAP = 200;
/** How far back a `NavEntry`'s `is TopicKey ->` branch is read. */
const MAX_BRANCH_HEAD = 200;

export function destinations(sources: KotlinSource[], views: ComposableFunction[]): Destination[] {
  const byName = viewsByName(views);
  const found = sources.flatMap((source) =>
    [...source.code.matchAll(DESTINATION_CALL)].flatMap((m): Destination[] => {
      const start = m.index ?? 0;
      if (isDeclared(source.code, start)) return [];
      const parts = blockOf(source, start + m[0].length - 1, m[3] === "(");
      if (!parts) return [];
      const route = m[2]
        ? routeOf(m[2].slice(1, -1))
        : m[1] === "NavEntry"
          ? routeOf(branchBefore(source.code, start))
          : routeArgument(source, parts.args);
      if (!route) return [];
      const declared = { start, block: parts.block, own: [parts.block] };
      const written = parts.args.map((a) => source.written.slice(a.at, a.at + a.value.length)).join(",");
      return [
        {
          ...route,
          opening: openingOf(m[1] ?? "", written),
          source,
          declared,
          ...(LIST_PANE.test(written) && { listPane: true as const }),
        },
      ];
    }),
  );
  cutNested(found);
  for (const d of found) {
    const view = d.declared && firstViewIn(d.source, d.declared.own, byName);
    if (view) d.view = view;
  }
  return found;
}

/** The type a `when` branch matches just before `at`: `TopicKey` in `is TopicKey -> NavEntry(key) {`. */
const branchBefore = (code: string, at: number) =>
  code.slice(Math.max(0, at - MAX_BRANCH_HEAD), at).match(/\bis\s+([\w.]+)\s*->\s*$/)?.[1] ?? "";

function blockOf(source: KotlinSource, opens: number, hasArguments: boolean) {
  const { closeOf } = treeOf(source);
  let args: Argument[] = [];
  let braceAt = opens;
  if (hasArguments) {
    const call = callArguments(source, opens);
    if (call.close === opens) return undefined;
    args = call.args;
    const gap = source.code.slice(call.close + 1, call.close + 1 + MAX_GAP).search(/\S/);
    if (gap === -1) return undefined;
    braceAt = call.close + 1 + gap;
  }
  const close = source.code[braceAt] === "{" ? closeOf.get(braceAt) : undefined;
  if (close !== undefined) return { args, block: [braceAt, close] as [number, number] };
  // A block passed as a `content = { … }` argument counts as the trailing one.
  const content = args.find((a) => a.name === "content" && a.value.startsWith("{"));
  const contentClose = content ? closeOf.get(content.at) : undefined;
  return content && contentClose !== undefined
    ? { args, block: [content.at, contentClose] as [number, number] }
    : undefined;
}

/** Cuts each destination declared inside another's block, such as a nested host's, out of that block's own parts. */
function cutNested(all: Destination[]): void {
  for (const list of groupBy(all, (d) => d.source).values()) {
    const sorted = list.flatMap((d) => (d.declared ? [d.declared] : [])).sort((a, b) => a.start - b.start);
    // The declarations whose blocks are still open, walked once in order.
    const open: Declaration[] = [];
    for (const d of sorted) {
      while (open.length && (open.at(-1)?.block[1] ?? 0) < d.start) open.pop();
      const parent = open.at(-1);
      const last = parent?.own.pop();
      if (parent && last) parent.own.push([last[0], d.start], [d.block[1] + 1, last[1]]);
      open.push(d);
    }
  }
}

/** A destination shown as a pane beside the list that opens it, on a wide screen: `detailPane()` or `extraPane()`. */
const PANE = /\b(?:detail|extra)Pane\s*\(/;
const LIST_PANE = /\blistPane\s*[({]/;

/** How a destination appears, from the call declaring it and its arguments as written. */
const openingOf = (call: string, args: string): Opening =>
  /dialog/i.test(call) ? "dialog" : /sheet/i.test(call) ? "sheet" : PANE.test(args) ? "pane" : "push";

/** Where an app's navigation starts: a host's `startDestination`, or the first key a back stack is made with. */
const START =
  /\bstart(?:Destination|Key|Route)\s*=|\b(?:rememberNavBackStack|rememberSaveableBackStack|mutableStateListOf)\s*\(\s*(?:root\s*=\s*)?(?:listOf\s*\(\s*)?/g;

/** A Navigation Compose host, whose second argument is its start when it isn't named. */
const HOST = /(?<![\w.])NavHost\s*\(/g;
/** A nested graph, `navigation<MainGraph>(startDestination = Home)`, read just before its `(`. */
const NESTED_GRAPH = /\bnavigation\s*(?:<([^<>]*)>)?\s*$/;
/** How many nested graphs a start may lead through to its first screen. */
const MAX_GRAPHS = 6;

/** The app's start routes; a start naming a nested graph leads on to that graph's own start. */
export function startRoutes(sources: KotlinSource[]): { key: string; path: string; source: KotlinSource }[] {
  const graphs = new Map<string, { key: string; path: string }>();
  const starts = sources.flatMap((source) =>
    [...source.code.matchAll(START)].flatMap((m) => {
      const at = (m.index ?? 0) + m[0].length;
      const gap = source.written.slice(at, at + MAX_GAP).search(/\S/);
      const route =
        gap === -1 ? undefined : routeIn(source.written.slice(at + gap, at + gap + MAX_TYPE_ARGUMENT));
      if (!route) return [];
      const graph = nestedGraph(source, m.index ?? 0);
      if (graph === undefined) return [{ ...route, source }];
      if (graph) graphs.set(graph, route);
      return [];
    }),
  );
  // A host given its start without naming it: `NavHost(navController, Screen.Discover.route)`.
  for (const source of sources) {
    for (const m of source.code.matchAll(HOST)) {
      const { args } = callArguments(source, (m.index ?? 0) + m[0].length - 1);
      const second = args[1];
      if (args.some((a) => a.name === "startDestination") || !second || second.name) continue;
      const route = routeIn(source.written.slice(second.at, second.at + second.value.length));
      if (route) starts.push({ ...route, source });
    }
  }
  return starts.map((start) => {
    let route: { key: string; path: string } = start;
    for (let step = 0; step < MAX_GRAPHS && graphs.has(route.key); step++)
      route = graphs.get(route.key) ?? route;
    return { ...route, source: start.source };
  });
}

/** The nested graph whose arguments `at` is in (`""` when unnamed), or undefined when it isn't in one. */
function nestedGraph(source: KotlinSource, at: number): string | undefined {
  const open = treeOf(source).enclosing[at] ?? -1;
  if (open === -1 || source.code[open] !== "(") return undefined;
  const graph = source.code.slice(Math.max(0, open - MAX_TYPE_ARGUMENT), open).match(NESTED_GRAPH);
  if (!graph) return undefined;
  if (graph[1]) return routeOf(graph[1])?.key ?? "";
  const route = callArguments(source, open).args.find((a) => a.name === "route");
  return (route && routeIn(source.written.slice(route.at, route.at + route.value.length))?.key) ?? "";
}

/** A route name without its package or a trailing property (`Screen.Podcast`); all-lowercase is a variable. */
export function routeOf(name: string): { key: string; path: string } | undefined {
  const parts = name.trim().split(".");
  while (parts.length && /^[a-z]/.test(parts[0] ?? "")) parts.shift();
  while (parts.length && !/^[A-Z]/.test(parts.at(-1) ?? "")) parts.pop();
  const key = parts.at(-1);
  return key ? { key, path: parts.join(".") } : undefined;
}

function routeArgument(source: KotlinSource, args: Argument[]) {
  const route = args.find((a) => a.name === "route") ?? args.find((a) => !a.name);
  return route ? routeIn(source.written.slice(route.at, route.at + route.value.length)) : undefined;
}

/** A route as written: a template's constant, a string's fixed start (`"settings/{id}"` is `settings`), or a name. */
export function routeIn(written: string): { key: string; path: string } | undefined {
  // A back stack given as a list (`replaceAll(listOf(TopicsKey))`) starts at its first route.
  const listed = written.match(/^(?:mutable)?[lL]istOf\s*\(\s*([\s\S]*)$/)?.[1];
  if (listed !== undefined) return routeIn(listed);
  const template = written.match(/^"\$\{?\s*([A-Za-z_][\w.]*)/)?.[1];
  if (template) return routeOf(template);
  const literal = written.match(/^"([A-Za-z_][^"{?$]*)/)?.[1]?.replace(/\/+$/, "");
  if (literal) return { key: literal, path: literal };
  const name = written.match(/^[A-Za-z_][\w.]*/)?.[0];
  return name ? routeOf(name) : undefined;
}
