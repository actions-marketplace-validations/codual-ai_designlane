/** `#if`, `#else` and `#endif` lines inside a modifier chain:
 *
 * ```swift
 * Text(a)
 * #if os(iOS)
 * .font(.title)
 * #endif
 * ```
 */

import { DIRECTIVES } from "./swift-operators.js";
import { type SwiftTokens, skipGroup } from "./swift-tokens.js";

/** How long a `#if …` line can be. */
const MAX_DIRECTIVE_TOKENS = 64;

/** What a directive line at a chain's next link means: none there; a line to step over, so the link under `#if` reads
 * as part of the chain; or `#else` before a link, so the chain holds two alternatives and can't be read as one. */
export type DirectiveStep = { kind: "none" } | { kind: "skip"; to: number } | { kind: "alternatives" };

const NONE: DirectiveStep = { kind: "none" };

/** The directive line starting at the token at `at`, if there is one, read no further than `limit`. */
export function directiveAt(file: SwiftTokens, at: number, limit: number): DirectiveStep {
  const [hash, word] = [file.tokens[at], file.tokens[at + 1]];
  if (hash?.text !== "#" || !hash.newlineBefore || !word || word.spaceBefore || !DIRECTIVES.has(word.text))
    return NONE;
  const next = lineEnd(file, at + 2, limit);
  const following = file.tokens[next]?.text;
  if (word.text === "else" || word.text === "elseif")
    return following === "." ? { kind: "alternatives" } : NONE;
  return following === "." || following === "#" ? { kind: "skip", to: next } : NONE;
}

/** The index of the first token on the line after the one holding the token at `from`. */
function lineEnd(file: SwiftTokens, from: number, limit: number): number {
  let i = from;
  const stop = Math.min(limit, from + MAX_DIRECTIVE_TOKENS);
  while (i < stop && !file.tokens[i]?.newlineBefore) i = skipGroup(file, i, limit);
  return i;
}
