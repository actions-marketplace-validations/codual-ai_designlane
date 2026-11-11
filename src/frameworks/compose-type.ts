/**
 * A Compose app's type scale: the roles its Material `Typography` sets (`bodyLarge = TextStyle(…)`), Material's
 * defaults for roles the code reads without setting, the app's own named styles (`val Heading = TextStyle(…)`), and
 * styles written inline.
 */

import type { TypeFindings, TypeUse } from "../scan/type-scale.js";
import type { TypeStyle } from "../scan/types.js";
import { familyOf, fontFamilies } from "./compose-fonts.js";
import { assignedName, callArguments, declaredIn, isDeclared, prefixesOf, Spans } from "./kotlin-calls.js";
import type { KotlinSource } from "./kotlin-sources.js";
import { MATERIAL_DEFAULTS, SYSTEM, sizeOf, weightOf } from "./material-type.js";

interface Style {
  family?: string;
  size?: number;
  weight?: string;
}

/** The shared type scale's findings, plus the styles the app names: Material roles and its own. */
export interface ComposeType extends TypeFindings {
  named: TypeStyle[];
}

export function composeType(sources: KotlinSource[]): ComposeType {
  const families = fontFamilies(sources);
  const bases = namedStyles(sources, families);
  const typography = typographyRoles(sources, families, bases);
  const roles = usedRoles(sources, typography);
  const uses = inlineStyles(sources, families, bases, typography.spans);
  const helperFonts: TypeUse[] = [...new Set(families.values())].map((family) => ({
    kind: "custom",
    family,
    weight: "regular",
  }));
  return { named: [...roles, ...countUses(sources, appStyles(bases))], uses, helperFonts };
}

/** How much of a call's start is read to tell what it is. */
const MAX_CALL_HEAD = 200;

/** The styles the code has read so far by name, for a `.copy(…)` of one to start from. */
type Bases = Map<string, Style>;

/** What a `TextStyle(…)`, or a `.copy(…)` of another style, sets. A copy starts from what it copies: a Material role
 * (`baseline.titleLarge`) from its default, a style the app names from that style. */
function styleAt(
  source: KotlinSource,
  at: number,
  families: Map<string, string>,
  bases: Bases,
): Style | undefined {
  const call = source.code.slice(at, at + MAX_CALL_HEAD).match(/^(?:TextStyle|([\w.]+)\.copy)\s*\(/);
  if (!call) return undefined;
  const copied = call[1] ?? "";
  const base = copied ? (MATERIAL_DEFAULTS[copied.split(".").at(-1) ?? ""] ?? bases.get(copied)) : undefined;
  const { args } = callArguments(source, at + call[0].length - 1);
  const arg = (name: string) => args.find((a) => a.name === name)?.value;
  const [family, size, weight] = [arg("fontFamily"), arg("fontSize"), arg("fontWeight")];
  const points = size ? sizeOf(size) : undefined;
  return {
    ...base,
    ...(family && { family: familyOf(family, families) }),
    ...(points !== undefined && { size: points }),
    ...(weight && { weight: weightOf(weight) }),
  };
}

interface Typography {
  roles: Map<string, TypeStyle>;
  /** `Typography(defaultFontFamily = …)`, which every role it doesn't set takes. */
  defaultFamily?: string;
  /** Where each `Typography(…)` is written, so its styles aren't counted again as written inline. */
  spans: Map<KotlinSource, Spans>;
}

const roleStyle = (role: string, style: Style, family: string): TypeStyle => ({
  name: role,
  kind: "text-style",
  family: style.family ?? family,
  ...(style.size !== undefined && { size: style.size }),
  weight: style.weight ?? "regular",
  reference: `MaterialTheme.typography.${role}`,
  uses: 0,
});

/** The roles each Material `Typography(…)` sets. */
/** Every `val Name = TextStyle(…)` the app declares, by how the code refers to it. */
function namedStyles(sources: KotlinSource[], families: Map<string, string>): Bases {
  const bases: Bases = new Map();
  for (const source of sources) {
    for (const m of source.code.matchAll(/(?<![\w.])TextStyle\s*\(/g)) {
      const at = m.index ?? 0;
      const name = assignedName(source.code, at);
      const owner = name ? declaredIn(source, at) : undefined;
      const style = owner !== undefined ? styleAt(source, at, families, bases) : undefined;
      if (name && style) bases.set(owner ? `${owner}.${name}` : name, style);
    }
  }
  return bases;
}

function typographyRoles(sources: KotlinSource[], families: Map<string, string>, bases: Bases): Typography {
  const found: Typography = { roles: new Map(), spans: new Map() };
  for (const source of sources) {
    for (const m of source.code.matchAll(/(?<![\w.])Typography\s*\(/g)) {
      const at = m.index ?? 0;
      if (isDeclared(source.code, at)) continue;
      const { args, close } = callArguments(source, at + m[0].length - 1);
      const spans = found.spans.get(source) ?? new Spans();
      spans.add(at + 1, close);
      found.spans.set(source, spans);
      const defaultArg = args.find((a) => a.name === "defaultFontFamily");
      const family = defaultArg ? familyOf(defaultArg.value, families) : SYSTEM;
      if (defaultArg) found.defaultFamily = family;
      for (const arg of args) {
        const role = arg.name ?? "";
        const style = role in MATERIAL_DEFAULTS ? styleAt(source, arg.at, families, bases) : undefined;
        if (style) found.roles.set(role, roleStyle(role, style, family));
      }
    }
  }
  return found;
}

/** Every role the code reads, with its uses: as set, or as Material's default. */
function usedRoles(sources: KotlinSource[], { roles, defaultFamily }: Typography): TypeStyle[] {
  for (const { code } of sources) {
    for (const m of code.matchAll(/\bMaterialTheme\.typography\.(\w+)\b/g)) {
      const role = m[1] ?? "";
      const defaults = MATERIAL_DEFAULTS[role];
      const style = roles.get(role) ?? (defaults && roleStyle(role, defaults, defaultFamily ?? SYSTEM));
      if (!style) continue;
      roles.set(role, style);
      style.uses++;
    }
  }
  return [...roles.values()];
}

/** `TextStyle(…)`s written where they're used: outside the type scale, and not ones the app names. */
function inlineStyles(
  sources: KotlinSource[],
  families: Map<string, string>,
  bases: Bases,
  scale: Typography["spans"],
): TypeUse[] {
  const uses: TypeUse[] = [];
  for (const source of sources) {
    const inScale = scale.get(source)?.start();
    for (const m of source.code.matchAll(/(?<![\w.])TextStyle\s*\(/g)) {
      const at = m.index ?? 0;
      if (inScale?.contains(at) || isDeclared(source.code, at)) continue;
      // A style the app names is read with the bases, as one of its own.
      if (assignedName(source.code, at) && declaredIn(source, at) !== undefined) continue;
      const style = styleAt(source, at, families, bases);
      if (!style || isEmpty(style)) continue;
      uses.push({
        kind: style.family && style.family !== SYSTEM ? "custom" : "system",
        family: style.family ?? SYSTEM,
        ...(style.size !== undefined && { size: style.size }),
        weight: style.weight ?? "regular",
        file: source.rel,
      });
    }
  }
  return uses;
}

/** A style setting none of the values a type scale is made of (only a colour, say). */
const isEmpty = (style: Style) =>
  style.size === undefined && style.family === undefined && style.weight === undefined;

/** The app's named styles that set any of a type scale's values, as its own. */
function appStyles(bases: Bases): Map<string, TypeStyle> {
  const styles = new Map<string, TypeStyle>();
  for (const [reference, style] of bases) {
    if (isEmpty(style)) continue;
    const name = reference.split(".").at(-1) ?? reference;
    styles.set(reference, { ...roleStyle(name, style, SYSTEM), kind: "app", reference });
  }
  return styles;
}

/** The app's named styles, each with how many times the code names it. */
function countUses(sources: KotlinSource[], styles: Map<string, TypeStyle>): TypeStyle[] {
  if (styles.size === 0) return [];
  for (const { code } of sources)
    for (const m of code.matchAll(/(?<![\w.])((?:[A-Za-z_]\w*\.)*[A-Za-z_]\w*)\b(?!\s*=[^=])/g)) {
      // `Heading.copy(…)` is a use of `Heading`.
      for (const path of prefixesOf(m[1] ?? "")) {
        const style = styles.get(path);
        if (style) {
          style.uses++;
          break;
        }
      }
    }
  return [...styles.values()];
}
