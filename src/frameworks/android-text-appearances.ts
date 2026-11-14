/** An Android app's text appearances: `<style name="TextAppearance.App.Title" parent="TextAppearance.Material3.TitleLarge">`
 * in `res/values`, with what it sets over its parent's values, as `R.style.TextAppearance_App_Title`. */

import { COMPUTED } from "../scan/type-scale.js";
import type { TypeStyle } from "../scan/types.js";
import { resourcePriority, valuesFolder } from "./android-resources.js";
import { familyFromFile } from "./compose-fonts.js";
import { MATERIAL_DEFAULTS, SYSTEM, weightByHundred } from "./material-type.js";

/** A size the style sets but that can't be read (`?attr/…`) is undefined, replacing its parent's. */
interface Font {
  family?: string;
  size?: number | undefined;
  weight?: string;
}

interface StyleResource {
  /** Its parent's name, given or implied by its own (`TextAppearance.App.Title` is `TextAppearance.App`'s child). */
  parent?: string;
  items: Map<string, string>;
}

const STYLE = /<style\b([^<>]*?)(\/?)>/g;
const ATTRIBUTE = /\b(name|parent)\s*=\s*"([^"]*)"/g;
const ITEM = /<item\s+name\s*=\s*"([\w:.]+)"\s*>\s*([^<]*?)\s*<\/item>/g;
const DIMEN = /<dimen\s+name\s*=\s*"([\w.]+)"\s*>\s*([^<]*?)\s*<\/dimen>/g;
const SIZE = /^(\d+(?:\.\d+)?)(?:sp|dp|dip)$/;
const STYLE_USE = /\bR\.style\.(\w+)|@style\/([\w.]+)/g;
/** Material's own text appearances, whose sizes and weights are Material's type scale (`Material3.BodySmall`,
 * `MaterialComponents.Headline6`). */
const MATERIAL_PARENT = /^TextAppearance\.(?:Material3|MaterialComponents)\.(\w+)$/;
const STYLE_LINK = /^@(?:android:)?style\//;
const FONT_FILE = /^@font\/(\w+)$/;
const DIMEN_LINK = /^@dimen\/([\w.]+)$/;
/** Android's generic families, named as Compose names them. */
const GENERIC_FAMILIES: Record<string, string> = {
  serif: "Serif",
  monospace: "Monospace",
  cursive: "Cursive",
};
const SANS_SERIF = /^sans-serif(?:-(thin|light|medium|black))?$/;
/** Parents, or dimensions pointing at dimensions, followed this many times over are a loop. */
const MAX_LINKS = 8;

/** The text appearances an app defines, each with how many times its code and resources reach it; `code` is the
 * Kotlin the app is written in. */
export function textAppearances(files: { rel: string; text: string }[], code: string[]): TypeStyle[] {
  const styles = new Map<string, StyleResource>();
  const dimens = new Map<string, string>();
  for (const file of [...files].sort((a, b) => resourcePriority(a.rel) - resourcePriority(b.rel))) {
    if (valuesFolder(file.rel) !== "values") continue;
    const text = withoutComments(file.text);
    for (const [name, style] of stylesIn(text)) if (!styles.has(name)) styles.set(name, style);
    for (const m of text.matchAll(DIMEN)) if (m[1] && !dimens.has(m[1])) dimens.set(m[1], m[2] ?? "");
  }
  const uses = styleUses([...files.map((f) => withoutComments(f.text)), ...code]);
  return [...styles].flatMap(([name, style]): TypeStyle[] => {
    if (!isTextAppearance(name, style)) return [];
    const font = fontOf(name, styles, dimens);
    if (!font) return [];
    const codeName = name.replaceAll(".", "_");
    return [
      {
        name,
        kind: "app",
        family: font.family ?? "",
        ...(font.size === undefined ? {} : { size: font.size }),
        weight: font.weight ?? COMPUTED,
        reference: `R.style.${codeName}`,
        uses: uses.get(codeName) ?? 0,
      },
    ];
  });
}

const isTextAppearance = (name: string, style: StyleResource) =>
  name.startsWith("TextAppearance.") || (style.parent?.startsWith("TextAppearance.") ?? false);

function stylesIn(text: string): Map<string, StyleResource> {
  const styles = new Map<string, StyleResource>();
  const opens = [...text.matchAll(STYLE)];
  let close = 0;
  for (const [i, m] of opens.entries()) {
    const attributes = new Map([...(m[1] ?? "").matchAll(ATTRIBUTE)].map((a) => [a[1], a[2] ?? ""]));
    const name = attributes.get("name");
    if (!name) continue;
    const given = attributes.get("parent");
    const implied = name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : undefined;
    const parent = (given === undefined ? implied : given.replace(STYLE_LINK, "")) || undefined;
    const items = new Map<string, string>();
    if (!m[2]) {
      const start = (m.index ?? 0) + m[0].length;
      // Each stretch is read once: a style ends where it closes, or where the next opens if it doesn't close first.
      if (close >= 0 && close < start) close = text.indexOf("</style>", start);
      const body = close < 0 ? "" : text.slice(start, Math.min(close, opens[i + 1]?.index ?? close));
      for (const item of body.matchAll(ITEM))
        items.set((item[1] ?? "").replace(/^android:/, ""), item[2] ?? "");
    }
    styles.set(name, { ...(parent ? { parent } : {}), items });
  }
  return styles;
}

/** What a style sets over its parents; undefined when neither it nor any parent sets a family or size. */
function fontOf(
  name: string,
  styles: Map<string, StyleResource>,
  dimens: Map<string, string>,
): Font | undefined {
  const chain: StyleResource[] = [];
  let font: Font = {};
  for (let at: string | undefined = name; at && chain.length <= MAX_LINKS; ) {
    const style = styles.get(at);
    if (!style) {
      const role = at.match(MATERIAL_PARENT)?.[1];
      const material = role && MATERIAL_DEFAULTS[materialRole(role)];
      if (material) font = { family: SYSTEM, ...material };
      break;
    }
    chain.push(style);
    at = style.parent;
  }
  if (chain.length > MAX_LINKS) return undefined;
  for (const style of chain.reverse()) Object.assign(font, itemsFont(style.items, dimens));
  return font.family === undefined && font.size === undefined ? undefined : font;
}

/** `BodySmall` as Material 3's `bodySmall`, `Headline6` as Material 2's `h6`. */
const materialRole = (role: string) =>
  role.replace(/^Headline(\d)$/, "h$1").replace(/^\w/, (c) => c.toLowerCase());

function itemsFont(items: Map<string, string>, dimens: Map<string, string>): Font {
  const font: Font = {};
  const size = items.get("textSize");
  if (size !== undefined) font.size = sizeOf(size, dimens);
  const family = items.get("fontFamily");
  if (family !== undefined) {
    const sans = family.match(SANS_SERIF);
    const file = family.match(FONT_FILE)?.[1];
    font.family = sans ? SYSTEM : file ? familyFromFile(file) : (GENERIC_FAMILIES[family] ?? "");
    if (sans?.[1]) font.weight = sans[1];
  }
  const style = items.get("textStyle");
  if (style !== undefined) font.weight = style.split("|").includes("bold") ? "bold" : "regular";
  const weight = Number(items.get("textFontWeight"));
  if (weight) font.weight = weightByHundred(weight);
  return font;
}

/** `14sp`, or a `@dimen/…` holding it, in points. */
function sizeOf(value: string, dimens: Map<string, string>): number | undefined {
  let at = value;
  for (let links = 0; links <= MAX_LINKS; links++) {
    const dimen = at.match(DIMEN_LINK)?.[1];
    if (!dimen) {
      const points = at.match(SIZE)?.[1];
      return points === undefined ? undefined : Number(points);
    }
    const next = dimens.get(dimen);
    if (next === undefined) return undefined;
    at = next;
  }
  return undefined;
}

/** XML without its comments, so a style commented out isn't read; one left open runs to the end. */
function withoutComments(text: string): string {
  const parts: string[] = [];
  for (let at = 0; at < text.length; ) {
    const open = text.indexOf("<!--", at);
    if (open < 0) {
      parts.push(text.slice(at));
      break;
    }
    parts.push(text.slice(at, open));
    const close = text.indexOf("-->", open + 4);
    at = close < 0 ? text.length : close + 3;
  }
  return parts.join("");
}

/** How many times each style is reached, by its code name (`TextAppearance_App_Title`). */
function styleUses(texts: string[]): Map<string, number> {
  const uses = new Map<string, number>();
  for (const text of texts)
    for (const m of text.matchAll(STYLE_USE)) {
      const name = m[1] ?? (m[2] ?? "").replaceAll(".", "_");
      uses.set(name, (uses.get(name) ?? 0) + 1);
    }
  return uses;
}
