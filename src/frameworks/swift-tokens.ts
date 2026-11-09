/**
 * Splits Swift source into tokens (names, numbers, strings, operators and punctuation), skipping comments and
 * `#Preview` blocks, and pairs every bracket with its close. Linear in the file's length.
 */

import { codeOnly, commentOrStringEnd, previewRanges } from "./swift-source.js";
import { genericEnds } from "./swift-type-spans.js";

export type TokenKind = "name" | "number" | "string" | "operator" | "punctuation";

export interface Token {
  kind: TokenKind;
  /** The token as written; a string keeps its quotes. */
  text: string;
  start: number;
  end: number;
  /** Whether a line break comes between this token and the one before. */
  newlineBefore: boolean;
  /** Whether a space or line break comes just before it: `a ? b : c` against optional chaining, `a?.b`. */
  spaceBefore: boolean;
}

export interface SwiftTokens {
  text: string;
  tokens: Token[];
  /** For each bracket token, the index of its matching close or open; -1 when it has none or isn't a bracket. */
  match: Int32Array;
  /** For each token, the index of the `(`, `[` or `{` it sits directly inside, or -1. */
  enclosing: Int32Array;
  /** For each `<`, the index just past the generic arguments it opens, or -1 (see `genericEnds`). */
  generics: Int32Array;
}

const NAME = /[\p{L}_$][\p{L}\p{N}_]*|`[^`\n]+`/uy;
const NUMBER =
  /0x[\da-fA-F_]+(?:(?:\.[\da-fA-F_]+)?[pP][+-]?\d+)?|0[ob][\d_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?/y;
/** Operator characters, stopping before a comment: `a+// note` is `+` and a comment. */
const OPERATOR = /(?:[=\-+!*%<>&|^~?]|\/(?![/*]))+|\.{2,}<?/y;
const OPERATOR_START = /[/=\-+!*%<>&|^~?]/;
const OPENS: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
export const CLOSES = new Set(Object.values(OPENS));
/** How many unclosed brackets a close may look past for its own kind; real code skips one or two at most. */
const MAX_SKIPPED = 32;

/** The tokens of a Swift file, with brackets paired. */
export function swiftTokens(text: string): SwiftTokens {
  const tokens = tokenize(text);
  const { match, enclosing } = pairBrackets(tokens);
  return { text, tokens, match, enclosing, generics: genericEnds(tokens) };
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const previews = previewRanges(codeOnly(text));
  let preview = 0;
  let newlineBefore = false;
  let spaceBefore = true;
  // A comment or preview separates tokens as a space would, or as a line break when it spans one.
  const gap = (from: number, to: number) => {
    spaceBefore = true;
    if (text.slice(from, to).includes("\n")) newlineBefore = true;
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i] ?? "";
    if (/\s/.test(c)) {
      gap(i, i + 1);
      i++;
      continue;
    }
    while ((previews[preview]?.[1] ?? Number.POSITIVE_INFINITY) <= i) preview++;
    const [previewStart = Number.POSITIVE_INFINITY, previewEnd = i + 1] = previews[preview] ?? [];
    if (previewStart <= i) {
      gap(i, previewEnd);
      i = previewEnd;
      continue;
    }
    const literal = commentOrStringEnd(text, i);
    if (literal !== undefined && c === "/") {
      gap(i, literal);
      i = literal;
      continue;
    }
    const kind: TokenKind = literal === undefined ? kindAt(text, i) : "string";
    // A number right after a `.` is a tuple index, `t.0.1`, so it has no fraction.
    const tupleIndex = kind === "number" && !spaceBefore && tokens.at(-1)?.text === ".";
    const end = literal ?? (tupleIndex ? integerEnd(text, i) : tokenEnd(text, i, kind));
    tokens.push({ kind, text: text.slice(i, end), start: i, end, newlineBefore, spaceBefore });
    newlineBefore = spaceBefore = false;
    i = end;
  }
  return tokens;
}

function kindAt(text: string, i: number): TokenKind {
  const c = text[i] ?? "";
  if (/\d/.test(c)) return "number";
  if (/[\p{L}_$`]/u.test(c)) return "name";
  if (OPERATOR_START.test(c) || text.startsWith("..", i)) return "operator";
  return "punctuation";
}

function integerEnd(text: string, i: number): number {
  let end = i;
  while (/\d/.test(text[end] ?? "")) end++;
  return end;
}

function tokenEnd(text: string, i: number, kind: TokenKind): number {
  const pattern = { name: NAME, number: NUMBER, operator: OPERATOR }[kind as "name" | "number" | "operator"];
  if (!pattern) return i + 1;
  pattern.lastIndex = i;
  return pattern.test(text) ? pattern.lastIndex : i + 1;
}

/** Pairs each close with the nearest open of its own kind, so an unbalanced `(` can't swallow a `}`. */
function pairBrackets(tokens: Token[]): { match: Int32Array; enclosing: Int32Array } {
  const match = new Int32Array(tokens.length).fill(-1);
  const enclosing = new Int32Array(tokens.length).fill(-1);
  const stack: number[] = [];
  tokens.forEach((token, index) => {
    enclosing[index] = stack.at(-1) ?? -1;
    if (token.kind !== "punctuation") return;
    if (OPENS[token.text]) stack.push(index);
    else if (CLOSES.has(token.text)) {
      for (let k = stack.length - 1; k >= 0 && k >= stack.length - 1 - MAX_SKIPPED; k--) {
        const open = stack[k] ?? -1;
        if (OPENS[tokens[open]?.text ?? ""] !== token.text) continue;
        match[open] = index;
        match[index] = open;
        stack.length = k;
        break;
      }
    }
  });
  return { match, enclosing };
}

/** The index of a bracket's matching close, or the end of the file when it has none. */
export function closeOf(file: SwiftTokens, open: number): number {
  const close = file.match[open] ?? -1;
  return close === -1 ? file.tokens.length : close;
}

/** The index after the token at `at`, or after its whole bracketed group, never past `limit`. */
export function skipGroup(file: SwiftTokens, at: number, limit: number): number {
  const close = file.match[at] ?? -1;
  return close > at ? Math.min(close + 1, limit) : at + 1;
}

/** A string literal's text without its quotes, escapes left as written, and whether it interpolates (`"\(base)-Bold"`). */
export function stringValue(literal: string): { value: string; interpolated: boolean } {
  const hashes = /^#*/.exec(literal)?.[0] ?? "";
  const body = literal.replace(/^#*"(?:"")?/, "").replace(/(?:"")?"#*$/, "");
  // A raw string `#"…"#` interpolates with `\#(`, so `\(` in it is text. In a plain one, `\\(x)` is an escaped
  // backslash and then `(x)`, so the backslashes before `(` are counted.
  const interpolation = hashes ? new RegExp(String.raw`\\${hashes}\(`) : /(?:^|[^\\])(?:\\\\)*\\\(/;
  return { value: body, interpolated: interpolation.test(body) };
}

/** The index of the first token starting at or after `offset`, by binary search. */
export function tokenIndexAt(file: SwiftTokens, offset: number): number {
  let low = 0;
  let high = file.tokens.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((file.tokens[mid]?.start ?? 0) < offset) low = mid + 1;
    else high = mid;
  }
  return low;
}
