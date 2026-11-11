/**
 * Just enough Swift reading to find views reliably: comments, strings and `#Preview` blocks are blanked
 * out (keeping every newline, so line numbers still match), and struct bodies are found by matching braces.
 */

import {
  type BracketTree,
  blankCommentsAndStrings,
  bracketTree,
  identifierBefore,
  skipSpaceBack,
} from "./source-text.js";

/** Swift code with comments and string literals blanked (see `blankCommentsAndStrings`). */
export const codeOnly = (text: string): string => blankCommentsAndStrings(text, commentOrStringEnd);

/** Where the Swift comment or string starting at `i` ends, or undefined when none starts there. */
export function commentOrStringEnd(text: string, i: number): number | undefined {
  if (text.startsWith("//", i)) return lineCommentEnd(text, i);
  if (text.startsWith("/*", i)) return blockCommentEnd(text, i);
  if (text[i] === '"' || /^#+"/.test(text.slice(i, i + 8))) return stringEnd(text, i);
  return undefined;
}

function lineCommentEnd(text: string, start: number): number {
  const newline = text.indexOf("\n", start);
  return newline === -1 ? text.length : newline;
}

/** Swift block comments nest, so an inner comment's close doesn't end the outer one. */
function blockCommentEnd(text: string, start: number): number {
  let depth = 0;
  let j = start;
  while (j < text.length) {
    if (text.startsWith("/*", j)) {
      depth++;
      j += 2;
    } else if (text.startsWith("*/", j)) {
      j += 2;
      if (--depth === 0) return j;
    } else j++;
  }
  return text.length;
}

/** Index just past the string literal starting at `start` (plain, multi-line or raw `#"…"#`). An interpolation,
 * `\(…)`, can hold quotes and brackets of its own, so it's skipped whole. */
function stringEnd(text: string, start: number, depth = 0): number {
  let hashes = 0;
  while (text[start + hashes] === "#") hashes++;
  const open = start + hashes;
  const multi = text.startsWith('"""', open);
  const quote = multi ? '"""' : '"';
  const closing = quote + "#".repeat(hashes);
  const escapeMark = `\\${"#".repeat(hashes)}`;
  let j = open + quote.length;
  while (j < text.length) {
    if (text.startsWith(escapeMark, j)) {
      const after = j + escapeMark.length;
      j =
        text[after] === "(" && depth < MAX_INTERPOLATION_DEPTH
          ? interpolationEnd(text, after, depth)
          : after + 1;
      continue;
    }
    if (!multi && text[j] === "\n") return j;
    if (text.startsWith(closing, j)) return j + closing.length;
    j++;
  }
  return text.length;
}

/** Strings inside interpolations nest no deeper than this; deeper, the rest is read as plain text. */
const MAX_INTERPOLATION_DEPTH = 8;

/** Index just past the `)` closing the interpolation whose `(` is at `open`, skipping strings inside it. */
function interpolationEnd(text: string, open: number, depth: number): number {
  let brackets = 0;
  let j = open;
  while (j < text.length) {
    const c = text[j];
    if (c === "\n") return j;
    if (c === '"' || (c === "#" && /^#+"/.test(text.slice(j, j + 8)))) {
      j = stringEnd(text, j, depth + 1);
      continue;
    }
    if (c === "(") brackets++;
    else if (c === ")" && --brackets === 0) return j + 1;
    j++;
  }
  return text.length;
}

/** Blanks every `#Preview { … }` block, so views declared inside previews are ignored. */
export function withoutPreviews(code: string): string {
  const out = code.split("");
  for (const [start, end] of previewRanges(code))
    for (let k = start; k < end; k++) if (out[k] !== "\n") out[k] = " ";
  return out.join("");
}

/** Where each `#Preview { … }` block starts and ends (exclusive), in order, given blanked code (see `codeOnly`). */
export function previewRanges(code: string): [number, number][] {
  const { nextOpen, closeOf } = braceIndex(code);
  const ranges: [number, number][] = [];
  for (const m of code.matchAll(/#Preview\b/g)) {
    const at = m.index ?? 0;
    const open = nextOpen[at] ?? -1;
    if (at < (ranges.at(-1)?.[1] ?? 0) || open === -1) continue;
    ranges.push([at, (closeOf.get(open) ?? code.length - 1) + 1]);
  }
  return ranges;
}

export interface StructDecl {
  name: string;
  /** Offset of the `struct` keyword. */
  start: number;
  /** Offsets of the body's braces. */
  open: number;
  close: number;
  conformances: string[];
  /** Generic over a view type (`struct Card<Content: View>`), so it holds other views. */
  holdsViews: boolean;
}

const STRUCT = /\bstruct\s+([A-Za-z_]\w*)/g;

/** Every struct declaration in blanked code (see `codeOnly`), with its conformances and body. Linear in the file size. */
export function structs(code: string): StructDecl[] {
  const { nextOpen, closeOf } = braceIndex(code);
  const out: StructDecl[] = [];
  for (const m of code.matchAll(STRUCT)) {
    let j = (m.index ?? 0) + m[0].length;
    const genericsStart = j;
    if (code[j] === "<") j = skipGenerics(code, j);
    const generics = code.slice(genericsStart, j);
    const open = nextOpen[j] ?? -1;
    if (open === -1 || open - j > MAX_HEADER) continue;
    const header = code.slice(j, open);
    const colon = header.indexOf(":");
    const list = colon === -1 ? "" : (header.slice(colon + 1).split(/\bwhere\b/)[0] ?? "");
    out.push({
      name: m[1] ?? "",
      start: m.index ?? 0,
      open,
      close: closeOf.get(open) ?? code.length - 1,
      holdsViews: /:\s*View\b/.test(generics),
      conformances: list
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    });
  }
  return out;
}

/** A declaration header longer than this isn't a real one; stops pathological input from scanning far. */
const MAX_HEADER = 2000;

/** For every offset, the next `{` at or after it, plus each bracket's matching close. */
function braceIndex(code: string) {
  const nextOpen = new Int32Array(code.length + 1).fill(-1);
  for (let j = code.length - 1; j >= 0; j--) nextOpen[j] = code[j] === "{" ? j : (nextOpen[j + 1] ?? -1);
  return { nextOpen, closeOf: bracketTree(code).closeOf };
}

function skipGenerics(text: string, start: number): number {
  let depth = 0;
  for (let j = start; j < text.length && j - start < MAX_HEADER; j++) {
    if (text[j] === "<") depth++;
    else if (text[j] === ">" && --depth === 0) return j + 1;
    else if (text[j] === "{") return j;
  }
  return text.length;
}

/** How far back to read for the code that owns a bracket, so hostile input stays fast. */
export const HEADER_CHARS = 400;

export type CallOwner = { kind: "call"; name: string; hasArguments: boolean };
export type Owner =
  | CallOwner
  | { kind: "declaration"; name: string }
  | { kind: "switch" }
  | { kind: "conditional" }
  | { kind: "labelled"; label: string };

/** What a bracket belongs to: a call (`sheet`, `NavigationStack`), a function or property, a switch, an `if`, or a
 * labelled closure (`label: {`). */
export function ownerOf(code: string, tree: BracketTree, open: number): Owner {
  const end = skipSpaceBack(code, open);
  if (code[open] === "{") {
    const header = code.slice(Math.max(0, end - HEADER_CHARS), end);
    if (/\bswitch\b[^{}]*$/.test(header)) return { kind: "switch" };
    // Not `#if`, a compiler directive rather than a block.
    if (/(?<![#\w])(?:if|else|guard)\b[^{}]*$/.test(header)) return { kind: "conditional" };
    // A function, or a computed property (`var body: some View {`), never a stored one (`var x = …`).
    const declaration = header.match(
      /\b(?:func\s+(?<func>\w+)\s*[(<][^{}]*|var\s+(?<property>\w+)\s*:[^{}=]*)$/,
    );
    if (declaration)
      return { kind: "declaration", name: declaration.groups?.func ?? declaration.groups?.property ?? "" };
    if (header.endsWith(":")) return { kind: "labelled", label: identifierBefore(code, end - 1) };
  }
  const callOpen = code[open] === "{" && code[end - 1] === ")" ? (tree.openOf.get(end - 1) ?? -1) : -1;
  return {
    kind: "call",
    name: identifierBefore(code, callOpen === -1 ? end : callOpen),
    hasArguments: callOpen !== -1,
  };
}
