/** A Compose app's font families: `val WorkSans = FontFamily(Font(R.font.work_sans_medium, …))` named after its
 * font files, Google fonts named in code, and other names for those families. */

import { assignedName, callArguments } from "./kotlin-calls.js";
import type { KotlinSource } from "./kotlin-sources.js";
import { SYSTEM } from "./material-type.js";

const STYLE_WORDS =
  /[_-](?:thin|extralight|ultralight|light|regular|normal|book|medium|semibold|demibold|bold|extrabold|heavy|black|italic|variable|vf)(?=[_-]|$)/gi;
/** Short words in family names are initials: `dm_sans` is DM Sans, `pt_serif` PT Serif. */
const INITIALS = /^(?:[a-z]{1,2}|ibm)$/;

/** `work_sans_medium` as `Work Sans`: the font file's name without its weight or style. */
export function familyFromFile(file: string): string {
  return file
    .replace(STYLE_WORDS, "")
    .split(/[_-]+/)
    .filter(Boolean)
    .map((w) => (INITIALS.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

/** Each font family the code names, by the name it's declared under. */
export function fontFamilies(sources: KotlinSource[]): Map<string, string> {
  const googleFonts = new Map<string, string>();
  for (const { text, code } of sources)
    for (const m of text.matchAll(/\bval\s+(\w+)\s*=\s*GoogleFont\s*\(\s*"([^"]+)"/g))
      if (code[m.index ?? 0] !== " " && m[1] && m[2]) googleFonts.set(m[1], m[2]);
  const families = new Map<string, string>();
  for (const source of sources) {
    for (const m of source.code.matchAll(/(?<![\w.])FontFamily\s*\(/g)) {
      const at = m.index ?? 0;
      const name = assignedName(source.code, at);
      if (!name) continue;
      const { close } = callArguments(source, at + m[0].length - 1);
      const body = source.code.slice(at, close);
      const file = body.match(/\b(?:R|Res)\.font\.(\w+)/)?.[1];
      // A Google font names its family in a string, which only the original text keeps, here or in a constant.
      const google =
        source.text.slice(at, close).match(/GoogleFont\s*\(\s*"([^"]+)"/)?.[1] ??
        googleFonts.get(body.match(/\bgoogleFont\s*=\s*(\w+)/)?.[1] ?? "");
      const family = google ?? (file ? familyFromFile(file) : undefined);
      if (family) families.set(name, family);
    }
  }
  // Another name for a family: `val fontFamily = DmSansFontFamily`.
  for (const { code } of sources)
    for (const m of code.matchAll(/\bval\s+(\w+)\s*=\s*(\w+)\s*$/gm)) {
      const family = families.get(m[2] ?? "");
      if (family && m[1] && !families.has(m[1])) families.set(m[1], family);
    }
  return families;
}

/** The family a `fontFamily = …` argument names, or `""` when it's one the project doesn't declare. */
export function familyOf(expression: string, families: Map<string, string>): string {
  if (/^FontFamily\.(?:Default|SansSerif)$/.test(expression)) return SYSTEM;
  const generic = expression.match(/^FontFamily\.(Serif|Monospace|Cursive)$/)?.[1];
  return generic ?? families.get(expression.split(".").at(-1) ?? "") ?? "";
}
