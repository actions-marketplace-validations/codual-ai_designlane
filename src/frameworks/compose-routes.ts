/** The routes a span of Compose code opens: navigation calls, routes held in variables, and the app's own helpers. */

import { bodyAfter } from "./compose-functions.js";
import { type Destination, routeIn, routeOf } from "./compose-navigation.js";
import { callArguments, FUNCTION_DECLARATION, isDeclared } from "./kotlin-calls.js";
import { type KotlinSource, moduleOf } from "./kotlin-sources.js";

/** A route named in code: its key, its path as written, and whether the call starts the stack again from it. */
export interface Named {
  key: string;
  path: string;
  at: number;
  replaces?: true;
  /** Opened by a navigation call or a helper, rather than only named, so it may be the screen itself. */
  explicit?: true;
}

/** Calls that navigate to their first argument; `replace`, `replaceAll` and `resetRoot` start the stack again. */
export const NAVIGATE_CALL =
  /(?:\b(\w+)\.(add|push|replace|replaceAll)|\.(navigate|goTo|resetRoot)|(?<![\w.])(navigate|goTo))\s*\(/g;
/** What `add`, `push` and `replace` must be called on to navigate rather than change a list or a string. */
const NAVIGATOR = /^(?:\w*backStack|\w*navigator|nav\w*|\w*navController|stack)$/i;

export function navigation(m: RegExpMatchArray): { navigates: boolean; replaces: boolean } {
  const onList = m[2] !== undefined;
  return {
    navigates: !onList || NAVIGATOR.test(m[1] ?? ""),
    replaces: m[2] === "replace" || m[2] === "replaceAll" || m[3] === "resetRoot",
  };
}
/** A dotted name, the way the code names a route type or constant. */
const NAME = /(?<![\w.])[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*/g;
/** How far back a name is checked for being in `popUpTo(`, `popBackStack(` and the like, which don't open it. */
const NOT_OPENING_CHARS = 40;
const NOT_OPENING =
  /\b(?:popUpTo|popBackStack|getBackStackEntry|toRoute|hasRoute|navigateUp|removeLast|remove|contains|indexOf|PopUpTo)\s*[(<]\s*$|\bis\s+$/;
/** A navigation host, whose arguments name where it starts rather than a destination being opened. */
const HOST_CALL = /(?<![\w.])(?:NavHost|NavDisplay)\s*\(/g;
/** How far back a navigation call's argument is looked for being assigned, `val screen = Screen.Podcast(uri)`. */
const MAX_HELD = 400;

/** The route a variable was given just before being navigated to: `val screen = Screen.Podcast(uri)`. */
export function heldRoute(source: KotlinSource, argument: string, call: number) {
  if (!/^[a-z]\w*$/.test(argument)) return undefined;
  const before = source.code.slice(Math.max(0, call - MAX_HELD), call);
  const assigned = [...before.matchAll(new RegExp(`\\bval\\s+${argument}\\s*(?::[^=]*)?=\\s*`, "g"))].at(-1);
  if (!assigned) return undefined;
  const at = call - before.length + (assigned.index ?? 0) + assigned[0].length;
  return routeIn(source.written.slice(at, at + MAX_HELD));
}

/** How many helpers deep a helper may navigate through another: `backToHome()` calls `navigateToDiscover()`. */
const MAX_HELPER_DEPTH = 3;

/** Per module, functions that navigate to one route (`navigateToTopic`); a name used for two routes is dropped. */
export type Helpers = Map<string, Map<string, Named | null>>;

export function helperRoutes(sources: KotlinSource[], byKey: Map<string, Destination[]>): Helpers {
  let helpers: Helpers = new Map();
  for (let depth = 0; depth < MAX_HELPER_DEPTH; depth++) helpers = helpersUsing(sources, byKey, helpers);
  return helpers;
}

function helpersUsing(sources: KotlinSource[], byKey: Map<string, Destination[]>, known: Helpers): Helpers {
  const helpers: Helpers = new Map();
  for (const source of sources) {
    for (const [name, opened] of navigationByFunction(source, byKey, known)) {
      const one = opened.every((r) => r.path === opened[0]?.path) ? opened[0] : undefined;
      const byModule = helpers.get(name) ?? new Map<string, Named | null>();
      const before = byModule.get(moduleOf(source));
      byModule.set(moduleOf(source), one && (before === undefined || before?.path === one.path) ? one : null);
      helpers.set(name, byModule);
    }
  }
  return helpers;
}

/** The route a helper called from `source` opens: its own module's, or the only module's that declares it. */
function helperFor(helpers: Helpers, name: string, source: KotlinSource): Named | undefined {
  const byModule = helpers.get(name);
  if (!byModule) return undefined;
  if (byModule.has(moduleOf(source))) return byModule.get(moduleOf(source)) ?? undefined;
  const all = [...byModule.values()];
  return all.length === 1 ? (all[0] ?? undefined) : undefined;
}

/** The routes each function's navigation calls open, each call counted for its innermost function, in one pass. */
function navigationByFunction(
  source: KotlinSource,
  byKey: Map<string, Destination[]>,
  helpers: Helpers,
): Map<string, Named[]> {
  const functions = [...source.code.matchAll(FUNCTION_DECLARATION)].flatMap((m) => {
    const open = (m.index ?? 0) + m[0].length - 1;
    const { close } = callArguments(source, open);
    const body = close > open ? bodyAfter(source, close + 1) : undefined;
    return body && m[1] ? [{ name: m[1], body }] : [];
  });
  // Sorted, since navigation calls and helper calls are found in two passes: each is matched to the function it's in
  // by walking both lists in file order.
  const calls = [...routesIn(source, [0, source.code.length], byKey, helpers, false)].sort(
    (a, b) => a.at - b.at,
  );
  const opened = new Map<string, Named[]>();
  const stack: typeof functions = [];
  let next = 0;
  for (const call of calls) {
    while (next < functions.length && (functions[next]?.body[0] ?? Number.POSITIVE_INFINITY) <= call.at) {
      const fn = functions[next++];
      if (!fn) continue;
      while (stack.length && (stack.at(-1)?.body[1] ?? 0) < fn.body[0]) stack.pop();
      stack.push(fn);
    }
    while (stack.length && (stack.at(-1)?.body[1] ?? 0) < call.at) stack.pop();
    const innermost = stack.at(-1);
    if (!innermost) continue;
    const list = opened.get(innermost.name) ?? [];
    list.push(call);
    opened.set(innermost.name, list);
  }
  return opened;
}

/** The routes a span of code opens: in navigation calls (route strings read as written), through helpers, and, when
 * `anyName`, wherever it names a route type or constant other than to go back to it. */
export function* routesIn(
  source: KotlinSource,
  [start, end]: [number, number],
  byKey: Map<string, Destination[]>,
  helpers: Helpers,
  anyName: boolean,
): Generator<Named> {
  const code = source.code.slice(start, end);
  for (const m of code.matchAll(NAVIGATE_CALL)) {
    const { navigates, replaces } = navigation(m);
    if (!navigates) continue;
    const open = start + (m.index ?? 0) + m[0].length - 1;
    const first = callArguments(source, open).args[0];
    const route = first ? routeIn(source.written.slice(first.at, first.at + first.value.length)) : undefined;
    const held = route ?? (first ? heldRoute(source, first.value, open) : undefined);
    if (held && byKey.has(held.key))
      yield { ...held, at: open, explicit: true, ...(replaces && { replaces: true as const }) };
  }
  const hosts = [...code.matchAll(HOST_CALL)].map((m) => {
    const open = start + (m.index ?? 0) + m[0].length - 1;
    return [open - start, callArguments(source, open).close - start];
  });
  for (const m of code.matchAll(NAME)) {
    const at = m.index ?? 0;
    if (NOT_OPENING.test(code.slice(Math.max(0, at - NOT_OPENING_CHARS), at))) continue;
    if (hosts.some(([open, close]) => at > (open ?? 0) && at < (close ?? 0))) continue;
    const after = code.slice(at + m[0].length, at + m[0].length + 2);
    // A helper is a function: called, or passed as `::navigateToTopic`.
    const helper = helperFor(helpers, m[0].split(".").at(-1) ?? "", source);
    // Called or passed as `::navigateToTopic`, but not declared: `fun navigateToTopic(` isn't a call.
    const called = /^\s*\(/.test(after) && !isDeclared(code, at);
    if (helper && (called || code.slice(at - 2, at) === "::")) {
      yield { ...helper, at: start + at, explicit: true };
      continue;
    }
    if (!anyName || after.startsWith("::")) continue;
    const route = routeOf(m[0]);
    if (route && byKey.has(route.key)) yield { ...route, at: start + at };
  }
}
