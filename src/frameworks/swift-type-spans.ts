/** Where a Swift type written inside an expression ends: generic arguments (`Array<Color>`) and the type after
 * `as`/`is` (`as? [Color]`). The reader keeps types whole rather than modelling them. */

import { isAttachedMark, TYPE_QUALIFIERS } from "./swift-operators.js";
import type { SwiftTokens, Token } from "./swift-tokens.js";

/** A type longer than this isn't one: the read stops there, so a hostile line can't be scanned again and again. */
const MAX_TYPE_TOKENS = 64;
/** Words between a function type's parameters and its arrow: `(Int) async throws -> Void`. */
const EFFECTS = new Set(["async", "throws", "rethrows"]);
/** Generic arguments longer than this aren't generics; `<` is then a comparison. */
const MAX_GENERIC_TOKENS = 40;
/** What may sit inside generic arguments: `<Set<Int>, any View & Sendable>`. */
const GENERIC_PUNCTUATION = new Set([".", ",", ":", "[", "]", "(", ")", "&"]);
/** What may follow generic arguments, so `a<b>c` stays a comparison. */
const AFTER_GENERICS = new Set(["(", ".", ")", "]", ",", "}", "{", "?", "!"]);

/** For every token, the index just past the generic arguments its `<` opens, or -1: worked out once per file so a
 * reader asking at every `<` stays linear. */
export function genericEnds(tokens: Token[]): Int32Array {
  const ends = new Int32Array(tokens.length).fill(-1);
  tokens.forEach((token, at) => {
    if (token.text.startsWith("<") && !token.spaceBefore) ends[at] = scanGenerics(tokens, at);
  });
  return ends;
}

/** The index just past the generic arguments starting at the `<` at `at`, when they are generics and end before
 * `limit`. */
export function genericEnd(file: SwiftTokens, at: number, limit: number): number | undefined {
  const end = file.generics[at] ?? -1;
  return end !== -1 && end <= limit ? end : undefined;
}

function scanGenerics(tokens: Token[], at: number): number {
  let depth = 0;
  const stop = Math.min(tokens.length, at + MAX_GENERIC_TOKENS);
  for (let i = at; i < stop; i++) {
    const token = tokens[i];
    if (!token) return -1;
    // A function type inside generics, `Array<(Int) -> Void>`, has an arrow.
    if (token.text === "->") continue;
    if (token.kind === "operator") {
      if (!/^[<>?!]+$/.test(token.text)) return -1;
      for (const c of token.text) depth += c === "<" ? 1 : c === ">" ? -1 : 0;
      if (depth < 0) return -1;
      if (depth === 0) {
        const next = tokens[i + 1];
        return !next || next.newlineBefore || AFTER_GENERICS.has(next.text) ? i + 1 : -1;
      }
    } else if (token.kind !== "name" && !GENERIC_PUNCTUATION.has(token.text)) return -1;
  }
  return -1;
}

/** The index just past the type starting at `at`, on the same line: `UIFont`, `[Color]`, `Binding<Color>?`,
 * `some View`, `(Int) throws -> Color`. A name only continues through `.`, so `as? UIFont else {` ends before
 * `else`. */
export function typeEnd(file: SwiftTokens, at: number, limit: number): number {
  const { tokens, match } = file;
  let i = at;
  let expectingName = true;
  const stop = Math.min(limit, at + MAX_TYPE_TOKENS);
  while (i < stop) {
    const token = tokens[i];
    if (!token || (i > at && token.newlineBefore)) break;
    if (expectingName && TYPE_QUALIFIERS.has(token.text)) {
      i++;
      continue;
    }
    if (expectingName && token.kind === "name") i++;
    else if (expectingName && (token.text === "[" || token.text === "(")) {
      const close = match[i] ?? -1;
      if (close === -1 || close >= limit) break;
      i = close + 1;
      let arrow = i;
      while (arrow < stop && EFFECTS.has(tokens[arrow]?.text ?? "")) arrow++;
      if (tokens[arrow]?.text === "->" && arrow < stop) {
        i = arrow + 1;
        continue;
      }
    } else if (!expectingName && token.text === ".") {
      i++;
      expectingName = true;
      continue;
    } else if (!expectingName && token.text.startsWith("<")) {
      const end = genericEnd(file, i, limit);
      if (end === undefined) break;
      i = end;
    } else if (!expectingName && isAttachedMark(token)) i++;
    else break;
    expectingName = false;
  }
  return i;
}
