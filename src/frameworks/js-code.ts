/** A script's code with its comments, strings and JSX text blanked, found by TypeScript's parser: text alone can't
 * tell JSX's `Don't` from the start of a string. */

import ts from "typescript";
import { eachNode } from "./js-sources.js";

const isText = (node: ts.Node) =>
  ts.isStringLiteral(node) ||
  ts.isNoSubstitutionTemplateLiteral(node) ||
  ts.isTemplateHead(node) ||
  ts.isTemplateMiddle(node) ||
  ts.isTemplateTail(node) ||
  ts.isRegularExpressionLiteral(node) ||
  ts.isJsxText(node);

/** `file`'s text with every comment, string, template's text and JSX text replaced by spaces; newlines and offsets
 * are kept. */
export function jsCodeOnly(file: ts.SourceFile): string {
  const text = file.text;
  const out = text.split("");
  const blank = (start: number, end: number) => {
    for (let k = start; k < end; k++) if (out[k] !== "\n") out[k] = " ";
  };
  // Nested nodes share where they start; each place is read for comments once.
  const read = new Set<number>();
  const comments = (pos: number) => {
    if (read.has(pos)) return;
    read.add(pos);
    ts.forEachLeadingCommentRange(text, pos, (start, end) => blank(start, end));
    ts.forEachTrailingCommentRange(text, pos, (start, end) => blank(start, end));
  };
  eachNode(file, (node) => {
    comments(node.getFullStart());
    comments(node.getEnd());
    if (isText(node)) blank(node.getStart(file), node.getEnd());
    return true;
  });
  return out.join("");
}
