/** Reading Kotlin declarations and calls in blanked code: a call's arguments, the name a value is assigned to, and
 * the object a constant belongs to. */

import { type KotlinSource, treeOf } from "./kotlin-sources.js";
import { lineNumbers } from "./source-text.js";

export interface Argument {
  /** The argument's name, for `name = value`. */
  name?: string;
  /** The value from the blanked code, from its first character to its last as written (a string counts). */
  value: string;
  /** Where the value starts in the file. */
  at: number;
}

/** A call longer than this isn't one worth reading (a whole theme is a few thousand characters), so hostile input
 * stays fast. */
const MAX_CALL = 20_000;

/** The arguments of the call whose `(` is at `open`, split at its own commas, and the offset of its `)`; none for a
 * call that never closes or runs past `MAX_CALL`. */
export function callArguments(source: KotlinSource, open: number): { args: Argument[]; close: number } {
  const { closeOf } = treeOf(source);
  const close = closeOf.get(open);
  if (close === undefined || close - open > MAX_CALL) return { args: [], close: open };
  const { code } = source;
  const args: Argument[] = [];
  let depth = 0;
  let start = open + 1;
  // Edges are found in the code as written, comments left out: a string is blank in `code` but still part of it.
  const push = (end: number) => {
    const named = code.slice(start, end).match(/^\s*(\w+)\s*=(?!=)/);
    const valueStart = start + (named ? named[0].length : 0);
    const written = source.written.slice(valueStart, end);
    const trimmed = written.trim();
    if (!trimmed) return;
    const at = valueStart + written.length - written.trimStart().length;
    args.push({ ...(named?.[1] && { name: named[1] }), value: code.slice(at, at + trimmed.length), at });
  };
  for (let j = open + 1; j < close; j++) {
    const c = code[j];
    // A nested call or block is jumped over whole, so nested calls don't each rescan what's inside them.
    const inner = c === "(" || c === "{" ? closeOf.get(j) : undefined;
    if (inner !== undefined && inner < close) j = inner;
    else if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) {
      push(j);
      start = j + 1;
    }
  }
  push(close);
  return { args, close };
}

/** How far back a declaration's start may be from its value. */
const MAX_DECLARATION = 300;

/** The name a value at `at` is assigned to: `val Name =`, `val Name: Type =`, `fun name(): Type =`, or a getter,
 * `val Name: Type @Composable get() =`. */
export function assignedName(code: string, at: number): string | undefined {
  const before = code.slice(Math.max(0, at - MAX_DECLARATION), at);
  return before.match(
    /\b(?:val|var|fun)\s+(\w+)(?:\s*\(\s*\))?(?:\s*:\s*[\w.<>?, ]+?)?(?:\s*(?:@\w+\s*)*get\s*\(\s*\))?\s*=\s*$/,
  )?.[1];
}

/** A function declaration, `fun NavController.navigateToTopic(`, with its name. */
export const FUNCTION_DECLARATION = /\bfun\s+(?:<[^>]*>\s*)?(?:[\w.<>?]+\.)?(\w+)\s*\(/g;

/** Whether the name at `at` is being declared (`class Color(`, `fun TextStyle(`) rather than called. */
export const isDeclared = (code: string, at: number) =>
  /\b(?:class|fun)\s+$/.test(code.slice(Math.max(0, at - 30), at));

/** How far back a block's header is read. */
const MAX_HEADER = 200;

/** How code outside reads a constant declared at `at`: `""` at the top level, `Palette.Dark` inside nested objects,
 * `Theme` in `Theme`'s companion object; undefined anywhere else, such as a function's local value. */
export function declaredIn(source: KotlinSource, at: number): string | undefined {
  const { code } = source;
  const { enclosing } = treeOf(source);
  const path: string[] = [];
  let inCompanion = false;
  for (let open = enclosing[at] ?? -1; open !== -1; open = enclosing[open] ?? -1) {
    if (code[open] !== "{") return undefined;
    const header = code.slice(Math.max(0, open - MAX_HEADER), open);
    if (inCompanion) {
      const type = header.match(/\b(?:class|interface)\s+(\w+)[^{}=]*$/)?.[1];
      if (!type) return undefined;
      path.unshift(type);
      inCompanion = false;
      continue;
    }
    const object = header.match(/\b(companion\s+)?object(?:\s+(\w+))?[^{}()=]*$/);
    if (!object) return undefined;
    if (object[1]) inCompanion = true;
    else if (object[2]) path.unshift(object[2]);
    else return undefined;
  }
  return inCompanion ? undefined : path.join(".");
}

/** Each match of `pattern` (global) in the blanked code, with its 1-based line. */
export function located(source: KotlinSource, pattern: RegExp): { m: RegExpMatchArray; line: number }[] {
  const matches = [...source.code.matchAll(pattern)];
  const lines = lineNumbers(
    source.code,
    matches.map((m) => m.index ?? 0),
  );
  return matches.map((m, i) => ({ m, line: lines[i] ?? 1 }));
}

/** A use of a dotted name: the whole path and each shorter start of it, longest first, since the path may run on
 * past the name (`Palette.Brand.copy` is a use of `Palette.Brand`). */
export function* prefixesOf(path: string): Generator<string> {
  for (let end = path.length; end > 0; end = path.lastIndexOf(".", end - 1)) yield path.slice(0, end);
}

/** Offset ranges in one file, asked about in ascending order, so a whole file's checks take one pass. */
export class Spans {
  private readonly ranges: [number, number][] = [];
  private next = 0;

  add(start: number, end: number): void {
    this.ranges.push([start, end]);
  }

  /** Sorts the ranges and starts asking from the file's beginning. */
  start(): this {
    this.ranges.sort((a, b) => a[0] - b[0]);
    this.next = 0;
    return this;
  }

  /** Whether `at` falls inside a range; each call's `at` must be at or after the one before. */
  contains(at: number): boolean {
    while (this.next < this.ranges.length && (this.ranges[this.next]?.[1] ?? 0) <= at) this.next++;
    for (let k = this.next; k < this.ranges.length; k++) {
      const [start, end] = this.ranges[k] ?? [0, 0];
      if (start > at) return false;
      if (at < end) return true;
    }
    return false;
  }
}
