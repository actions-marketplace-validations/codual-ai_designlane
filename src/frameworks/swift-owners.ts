/** The type a Swift declaration belongs to, read from the brackets around it. */

import type { SwiftTokens } from "./swift-tokens.js";

const TYPE_KEYWORDS = new Set(["class", "struct", "extension", "enum", "actor"]);
/** Words after `class` that make it a member (`class func make()`), not a type. */
const MEMBER_WORDS = new Set([
  "func",
  "var",
  "let",
  "static",
  "override",
  "final",
  "private",
  "public",
  "internal",
  "fileprivate",
  "open",
  "subscript",
]);
/** How many brackets out from a declaration its type is looked for; real types nest a few deep. */
const MAX_OWNER_DEPTH = 16;
/** How far back from a `{` a type's declaration (`extension Font where … {`) can start. */
const MAX_HEADER_TOKENS = 64;

/** The type the token at `index` is declared in: the nearest enclosing `extension Font {`, `enum Theme {`, …, or
 * empty. */
export function ownerAt(file: SwiftTokens, index: number): string {
  let open = file.enclosing[index] ?? -1;
  for (let depth = 0; open !== -1 && depth < MAX_OWNER_DEPTH; depth++, open = file.enclosing[open] ?? -1) {
    const name = file.tokens[open]?.text === "{" ? typeNameOf(file, open) : undefined;
    if (name) return name;
  }
  return "";
}

/** The type whose body the `{` at `brace` opens, if it's a type's: `final class Card: UIView {`, `extension Card {`. */
function typeNameOf(file: SwiftTokens, brace: number): string | undefined {
  for (let k = brace - 1; k >= 0 && k >= brace - MAX_HEADER_TOKENS; k--) {
    const token = file.tokens[k];
    if (!token || token.text === "{" || token.text === "}") return undefined;
    const next = file.tokens[k + 1];
    if (!TYPE_KEYWORDS.has(token.text) || next?.kind !== "name" || MEMBER_WORDS.has(next.text)) continue;
    // `extension SwiftUI.Banner`: the type is the last part of its name.
    let name = k + 1;
    while (file.tokens[name + 1]?.text === "." && file.tokens[name + 2]?.kind === "name") name += 2;
    return file.tokens[name]?.text;
  }
  return undefined;
}
