/** The text styles a React Native app names, found by the paths the code reaches them by, and counted. */

import ts from "typescript";
import { accessPath, eachNode, type JsSource } from "./js-sources.js";

/** Names a typography object is reached through: `theme.typography.title`, `fonts.body`, `textStyles.caption`. */
const TYPE_WORD = /^(?:typography|fonts?|text(?:Styles?)?)$|[a-z](?:Typography|Fonts?|TextStyles?)$/;

/** A font's values as a style sets them; `UNKNOWN` for one the code works out as it runs. */
export interface Font {
  family?: string | typeof UNKNOWN;
  size?: number | typeof UNKNOWN;
  weight?: string | typeof UNKNOWN;
}
export const UNKNOWN = Symbol("unknown");

/** A text style the app names, and the object that defines it. */
export interface Named {
  path: string[];
  source: JsSource;
  object: ts.ObjectLiteralExpression;
  font: Font;
  uses: number;
}

/**
 * The named styles by every end of their paths, for finding the one a chain reaches: the longest end the chain
 * finishes with that only one style has, preferring a style in the chain's own file (`largeTypography.title` is the
 * large title, not the first `title`). A spread may name a style by its name alone (`...platform.EXP_NEUE`).
 */
export class StyleIndex {
  private readonly byEnd = new Map<string, Named | null>();
  private readonly ownByEnd = new Map<string, Named>();
  readonly holders: Set<string>;
  readonly names: Set<string>;

  constructor(named: Named[]) {
    for (const style of named) {
      for (let i = 0; i < style.path.length; i++) {
        const key = style.path.slice(i).join("\0");
        const before = this.byEnd.get(key);
        this.byEnd.set(key, before === undefined || before === style ? style : null);
        const own = `${style.source.rel}\0${key}`;
        if (!this.ownByEnd.has(own)) this.ownByEnd.set(own, style);
      }
    }
    this.holders = new Set(named.flatMap((s) => s.path.slice(0, -1).map((p) => p.toLowerCase())));
    this.names = new Set(named.map((s) => s.path[s.path.length - 1] ?? ""));
  }

  find(parts: string[], from: JsSource, byName = false): Named | undefined {
    for (let i = 0; i < parts.length - (byName ? 0 : 1); i++) {
      const key = parts.slice(i).join("\0");
      const found = this.ownByEnd.get(`${from.rel}\0${key}`) ?? this.byEnd.get(key);
      if (found) return found;
    }
    return undefined;
  }
}

/** Counts the places reaching each named style: `theme.typography.title`, `...fonts.body`, and the start of a longer
 * chain (`typography.title.fontSize`); not a spread under a style's own values, a style of its own (`skip`). */
export function countUses(sources: JsSource[], index: StyleIndex, skip: Set<ts.Node>): void {
  for (const source of sources) {
    eachNode(source.file, (node) => {
      if (skip.has(node)) return false;
      if (!(ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))) return true;
      if (
        (ts.isPropertyAccessExpression(node.parent) || ts.isElementAccessExpression(node.parent)) &&
        node.parent.expression === node
      )
        return true;
      const parts = accessPath(node);
      if (!parts) return true;
      // The longest start of the chain ending at a named style's name.
      for (let end = parts.length; end >= 2; end--) {
        if (!index.names.has(parts[end - 1] ?? "")) continue;
        const through = parts.slice(0, end - 1);
        if (!through.some((p) => TYPE_WORD.test(p) || index.holders.has(p.toLowerCase()))) continue;
        const style = index.find(parts.slice(0, end), source);
        if (style) {
          style.uses++;
          break;
        }
      }
      return false;
    });
  }
}
