/**
 * What a sync changes in a design file: tokens read from the code, matched to what the file already has by the
 * identity each records, never by name, so a designer can rename anything and the next sync still finds it.
 */

import { numberLabel } from "../output/token-names.js";
import type { Rgba, SyncTokens, TextValue } from "./tokens-file.js";

/** A value a variable holds: a colour (light, and dark when it has one) or a number. */
export type VariableValue = { light: Rgba; dark?: Rgba } | number;

/** A variable or text style the design file has. `identity` is missing on ones a designer made. */
export interface DesignFileEntry<V> {
  id: string;
  name: string;
  identity?: string;
  value: V;
  deprecated: boolean;
}

export interface DesignFile {
  variables: DesignFileEntry<VariableValue>[];
  /** A design file's text style always has a family, size and weight. */
  textStyles: DesignFileEntry<Required<TextValue>>[];
}

/** A token from the code: what it's recognised by, the name it gets when first made, and its value. */
export interface CodeToken<V> {
  identity: string;
  name: string;
  value: V;
  /** How the code refers to it, shown to designers beside the value. */
  reference?: string;
}

export interface Plan<V> {
  create: CodeToken<V>[];
  /** Ones whose value changed, or that come back after being deprecated; they keep their name in the file. */
  update: { id: string; name: string; token: CodeToken<V>; restored: boolean }[];
  /** Ones the code no longer has, marked rather than deleted, since designs may still use them. */
  deprecate: { id: string; name: string }[];
  /** Ones that look renamed in the code (`Theme.c3` became `Theme.secondaryText`): the only token gone and the only one
   * new in their group with that value. The entry takes the new identity and keeps its name and everything using it. */
  rename: { id: string; name: string; token: CodeToken<V> }[];
  /** Too many tokens changed at once to guess renames, so any renames among them are planned as deprecate plus
   * create. */
  renamesSkipped: boolean;
  unchanged: number;
}

export interface SyncPlan {
  variables: Plan<VariableValue>;
  textStyles: Plan<TextValue>;
}

export function planSync(tokens: SyncTokens, file: DesignFile): SyncPlan {
  const variables: CodeToken<VariableValue>[] = [
    ...tokens.colors.map((c) => ({
      identity: c.identity,
      name: `color/${c.key}`,
      value: c.dark ? { light: c.light, dark: c.dark } : { light: c.light },
      ...(c.reference ? { reference: c.reference } : {}),
    })),
    ...tokens.spacing.map((n) => ({ identity: `spacing:${n}`, name: `spacing/${numberLabel(n)}`, value: n })),
    ...tokens.radii.map((n) => ({ identity: `radius:${n}`, name: `radius/${numberLabel(n)}`, value: n })),
  ];
  const textStyles: CodeToken<TextValue>[] = tokens.textStyles.map((s) => ({
    identity: s.identity,
    name: `Text/${s.key}`,
    value: s.value,
    ...(s.reference ? { reference: s.reference } : {}),
  }));
  return {
    variables: plan(variables, file.variables, sameVariable, tokens.complete),
    textStyles: plan(textStyles, file.textStyles, sameText, tokens.complete),
  };
}

/** A design file entry the sync manages: one it made, so it has an identity. */
type Synced<F> = DesignFileEntry<F> & { identity: string };

function plan<F, C>(
  tokens: CodeToken<C>[],
  file: DesignFileEntry<F>[],
  same: (inFile: F, inCode: C) => boolean,
  mayDeprecate: boolean,
): Plan<C> {
  // A variable duplicated in the design file carries the same identity: the first is synced, copies are left alone.
  const byIdentity = new Map<string, Synced<F>>();
  const copies = new Map<string, number>();
  for (const entry of file) {
    if (!entry.identity) continue;
    copies.set(entry.identity, (copies.get(entry.identity) ?? 0) + 1);
    if (!byIdentity.has(entry.identity))
      byIdentity.set(entry.identity, { ...entry, identity: entry.identity });
  }
  const update: Plan<C>["update"] = [];
  const created: CodeToken<C>[] = [];
  let unchanged = 0;
  for (const token of tokens) {
    const found = byIdentity.get(token.identity);
    if (!found) created.push(token);
    else if (found.deprecated || !same(found.value, token.value)) {
      update.push({ id: found.id, name: found.name, token, restored: found.deprecated });
    } else unchanged++;
  }
  // After a partial scan, a token missing from the code may only be missing from what was read.
  const listed = new Set(tokens.map((token) => token.identity));
  const dropped = mayDeprecate
    ? [...byIdentity.values()].filter((entry) => !listed.has(entry.identity) && !entry.deprecated)
    : [];
  const { rename, deprecate, renamesSkipped, toCreate } = dropsAndRenames(dropped, created, copies, same);
  // Names are handed out last, so a token that turned out to be a rename doesn't hold one; a name a designer already
  // used gets a suffix rather than a clash.
  const names = new Set(file.map((entry) => entry.name));
  const create = toCreate.map((token) => ({ ...token, name: unique(token.name, names) }));
  return { create, update, deprecate, rename, renamesSkipped, unchanged };
}

/** What becomes of the entries the code dropped: renamed to a new token that looks like the same one, or
 * deprecated; and the new tokens left to create. */
function dropsAndRenames<F, C>(
  dropped: Synced<F>[],
  created: CodeToken<C>[],
  copies: Map<string, number>,
  same: (inFile: F, inCode: C) => boolean,
) {
  // Renaming a duplicated entry would leave its copy to take its old identity, so only single entries are renamed;
  // every dropped entry still counts towards whether a match is the only one.
  const renamable = (entry: Synced<F>) => copies.get(entry.identity) === 1;
  const renamesSkipped = dropped.length * created.length > MAX_RENAME_COMPARISONS;
  const renamed = renamesSkipped
    ? new Map<Synced<F>, CodeToken<C>>()
    : renames(dropped, created, same, renamable);
  const takenByRename = new Set(renamed.values());
  return {
    rename: [...renamed].map(([entry, token]) => ({ id: entry.id, name: entry.name, token })),
    deprecate: dropped
      .filter((entry) => !renamed.has(entry))
      .map((entry) => ({ id: entry.id, name: entry.name })),
    renamesSkipped,
    toCreate: created.filter((token) => !takenByRename.has(token)),
  };
}

/** More comparisons than this between gone and new tokens is a rewrite, not a rename: the plan says it skipped them. */
const MAX_RENAME_COMPARISONS = 100_000;

/** Each renamable gone entry paired with a new token when each is the other's only match among every gone entry:
 * same kind, same value. */
function renames<F, C>(
  gone: Synced<F>[],
  created: CodeToken<C>[],
  same: (inFile: F, inCode: C) => boolean,
  renamable: (entry: Synced<F>) => boolean,
): Map<Synced<F>, CodeToken<C>> {
  const matches = (entry: Synced<F>, token: CodeToken<C>) =>
    kindOf(entry.identity) === kindOf(token.identity) && same(entry.value, token.value);
  const candidates = gone.map((entry) => created.filter((token) => matches(entry, token)));
  const timesMatched = new Map<CodeToken<C>, number>();
  for (const tokens of candidates) {
    for (const token of tokens) timesMatched.set(token, (timesMatched.get(token) ?? 0) + 1);
  }
  const pairs = new Map<Synced<F>, CodeToken<C>>();
  for (const [i, entry] of gone.entries()) {
    const [token, ...others] = candidates[i] ?? [];
    if (token && others.length === 0 && timesMatched.get(token) === 1 && renamable(entry))
      pairs.set(entry, token);
  }
  return pairs;
}

const kindOf = (identity: string) => identity.slice(0, identity.indexOf(":"));

function unique(name: string, names: Set<string>): string {
  let candidate = name;
  for (let n = 2; names.has(candidate); n++) candidate = `${name} ${n}`;
  names.add(candidate);
  return candidate;
}

/** Opacity a design file stores as a long fraction and tokens.json rounds to three places: closer than this is equal. */
const ALPHA_TOLERANCE = 0.002;

const sameRgba = (a: Rgba | undefined, b: Rgba | undefined) =>
  a === b ||
  (!!a &&
    !!b &&
    a.hex.toLowerCase() === b.hex.toLowerCase() &&
    Math.abs(a.alpha - b.alpha) < ALPHA_TOLERANCE);

function sameVariable(inFile: VariableValue, inCode: VariableValue): boolean {
  if (typeof inFile === "number" || typeof inCode === "number") return inFile === inCode;
  return sameRgba(inFile.light, inCode.light) && sameRgba(inFile.dark, inCode.dark);
}

/** Only what the code sets: a size it computes is whatever the designer set in the file. */
const sameText = (inFile: Required<TextValue>, inCode: TextValue) =>
  (inCode.family === undefined || inFile.family === inCode.family) &&
  (inCode.size === undefined || inFile.size === inCode.size) &&
  (inCode.weight === undefined || inFile.weight === inCode.weight);
