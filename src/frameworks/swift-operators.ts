/** Swift's operator grammar as the expression reader needs it: precedence, and the keywords around expressions. */

import type { Token } from "./swift-tokens.js";

/** Swift's operator precedence, low to high; a ternary is `TERNARY`, a cast `CASTING`. */
const LEVELS: [number, string[]][] = [
  [2, ["||"]],
  [3, ["&&"]],
  [4, ["==", "!=", "===", "!==", "<", ">", "<=", ">=", "~="]],
  [5, ["??"]],
  [7, ["...", "..<"]],
  [8, ["+", "-", "|", "^", "&+", "&-"]],
  [9, ["*", "/", "%", "&", "&*"]],
  [10, ["<<", ">>", "&<<", "&>>"]],
];
const PRECEDENCE: Record<string, number> = Object.fromEntries(
  LEVELS.flatMap(([level, operators]) => operators.map((operator) => [operator, level])),
);
export const TERNARY = 1;
export const CASTING = 6;
/** The precedence of one of Swift's own operators; a custom operator's is declared elsewhere, so it's unknown. */
export const precedenceOf = (operator: string): number | undefined => PRECEDENCE[operator];

/** `=`, `+=` and the like: an assignment ends the expression. */
export const isAssignment = (operator: string) => /^(?:[-+*/%&|^]|<<|>>|&[-+*])?=$/.test(operator);

/** `try` and `await`: they mark an expression's effects, not part of its value. */
export const EFFECT_KEYWORDS = new Set(["try", "await"]);
/** `some View`, `any View`: words before a type that aren't part of its name. */
export const TYPE_QUALIFIERS = new Set(["some", "any"]);
/** A property's observers, `{ didSet { … } }`: a `{` starting with one ends the expression instead of passing a closure. */
export const PROPERTY_OBSERVERS = new Set(["didSet", "willSet"]);
/** Compiler directives, `#if os(iOS)`, which can sit between the links of a modifier chain. */
export const DIRECTIVES = new Set(["if", "elseif", "else", "endif"]);
/** Keywords that start a statement, never an expression's next token. */
export const STATEMENT_KEYWORDS = new Set([
  "let",
  "var",
  "func",
  "return",
  "case",
  "default",
  "else",
  "static",
  "init",
  "deinit",
  "subscript",
  "for",
  "while",
  "guard",
  "do",
  "repeat",
  "defer",
  "throw",
]);
/** `get { … }` and the like open an accessor's body, not a call's trailing closure; elsewhere they're ordinary names. */
export const ACCESSORS = new Set(["get", "set", ...PROPERTY_OBSERVERS]);

/** `?` or `!` written right after what it applies to: `x!`, `try?`, `as!`, `UIFont?`. */
export const isAttachedMark = (token: Token | undefined) =>
  (token?.text === "?" || token?.text === "!") && !token.spaceBefore;
