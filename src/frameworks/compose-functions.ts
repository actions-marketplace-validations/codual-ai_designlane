/** A Compose app's views (every `@Composable fun Name(…)`) and the first view a block of code draws. */

import { groupBy } from "../scan/counting.js";
import { callArguments } from "./kotlin-calls.js";
import { type KotlinSource, nearestTo, treeOf } from "./kotlin-sources.js";
import { lineNumbers } from "./source-text.js";

export interface ComposableFunction {
  name: string;
  source: KotlinSource;
  line: number;
  /** The offsets of its body: a block, or the expression after `=`. */
  body: [number, number];
  /** Takes another view as a parameter (`content: @Composable () -> Unit`), so it's built to hold views. */
  holdsViews: boolean;
}

/** How far after `@Composable` its function's name may be, past other annotations and modifiers. */
const MAX_DECLARATION_HEAD = 300;
/** How long a return type may be, between a function's `)` and its body. */
const MAX_RETURN_TYPE = 200;
/** A `fun`, with an optional receiver (`RowScope.`) and type parameters, whose name starts with a capital. */
const FUNCTION = /^[^{}=;]*?\bfun\s+(?:<[^>]*>\s*)?(?:[\w.<>?]+\.)?([A-Z]\w*)\s*\(/;
/** Previews show a view in the IDE and aren't part of the app: `@Preview`, `@PreviewLightDark`, an app's own
 * `@DevicePreviews`. */
export const PREVIEW = /@(?:\w+\.)*\w*Preview\w*/;
/** How far back the annotations stacked above `@Composable` are read, for a preview written before it. */
const MAX_ANNOTATIONS = 200;

export function composableFunctions(sources: KotlinSource[]): ComposableFunction[] {
  return sources.flatMap((source) => {
    const { code } = source;
    const found: Omit<ComposableFunction, "line">[] = [];
    const seen = new Set<number>();
    for (const m of code.matchAll(/@Composable\b/g)) {
      const at = m.index ?? 0;
      const head = code.slice(at, at + MAX_DECLARATION_HEAD);
      const fn = head.match(FUNCTION);
      if (!fn?.[1] || PREVIEW.test(head.slice(0, fn.index ?? 0) + annotationsBefore(code, at))) continue;
      const open = at + (fn.index ?? 0) + fn[0].length - 1;
      if (seen.has(open)) continue;
      seen.add(open);
      const { args, close } = callArguments(source, open);
      const body = close === open ? undefined : bodyAfter(source, close + 1);
      if (body)
        found.push({
          name: fn[1],
          source,
          body,
          holdsViews: args.some((a) => /@Composable\b/.test(a.value)),
        });
    }
    const lines = lineNumbers(
      code,
      found.map((f) => f.body[0]),
    );
    return found.map((f, i) => ({ ...f, line: lines[i] ?? 1 }));
  });
}

const annotationsBefore = (code: string, at: number) =>
  code.slice(Math.max(0, at - MAX_ANNOTATIONS), at).match(/(?:@[\w.]+(?:\([^()]*\))?\s*)*$/)?.[0] ?? "";

/** A function's body: a block, or `= expression` with any trailing block (`= Scaffold(…) { … }`). */
export function bodyAfter(source: KotlinSource, from: number): [number, number] | undefined {
  const { code } = source;
  const { closeOf } = treeOf(source);
  const head = code.slice(from, from + MAX_RETURN_TYPE).match(/^\s*(?::\s*[\w.<>?, ]+)?\s*([{=])/);
  if (!head) return undefined;
  const at = from + head[0].length - 1;
  if (head[1] === "{") {
    const close = closeOf.get(at);
    return close === undefined ? undefined : [at, close];
  }
  // The expression may start on the next line (`fun navigateToSearch() =⏎ navigate(SearchRoute)`); it's found in the
  // code as written, where a string (`= "Hello"`) isn't blank.
  const skip = source.written.slice(at + 1, at + 1 + MAX_EXPRESSION_GAP).search(/\S/);
  const starts = skip === -1 ? at : at + 1 + skip;
  const newline = code.indexOf("\n", starts);
  const lineEnd = newline === -1 ? code.length : newline;
  const open = code.indexOf("(", starts);
  const end = open !== -1 && open < lineEnd ? (closeOf.get(open) ?? lineEnd) : lineEnd;
  return [at, pastTrailingBlock(code, end, closeOf)];
}

/** How far after `=` a function's expression body may start. */
const MAX_EXPRESSION_GAP = 200;

/** A capitalised name being called, `Name(` or `Name {`: possibly another view placed inside this one. */
export const CALL = /(?<![\w.])([A-Z]\w*)\s*[({]/g;

/** Views by name, one per file: overloads in a file are one view, so a call to them, from any file, finds it. It's
 * the first, or the first built to hold views (`Rail(content)` beside `Rail(x)`), so a call's trailing block isn't
 * taken for a screen of its own. */
export function viewsByName(views: ComposableFunction[]): Map<string, ComposableFunction[]> {
  const chosen = new Map<string, ComposableFunction>();
  for (const v of views) {
    const key = `${v.source.rel}#${v.name}`;
    const before = chosen.get(key);
    if (!before || (v.holdsViews && !before.holdsViews)) chosen.set(key, v);
  }
  return groupBy([...chosen.values()], (v) => v.name);
}

/** The view standing for `view` and its overloads in `byName` (see `viewsByName`). */
export const overloadFor = (byName: Map<string, ComposableFunction[]>, view: ComposableFunction) =>
  byName.get(view.name)?.find((v) => v.source === view.source) ?? view;

/** A composable that runs a side effect and draws nothing, `NewIntentEffect`, by Compose's naming. */
/** A view named as an effect (`AuthEffect`), drawing nothing. */
export const EFFECT = /Effects?$/;

/** A view a destination draws, and the span of its call: what navigation inside that call is made from. */
export interface DrawnView {
  view: ComposableFunction;
  /** From the view's name to the end of its call, past a trailing block. */
  call: [number, number];
  /** Its call's `(` or `{`. */
  open: number;
}

/** The views drawn in `spans`, in order, side by side or in turn (`if (scientific) ScientificTuner(…) else Tuner(…)`):
 * the app's own views, passing over wrappers (themes) and effects, but not views called inside another's call. */
export function viewsIn(
  source: KotlinSource,
  spans: [number, number][],
  byName: Map<string, ComposableFunction[]>,
): DrawnView[] {
  const { closeOf } = treeOf(source);
  const drawn: DrawnView[] = [];
  let coveredUntil = -1;
  for (const [start, end] of spans) {
    for (const m of source.code.slice(start, end).matchAll(CALL)) {
      const at = start + (m.index ?? 0);
      if (at < coveredUntil) continue;
      const view = nearestTo(byName.get(m[1] ?? "") ?? [], source, (v) => v.source);
      if (!view || view.holdsViews || EFFECT.test(view.name)) continue;
      const open = at + m[0].length - 1;
      const close = closeOf.get(open) ?? open;
      coveredUntil = source.code[open] === "{" ? close : pastTrailingBlock(source.code, close, closeOf);
      drawn.push({ view, call: [at, coveredUntil], open });
    }
  }
  return drawn;
}

/** How much space may sit between a call's `)` and its trailing block. */
const MAX_TRAILING_GAP = 200;

/** Where a call closed at `close` ends: past its trailing block, `Tuner(onClick = { … }) { … }`, if it has one. */
function pastTrailingBlock(code: string, close: number, closeOf: Map<number, number>): number {
  const gap = code.slice(close + 1, close + 1 + MAX_TRAILING_GAP).search(/\S/);
  const brace = gap === -1 ? -1 : close + 1 + gap;
  return code[brace] === "{" ? (closeOf.get(brace) ?? close) : close;
}
