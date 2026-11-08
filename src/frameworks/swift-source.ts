/**
 * Just enough Swift reading to find views reliably: comments, strings and `#Preview` blocks are blanked
 * out (keeping every newline, so line numbers still match), and struct bodies are found by matching braces.
 */

/** The text with comments and string literals replaced by spaces, so only code is left; newlines and offsets are
 * kept, so positions still match the original file. */
export function codeOnly(text: string): string {
  const out = text.split("");
  let i = 0;
  while (i < text.length) {
    const end = commentOrStringEnd(text, i);
    if (end === undefined) {
      i++;
      continue;
    }
    for (let k = i; k < end; k++) if (out[k] !== "\n") out[k] = " ";
    i = end;
  }
  return out.join("");
}

/** Where the comment or string starting at `i` ends, or undefined when none starts there. */
function commentOrStringEnd(text: string, i: number): number | undefined {
  if (text.startsWith("//", i)) return lineCommentEnd(text, i);
  if (text.startsWith("/*", i)) return blockCommentEnd(text, i);
  if (text[i] === '"' || /^#+"/.test(text.slice(i, i + 8))) return stringEnd(text, i);
  return undefined;
}

function lineCommentEnd(text: string, start: number): number {
  const newline = text.indexOf("\n", start);
  return newline === -1 ? text.length : newline;
}

/** Swift block comments nest, so an inner comment's close doesn't end the outer one. */
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

/** Index just past the string literal starting at `start` (plain, multi-line or raw `#"…"#`). */
function stringEnd(text: string, start: number): number {
  let hashes = 0;
  while (text[start + hashes] === "#") hashes++;
  const open = start + hashes;
  const multi = text.startsWith('"""', open);
  const quote = multi ? '"""' : '"';
  const closing = quote + "#".repeat(hashes);
  let j = open + quote.length;
  while (j < text.length) {
    if (hashes === 0 && text[j] === "\\") {
      j += 2;
      continue;
    }
    if (!multi && text[j] === "\n") return j;
    if (text.startsWith(closing, j)) return j + closing.length;
    j++;
  }
  return text.length;
}

/** Blanks every `#Preview { … }` block, so views declared inside previews are ignored. */
export function withoutPreviews(code: string): string {
  const { nextOpen, closeOf } = braceIndex(code);
  const out = code.split("");
  let covered = -1;
  for (const m of code.matchAll(/#Preview\b/g)) {
    const at = m.index ?? 0;
    const open = nextOpen[at] ?? -1;
    if (at <= covered || open === -1) continue;
    const close = closeOf.get(open) ?? code.length - 1;
    for (let k = at; k <= close; k++) if (out[k] !== "\n") out[k] = " ";
    covered = close;
  }
  return out.join("");
}

export interface StructDecl {
  name: string;
  /** Offset of the `struct` keyword. */
  start: number;
  /** Offsets of the body's braces. */
  open: number;
  close: number;
  conformances: string[];
  /** Generic over a view type (`struct Card<Content: View>`), so it holds other views. */
  holdsViews: boolean;
}

const STRUCT = /\bstruct\s+([A-Za-z_]\w*)/g;

/** Every struct declaration in code source, with its conformances and body. Linear in the file size. */
export function structs(code: string): StructDecl[] {
  const { nextOpen, closeOf } = braceIndex(code);
  const out: StructDecl[] = [];
  for (const m of code.matchAll(STRUCT)) {
    let j = (m.index ?? 0) + m[0].length;
    const genericsStart = j;
    if (code[j] === "<") j = skipGenerics(code, j);
    const generics = code.slice(genericsStart, j);
    const open = nextOpen[j] ?? -1;
    if (open === -1 || open - j > MAX_HEADER) continue;
    const header = code.slice(j, open);
    const colon = header.indexOf(":");
    const list = colon === -1 ? "" : (header.slice(colon + 1).split(/\bwhere\b/)[0] ?? "");
    out.push({
      name: m[1] ?? "",
      start: m.index ?? 0,
      open,
      close: closeOf.get(open) ?? code.length - 1,
      holdsViews: /:\s*View\b/.test(generics),
      conformances: list
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    });
  }
  return out;
}

/** A declaration header longer than this isn't a real one; stops pathological input from scanning far. */
const MAX_HEADER = 2000;

function braceIndex(code: string) {
  const nextOpen = new Int32Array(code.length + 1).fill(-1);
  for (let j = code.length - 1; j >= 0; j--) nextOpen[j] = code[j] === "{" ? j : (nextOpen[j + 1] ?? -1);
  const closeOf = new Map<number, number>();
  const stack: number[] = [];
  for (let j = 0; j < code.length; j++) {
    if (code[j] === "{") stack.push(j);
    else if (code[j] === "}") {
      const open = stack.pop();
      if (open !== undefined) closeOf.set(open, j);
    }
  }
  return { nextOpen, closeOf };
}

function skipGenerics(text: string, start: number): number {
  let depth = 0;
  for (let j = start; j < text.length && j - start < MAX_HEADER; j++) {
    if (text[j] === "<") depth++;
    else if (text[j] === ">" && --depth === 0) return j + 1;
    else if (text[j] === "{") return j;
  }
  return text.length;
}

/** 1-based line numbers of ascending offsets, in one pass over the text. */
export function lineNumbers(text: string, offsets: number[]): number[] {
  let line = 1;
  let at = 0;
  return offsets.map((offset) => {
    for (; at < offset; at++) if (text[at] === "\n") line++;
    return line;
  });
}
