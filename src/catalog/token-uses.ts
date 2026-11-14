/** Which of the app's named colours and text styles a piece of code refers to, the way the code names them. */

import { keyedColors, keyedStyles } from "../output/token-names.js";
import { normalizeHex } from "../scan/tokens.js";
import type { ColorToken, DesignTokens, FrameworkId, TypeStyle } from "../scan/types.js";

/** A name the code reaches, with any leading `.` (an implicit member, `.ink`) and index (`gray[100]`). */
const PATH = /(?<![\w$])(\.)?([A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*|\[\d+\]){0,12})/g;
const SEGMENT = /\??\.(?=[A-Za-z_$])|(?=\[)/;
/** A call given one string, `Color("Brand")`, matched in the code as written. */
const STRING_CALL = /\b([A-Za-z_][\w.]{0,100})\(\s{0,20}"([^"\n]{1,200})"\s{0,20}\)/g;
/** A reference that's a call on a name, `colorResource(R.color.brand)`, by what it's called with. */
const NAMED_CALL = /^[\w.]+\(([\w.[\]]+)\)$/;
const HEX = /(#|0x)([0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?)\b/g;
/** Swift types whose members a value of their type can name without the type: `.ink` for `Color.ink`. */
const IMPLICIT_OWNER = /^(?:Color|UIColor|ShapeStyle|Font|UIFont)\.(\w+)$/;

interface Mentions {
  /** Every name the code reaches and each run of its parts (`theme.colors.primary`, `colors.primary`, `theme.colors`). */
  paths: Set<string>;
  /** Names written as implicit members, `.ink`, without the dot. */
  members: Set<string>;
  calls: Set<string>;
  hexes: Set<string>;
}

/** What `code` (comments and strings blanked) and `text` (as written, at the same offsets) mention, in one pass. */
function mentionsIn(text: string, code: string): Mentions {
  const found: Mentions = { paths: new Set(), members: new Set(), calls: new Set(), hexes: new Set() };
  for (const m of code.matchAll(PATH)) {
    const path = m[2] ?? "";
    if (m[1]) found.members.add(path.split(SEGMENT)[0] ?? "");
    // Every run of whole parts: a shorter end (`colors.primary` of `theme.colors.primary`) and a shorter start, before a
    // modifier (`Theme.brand` of `Theme.brand.opacity`). PATH caps the parts, so this stays small.
    const parts = path.split(SEGMENT);
    for (let start = 0; start < parts.length; start++)
      for (let end = start + 1; end <= parts.length; end++) found.paths.add(joined(parts.slice(start, end)));
  }
  for (const m of text.matchAll(STRING_CALL))
    if (code[m.index ?? 0] !== " ") found.calls.add(`${m[1]}("${m[2]}")`);
  for (const m of text.matchAll(HEX)) {
    const hex = colorOf(m[1] ?? "", m[2] ?? "");
    if (hex) found.hexes.add(hex);
  }
  return found;
}

const joined = (parts: string[]) =>
  parts.reduce((out, part) => (out && !part.startsWith("[") ? `${out}.${part}` : `${out}${part}`), "");

/** A hex literal as `#rrggbb[aa]`: eight digits after `0x` are alpha first, as Compose writes them. */
function colorOf(prefix: string, digits: string): string | undefined {
  if (prefix === "0x" && digits.length === 8) return normalizeHex(`${digits.slice(2)}${digits.slice(0, 2)}`);
  return normalizeHex(digits);
}

function mentionsReference(found: Mentions, reference: string, framework: FrameworkId): boolean {
  if (found.calls.has(reference.replace(/\(\s*"/, '("').replace(/"\s*\)/, '")'))) return true;
  const called = reference.match(NAMED_CALL)?.[1];
  if (called) return found.paths.has(called);
  if (found.paths.has(reference)) return true;
  const member = framework === "swiftui" ? reference.match(IMPLICIT_OWNER)?.[1] : undefined;
  return member !== undefined && found.members.has(member);
}

/** An asset colour named in Swift by the symbol Xcode makes for it: `AccentColor` is `.accentColor`. */
const assetSymbol = (name: string) => name.charAt(0).toLowerCase() + name.slice(1).replace(/[^\w]/g, "");

function mentionsColor(found: Mentions, color: ColorToken, framework: FrameworkId): boolean {
  if (!color.reference) return found.hexes.has(color.light);
  if (mentionsReference(found, color.reference, framework)) return true;
  if (framework !== "swiftui" || color.kind !== "asset") return false;
  const symbol = assetSymbol(color.name);
  return found.members.has(symbol) || found.paths.has(`Color.${symbol}`);
}

function mentionsStyle(found: Mentions, style: TypeStyle, framework: FrameworkId): boolean {
  if (style.reference) return mentionsReference(found, style.reference, framework);
  return framework === "swiftui" && style.kind === "text-style" && found.members.has(style.name);
}

export interface TokenUses {
  /** Colour keys, as tokens.json and DESIGN.md name them. */
  colors: string[];
  /** Text style keys. */
  typeStyles: string[];
}

/** Reads the tokens once, for checking many pieces of code against them. */
export function tokenUsesReader(
  tokens: DesignTokens,
  framework: FrameworkId,
  platform: Parameters<typeof keyedStyles>[1],
) {
  const colors = keyedColors(tokens.colors);
  const styles = keyedStyles(tokens.typeStyles, platform);
  return (text: string, code: string): TokenUses => {
    const found = mentionsIn(text, code);
    return {
      colors: colors.filter(({ color }) => mentionsColor(found, color, framework)).map(({ key }) => key),
      typeStyles: styles.filter(({ style }) => mentionsStyle(found, style, framework)).map(({ key }) => key),
    };
  };
}
