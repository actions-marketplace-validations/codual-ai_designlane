/** A position in a file's tokens, bounded by a limit, with the steps every reader of them needs, opaque spans
 * included. */

import type { Expression } from "./swift-expression-types.js";
import { type SwiftTokens, skipGroup, type Token } from "./swift-tokens.js";

/** Moves one read may make before what it's reading is called opaque: far more than a real expression needs (a long
 * SwiftUI modifier chain takes about 150), and what keeps a read linear however the input is shaped. Every move costs
 * one, a jump over a bracketed group included. */
const MAX_MOVES = 512;

/** Shared by a read and the readers it starts for arguments, so their moves and nesting add up. */
export interface ReadState {
  movesLeft: number;
  /** How deeply nested the read is now, across the readers it starts. */
  depth: number;
  /** Set when the read meets something it won't guess at, such as `#else` inside a chain: the result is opaque. */
  unreadable: boolean;
}

export const newReadState = (): ReadState => ({ movesLeft: MAX_MOVES, depth: 0, unreadable: false });

export class TokenCursor {
  #at: number;

  constructor(
    protected readonly file: SwiftTokens,
    at: number,
    /** The cursor never reads this token or past it. */
    protected readonly limit: number,
    protected readonly read: ReadState = newReadState(),
  ) {
    this.#at = at;
  }

  protected get at(): number {
    return this.#at;
  }

  /** Moves forward `count` tokens, charging one move to the read. */
  protected advance(count = 1): void {
    this.moveTo(this.#at + count);
  }

  /** Moves to the token at `index`, forward or back, charging one move to the read. */
  protected moveTo(index: number): void {
    this.read.movesLeft--;
    this.#at = index;
  }

  /** Whether the read has stopped: out of moves, or unreadable. Once stopped, nothing more is read. */
  protected get stopped(): boolean {
    return this.read.movesLeft <= 0 || this.read.unreadable;
  }

  protected skipToComma(): void {
    while (this.peek() && this.peek()?.text !== ",") this.skipOne();
  }

  protected skipOne(): void {
    this.moveTo(skipGroup(this.file, this.at, this.limit));
  }

  /** Whether a space follows the token at `index`: Swift tells `a - b` and `a-b` from `-b` by spacing. */
  protected spaceAfter(index: number): boolean {
    return this.file.tokens[index + 1]?.spaceBefore ?? true;
  }

  protected peek(): Token | undefined {
    return this.peekAt(0);
  }

  protected peekAt(ahead: number): Token | undefined {
    return !this.stopped && this.at + ahead < this.limit ? this.file.tokens[this.at + ahead] : undefined;
  }

  protected take(): Token {
    const token = this.file.tokens[this.at] as Token;
    this.advance();
    return token;
  }

  protected previousEnd(): number {
    return this.file.tokens[this.at - 1]?.end ?? 0;
  }

  /** The token or bracketed group starting at `at`, kept whole. */
  protected opaqueFrom(at: number): Expression {
    this.moveTo(at);
    this.skipOne();
    return this.opaqueBetweenTokens(at, this.at);
  }

  /** The tokens from `from` up to `to` as one opaque span; empty, where `from` would start, when there are none. */
  protected opaqueBetweenTokens(from: number, to: number): Expression {
    const start = to > from ? (this.file.tokens[from]?.start ?? 0) : this.previousEnd();
    const end = to > from ? (this.file.tokens[to - 1]?.end ?? start) : start;
    return { kind: "opaque", start, end };
  }

  /** Everything read since `start` as one opaque span. */
  protected opaqueSince(start: number): Expression {
    return { kind: "opaque", start, end: this.previousEnd() };
  }

  /** `if … { … } else { … }` and `switch … { … }` used as values, kept whole. */
  protected branching(at: number): Expression {
    for (;;) {
      while (this.peek() && this.peek()?.text !== "{") this.skipOne();
      if (!this.peek()) break;
      this.skipOne();
      if (this.peek()?.text !== "else") break;
      this.advance();
    }
    return this.opaqueBetweenTokens(at, this.at);
  }
}
