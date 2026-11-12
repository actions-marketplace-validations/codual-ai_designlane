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
const PREVIEW = /@(?:\w+\.)*\w*Preview\w*/;
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
  const newline = code.indexOf("\n", at);
  const lineEnd = newline === -1 ? code.length : newline;
  const open = code.indexOf("(", at);
  let end = open !== -1 && open < lineEnd ? (closeOf.get(open) ?? lineEnd) : lineEnd;
  const gap = code.slice(end + 1, end + 1 + MAX_RETURN_TYPE).search(/\S/);
  const brace = gap === -1 ? -1 : end + 1 + gap;
  if (code[brace] === "{") end = closeOf.get(brace) ?? end;
  return [at, end];
}

/** A capitalised name being called, `Name(` or `Name {`: possibly another view placed inside this one. */
export const CALL = /(?<![\w.])([A-Z]\w*)\s*[({]/g;

export const viewsByName = (views: ComposableFunction[]) => groupBy(views, (v) => v.name);

/** A composable that runs a side effect and draws nothing, `NewIntentEffect`, by Compose's naming. */
const EFFECT = /Effects?$/;

/** The first of the app's views called in `spans`, passing over wrappers (themes) and effects. */
export function firstViewIn(
  source: KotlinSource,
  spans: [number, number][],
  byName: Map<string, ComposableFunction[]>,
): ComposableFunction | undefined {
  for (const [start, end] of spans) {
    for (const m of source.code.slice(start, end).matchAll(CALL)) {
      const view = nearestTo(byName.get(m[1] ?? "") ?? [], source, (v) => v.source);
      if (view && !view.holdsViews && !EFFECT.test(view.name)) return view;
    }
  }
  return undefined;
}
