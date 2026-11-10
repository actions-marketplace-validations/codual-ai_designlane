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
/** Apple's UI modules, written before a type only to qualify it: `extension SwiftUI.Color`. */
const APPLE_MODULES = new Set(["SwiftUI", "UIKit", "AppKit", "Foundation"]);
/** How many brackets out from a declaration its type is looked for; real types nest a few deep. */
const MAX_OWNER_DEPTH = 16;
/** How far back from a `{` a type's declaration (`extension Font where … {`) can start. */
const MAX_HEADER_TOKENS = 64;

/** The type the token at `index` is declared in: the nearest enclosing `extension Font {`, `enum Theme {`, …, or
 * empty. */
export function ownerAt(file: SwiftTokens, index: number): string {
  return typesAround(file, index)[0]?.at(-1) ?? "";
}

/** The full name of the type the token at `index` is declared in, as code outside it writes it: `Theme.Dark` for
 * `enum Theme { enum Dark { … } }` or `extension Theme.Dark { … }`. */
export function qualifiedOwnerAt(file: SwiftTokens, index: number): string {
  const path: string[] = [];
  for (const name of typesAround(file, index)) path.unshift(...name);
  return path.join(".");
}

/** How code outside a type refers to its member: `Theme.surface`, or just `surface` at the top level. */
export const memberOf = (owner: string, member: string) => (owner ? `${owner}.${member}` : member);

/** The names of the types around the token at `index`, innermost first, each as the parts of its dotted name. */
function typesAround(file: SwiftTokens, index: number): string[][] {
  const names: string[][] = [];
  let open = file.enclosing[index] ?? -1;
  for (let depth = 0; open !== -1 && depth < MAX_OWNER_DEPTH; depth++, open = file.enclosing[open] ?? -1) {
    const name = file.tokens[open]?.text === "{" ? typeNameOf(file, open) : undefined;
    if (name) names.push(name);
  }
  return names;
}

/** The type whose body the `{` at `brace` opens, if it's a type's, as the parts of its name: `["Card"]` for
 * `final class Card: UIView {`, `["Theme", "Dark"]` for `extension Theme.Dark {`. */
function typeNameOf(file: SwiftTokens, brace: number): string[] | undefined {
  for (let k = brace - 1; k >= 0 && k >= brace - MAX_HEADER_TOKENS; k--) {
    const token = file.tokens[k];
    if (!token || token.text === "{" || token.text === "}") return undefined;
    const next = file.tokens[k + 1];
    if (!TYPE_KEYWORDS.has(token.text) || next?.kind !== "name" || MEMBER_WORDS.has(next.text)) continue;
    const parts = dottedName(file, k + 1);
    // `extension SwiftUI.Font`: the module isn't part of how the app's code writes the type.
    return APPLE_MODULES.has(parts[0] ?? "") ? parts.slice(1) : parts;
  }
  return undefined;
}

/** A dotted type name read from token `at`: `Theme.Dark` → ["Theme", "Dark"]. */
function dottedName(file: SwiftTokens, at: number): string[] {
  const parts: string[] = [];
  for (let token = file.tokens[at]; token?.kind === "name"; token = file.tokens[at]) {
    parts.push(token.text);
    if (file.tokens[at + 1]?.text !== ".") break;
    at += 2;
  }
  return parts;
}
