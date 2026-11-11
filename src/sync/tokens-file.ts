/**
 * Reads a tokens.json that Designmap wrote into the tokens a sync works with. Each token's identity is how the code
 * refers to it (`Theme.surface`), so a sync finds it again whatever it's called in the design file. Values the code
 * never names are known by the value itself (an inline `#ff0000`, a spacing of 8, a `System 15 semibold` style):
 * when the code changes one, it's a new token, and the old one is deprecated.
 */

import { z } from "zod";
import {
  type ColorTokenEntry,
  type ColorValue,
  type TextStyleGroup,
  TokensFile,
} from "../output/tokens-schema.js";

/** A colour as `#rrggbb` with opacity 0–1. */
export interface Rgba {
  hex: string;
  alpha: number;
}

export interface SyncColor {
  /** What a sync recognises it by from one run to the next. */
  identity: string;
  key: string;
  light: Rgba;
  dark?: Rgba;
  reference?: string;
}

/** A text style's values as the code sets them: what it computes is left out. */
export interface TextValue {
  family?: string;
  size?: number;
  weight?: number;
}

export interface SyncTextStyle {
  identity: string;
  key: string;
  value: TextValue;
  reference?: string;
}

/** Every token the app's code uses. */
export interface SyncTokens {
  colors: SyncColor[];
  textStyles: SyncTextStyle[];
  spacing: number[];
  radii: number[];
  /** The scan read the whole app, so a token missing here is one the code dropped. */
  complete: boolean;
  /** The app's name, when the file records it. */
  app?: string;
}

/** The tokens in `json`, or an error saying what's wrong and what to do. */
export function readTokensFile(json: unknown): SyncTokens {
  const file = TokensFile.safeParse(json);
  if (!file.success) {
    throw new Error(
      `This isn't a tokens.json Designmap writes. Run designmap on the app again. ${z.prettifyError(file.error)}`,
    );
  }
  const colors = tokensIn(file.data.color).map(([key, token]) => syncColor(key, token));
  const textStyles = tokensIn(file.data.typography).map(([key, style]) => ({
    token: syncTextStyle(key, style),
  }));
  const spacing = tokensIn(file.data.spacing).map(([, token]) => token.$value.value);
  const radii = tokensIn(file.data.radius).map(([, token]) => token.$value.value);
  if (!colors.length && !textStyles.length && !spacing.length && !radii.length) {
    throw new Error("This tokens.json has no tokens. Run designmap on the app again before syncing.");
  }
  return {
    colors: distinct(colors),
    textStyles: distinct(textStyles),
    spacing,
    radii,
    complete: file.data.$extensions?.designmap.partial !== true,
    ...(file.data.$extensions?.designmap.app ? { app: file.data.$extensions.designmap.app } : {}),
  };
}

/** A group's tokens with their keys, without its `$description`. */
function tokensIn<T>(group: Record<string, string | T> | undefined): [string, T][] {
  return Object.entries(group ?? {}).flatMap(([key, value]) =>
    typeof value === "string" ? [] : [[key, value]],
  );
}

const rgba = (value: z.output<typeof ColorValue>): Rgba => ({
  hex: value.hex.toLowerCase(),
  alpha: value.alpha ?? 1,
});

/**
 * A colour's identity. A type's member (`Theme.surface`) or an asset (`Color("Brand")`) is one in the whole app; a
 * plain constant (`accent`) may be private to its file, so its file is part of its identity whether or not another
 * file has one too. A colour with no name is known by its value.
 */
function colorIdentity(reference: string | undefined, source: string, value: Rgba): string {
  if (!reference) return `color:${value.hex}${value.alpha === 1 ? "" : `/${value.alpha}`}`;
  return `color:${/[.(]/.test(reference) ? reference : `${reference}@${source}`}`;
}

/** A colour, and the line it's declared on, which orders same-named colours in one file. */
function syncColor(
  key: string,
  token: z.output<typeof ColorTokenEntry>,
): { token: SyncColor; line?: number } {
  const { reference, source, line, modes } = token.$extensions.designmap;
  const light = rgba(token.$value);
  return {
    token: {
      identity: colorIdentity(reference, source, light),
      key,
      light,
      ...(modes ? { dark: rgba(modes.dark) } : {}),
      ...(reference ? { reference } : {}),
    },
    ...(line ? { line } : {}),
  };
}

/** A text style is known by its name in the code (`heading`, `brand 20 bold` for a helper called with a size, or a
 * description like `System 15 semibold`) and the font helper it comes from, which is one in the whole app. */
function syncTextStyle(key: string, style: z.output<typeof TextStyleGroup>): SyncTextStyle {
  const { reference, name } = style.$extensions.designmap;
  return {
    identity: `type:${reference ? `${reference}|${name}` : name}`,
    key,
    value: {
      ...(style.fontFamily ? { family: style.fontFamily.$value } : {}),
      ...(style.fontSize ? { size: style.fontSize.$value.value } : {}),
      ...(style.fontWeight ? { weight: style.fontWeight.$value } : {}),
    },
    ...(reference ? { reference } : {}),
  };
}

/** Tokens whose identities still clash (two `let accent`s in one file) told apart in the order they're declared,
 * which a change of value doesn't move. */
function distinct<T extends { identity: string; key: string }>(entries: { token: T; line?: number }[]): T[] {
  const byIdentity = new Map<string, { token: T; line?: number }[]>();
  for (const entry of entries) {
    const same = byIdentity.get(entry.token.identity) ?? [];
    byIdentity.set(entry.token.identity, same);
    same.push(entry);
  }
  const renamed = new Map<T, string>();
  for (const [identity, same] of byIdentity) {
    if (same.length < 2) continue;
    const declared = [...same].sort(
      (a, b) => (a.line ?? 0) - (b.line ?? 0) || (a.token.key < b.token.key ? -1 : 1),
    );
    for (const [i, { token }] of declared.entries())
      renamed.set(token, i === 0 ? identity : `${identity}#${i + 1}`);
  }
  return entries.map(({ token }) => {
    const identity = renamed.get(token);
    return identity ? { ...token, identity } : token;
  });
}
