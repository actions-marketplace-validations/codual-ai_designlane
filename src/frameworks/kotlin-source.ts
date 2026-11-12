/** Kotlin's comments, strings and characters, so the shared text reading can blank them (see `source-text.ts`). */

import { blankCommentsAndStrings } from "./source-text.js";

/** Kotlin code with comments, strings and character literals blanked; newlines and offsets are kept. */
export const kotlinCodeOnly = (text: string): string =>
  blankCommentsAndStrings(text, kotlinCommentOrStringEnd);

/** Kotlin text with only its comments blanked: strings are kept, and a `//` inside one isn't taken for a comment. */
export function kotlinWithoutComments(text: string): string {
  const out = text.split("");
  let i = 0;
  while (i < text.length) {
    const end = kotlinCommentOrStringEnd(text, i);
    if (end === undefined) {
      i++;
      continue;
    }
    if (text.startsWith("//", i) || text.startsWith("/*", i))
      for (let k = i; k < end; k++) if (out[k] !== "\n") out[k] = " ";
    i = end;
  }
  return out.join("");
}

/** Where the Kotlin comment, string or character literal starting at `i` ends, or undefined when none starts there. */
function kotlinCommentOrStringEnd(text: string, i: number): number | undefined {
  if (text.startsWith("//", i)) {
    const newline = text.indexOf("\n", i);
    return newline === -1 ? text.length : newline;
  }
  if (text.startsWith("/*", i)) return blockCommentEnd(text, i);
  if (text[i] === '"') return stringEnd(text, i, 0);
  if (text[i] === "'") return charEnd(text, i);
  return undefined;
}

/** Kotlin block comments nest, as Swift's do. */
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

/** Strings inside templates nest no deeper than this; deeper, the rest is read as plain text. */
const MAX_TEMPLATE_DEPTH = 8;

/** Index just past the string starting at `start`: plain `"…"` (escapes, ends at a newline) or raw `"""…"""` (no
 * escapes). A template, `${…}`, can hold braces and strings of its own, so it's skipped whole. */
function stringEnd(text: string, start: number, depth: number): number {
  const raw = text.startsWith('"""', start);
  let j = start + (raw ? 3 : 1);
  while (j < text.length) {
    const c = text[j];
    if (!raw && c === "\\") {
      j += 2;
      continue;
    }
    if (c === "$" && text[j + 1] === "{" && depth < MAX_TEMPLATE_DEPTH) {
      j = templateEnd(text, j + 1, depth);
      continue;
    }
    if (!raw && c === "\n") return j;
    if (raw && text.startsWith('"""', j)) {
      // A raw string may end in extra quotes, which belong to it: `""""a""""`.
      let end = j + 3;
      while (text[end] === '"') end++;
      return end;
    }
    if (!raw && c === '"') return j + 1;
    j++;
  }
  return text.length;
}

/** Index just past the `}` closing the template whose `{` is at `open`, skipping strings and characters inside it. */
function templateEnd(text: string, open: number, depth: number): number {
  let braces = 0;
  let j = open;
  while (j < text.length) {
    const c = text[j];
    if (c === '"') {
      j = stringEnd(text, j, depth + 1);
      continue;
    }
    if (c === "'") {
      j = charEnd(text, j) ?? j + 1;
      continue;
    }
    if (c === "{") braces++;
    else if (c === "}" && --braces === 0) return j + 1;
    j++;
  }
  return text.length;
}

/** Index just past a character literal (`'a'`, `'\n'`, `'A'`); a lone `'` is left as code. */
function charEnd(text: string, start: number): number | undefined {
  const close = text.indexOf("'", start + (text[start + 1] === "\\" ? 3 : 2));
  if (close === -1 || close - start > 8 || text.slice(start, close).includes("\n")) return undefined;
  return close + 1;
}
