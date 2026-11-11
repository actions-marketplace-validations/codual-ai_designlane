/** Makes a sync plan real in the Figma file: variables and text styles created, updated, renamed or deprecated. */

import { type CodeToken, kindOf, type SyncPlan, type VariableValue } from "../../src/sync/plan.js";
import type { TextValue } from "../../src/sync/tokens-file.js";
import {
  availableFontStyles,
  designmapName,
  isDeprecated,
  KEYS,
  NAMESPACE,
  SYNCED_COLLECTION,
  type SyncModes,
  syncedCollection,
  syncModes,
} from "./design-file.js";
import { leftOut, missingFont } from "./notes.js";
import { describeFont, fontFor, toFigmaColor } from "./values.js";

/** Figma's error when a collection already has as many modes as the file's plan allows. */
const MODE_LIMIT = /limited to \d+ modes?/i;
/** Written without apostrophes: Figma stores a description as markup and shows one escaped. */
const DEPRECATED_NOTE = "Deprecated: Designmap no longer finds this in the code.";
const IN_THE_CODE = "In the code: ";
/** The size of a new style whose size the code works out while the app runs: iOS body text. */
const DEFAULT_SIZE = 17;
/** Figma's smallest font size. */
const MIN_SIZE = 1;
/** Where each kind of number may be used in a design; anything else is a colour. */
const NUMBER_SCOPES: Record<string, VariableScope[]> = { spacing: ["GAP"], radius: ["CORNER_RADIUS"] };
const COLOR_SCOPES: VariableScope[] = ["FRAME_FILL", "SHAPE_FILL", "TEXT_FILL", "STROKE_COLOR"];

/** The modes a sync writes to, once its collection is sure to have a Light one. */
type Modes = SyncModes & { light: string };

export interface ApplyOptions {
  /** Try again to add the Dark mode a full collection couldn't take before. */
  retryDark: boolean;
  /** The app's name, which names a new collection: "Rummy (Designmap)". */
  app?: string;
}

/** What an apply did that the designer should know: what it left out, and whether it added a Dark mode whose
 * dark values a further sync fills in. */
export interface Applied {
  notes: string[];
  darkValuesPending: boolean;
}

export async function applyPlan(plan: SyncPlan, options: ApplyOptions): Promise<Applied> {
  const notes: string[] = [];
  let darkValuesPending = false;
  const { create, update, rename, deprecate } = plan.variables;
  // The collection is only touched when there's variable work, so a sync of text styles alone doesn't make an empty one.
  if ([create, update, rename, deprecate].some((list) => list.length > 0) || options.retryDark) {
    darkValuesPending = await applyVariables(plan, options, notes);
  }
  await applyTextStyles(plan, notes);
  return { notes, darkValuesPending };
}

const noteDeleted = (notes: string[], name: string) =>
  notes.push(leftOut(name, "it was deleted after the plan was made"));

/** Applies the plan's variables, and says whether it added a Dark mode with dark values still to write. */
async function applyVariables(plan: SyncPlan, options: ApplyOptions, notes: string[]): Promise<boolean> {
  const { collection, modes, darkValuesPending } = await collectionFor(plan, options, notes);
  for (const token of plan.variables.create) {
    const resolvedType = typeof token.value === "number" ? "FLOAT" : "COLOR";
    const variable = figma.variables.createVariable(token.name, collection, resolvedType);
    variable.scopes = NUMBER_SCOPES[kindOf(token.identity)] ?? COLOR_SCOPES;
    mark(variable, token);
    setValue(variable, token.value, modes);
  }
  for (const { id, name, token } of [...plan.variables.update, ...plan.variables.rename]) {
    const variable = await figma.variables.getVariableByIdAsync(id);
    if (!variable) {
      noteDeleted(notes, name);
      continue;
    }
    mark(variable, token);
    setValue(variable, token.value, modes);
  }
  for (const { id, name } of plan.variables.deprecate) {
    const variable = await figma.variables.getVariableByIdAsync(id);
    if (variable) deprecate(variable);
    else noteDeleted(notes, name);
  }
  return darkValuesPending;
}

async function applyTextStyles(plan: SyncPlan, notes: string[]): Promise<void> {
  const fontStyles = await availableFontStyles();
  for (const token of plan.textStyles.create) {
    const size = sizeFor(token.name, token.value.size ?? DEFAULT_SIZE, notes);
    if (size === undefined) continue;
    const font = await loadedFont(token.name, token.value, undefined, fontStyles, notes);
    if (!font) continue;
    const style = figma.createTextStyle();
    style.name = token.name;
    mark(style, token);
    setText(style, font, size);
  }
  for (const { id, name, token } of [...plan.textStyles.update, ...plan.textStyles.rename]) {
    const style = await figma.getStyleByIdAsync(id);
    if (style?.type !== "TEXT") {
      noteDeleted(notes, name);
      continue;
    }
    const size = sizeFor(style.name, token.value.size ?? style.fontSize, notes);
    if (size === undefined) continue;
    const font = await loadedFont(style.name, token.value, style.fontName, fontStyles, notes);
    if (!font) continue;
    mark(style, token);
    setText(style, font, size);
  }
  for (const { id, name } of plan.textStyles.deprecate) {
    const style = await figma.getStyleByIdAsync(id);
    if (style) deprecate(style);
    else noteDeleted(notes, name);
  }
}

/** The collection a sync made, or a new one, with its own Light mode, and a Dark mode when the code has dark values. */
async function collectionFor(
  plan: SyncPlan,
  { retryDark, app }: ApplyOptions,
  notes: string[],
): Promise<{ collection: VariableCollection; modes: Modes; darkValuesPending: boolean }> {
  const collection = (await syncedCollection()) ?? newCollection(app);
  const light = syncModes(collection).light ?? addLightMode(collection);
  const { create, update, rename } = plan.variables;
  const values = [
    ...create.map((token) => token.value),
    ...[...update, ...rename].map((entry) => entry.token.value),
  ];
  const wantsDark = values.some((value) => typeof value !== "number" && value.dark !== undefined);
  let darkValuesPending = false;
  if ((wantsDark || retryDark) && !syncModes(collection).dark) {
    const added = addDarkMode(collection, notes);
    // A retry whose plan had its dark values left out has none to write yet.
    darkValuesPending = added && !wantsDark;
  }
  const { dark } = syncModes(collection);
  return { collection, modes: { light, ...(dark ? { dark } : {}) }, darkValuesPending };
}

/** A new collection, named for the app and for Designmap; a designer may rename it, since a sync finds it by its mark. */
function newCollection(app: string | undefined): VariableCollection {
  const collection = figma.variables.createVariableCollection(designmapName(app));
  collection.setSharedPluginData(NAMESPACE, KEYS.collection, SYNCED_COLLECTION);
  collection.renameMode(collection.defaultModeId, "Light");
  collection.setSharedPluginData(NAMESPACE, KEYS.lightMode, collection.defaultModeId);
  return collection;
}

const isModeLimit = (error: unknown) => error instanceof Error && MODE_LIMIT.test(error.message);

/** Adds back the Light mode a designer deleted, since Designmap never writes into a mode it didn't make. */
function addLightMode(collection: VariableCollection): string {
  try {
    const light = collection.addMode("Light");
    collection.setSharedPluginData(NAMESPACE, KEYS.lightMode, light);
    return light;
  } catch (error) {
    if (!isModeLimit(error)) throw error;
    throw new Error(
      "The Designmap collection's Light mode was deleted, and this Figma plan can't add it back. Delete a mode from the collection, then sync again.",
    );
  }
}

/** Adds the Dark mode, and says whether it could. A collection at its Figma plan's mode limit is remembered, so later
 * plans leave dark values out rather than finding them changed every time; each apply tries again, in case there's now
 * room. */
function addDarkMode(collection: VariableCollection, notes: string[]): boolean {
  try {
    collection.setSharedPluginData(NAMESPACE, KEYS.darkMode, collection.addMode("Dark"));
    collection.setSharedPluginData(NAMESPACE, KEYS.darkUnavailable, "");
    return true;
  } catch (error) {
    if (!isModeLimit(error)) throw error;
    collection.setSharedPluginData(NAMESPACE, KEYS.darkUnavailable, "true");
    notes.push(
      "Dark values weren't added: the Designmap collection has as many modes as this Figma plan allows.",
    );
    return false;
  }
}

function setValue(variable: Variable, value: VariableValue, modes: Modes): void {
  if (typeof value === "number") {
    variable.setValueForMode(modes.light, value);
    if (modes.dark) variable.setValueForMode(modes.dark, value);
    return;
  }
  variable.setValueForMode(modes.light, toFigmaColor(value.light));
  if (modes.dark) variable.setValueForMode(modes.dark, toFigmaColor(value.dark ?? value.light));
}

const isVariable = (item: Variable | BaseStyle): item is Variable => "resolvedType" in item;

/** Records the token's identity, so the next sync finds it whatever a designer calls it, and shows how the code
 * refers to it. A description a designer wrote is kept, and a token back in the code gets back what it had before. */
function mark(item: Variable | BaseStyle, token: CodeToken<unknown>): void {
  const restored = isDeprecated(item);
  item.setSharedPluginData(NAMESPACE, KEYS.identity, token.identity);
  item.setSharedPluginData(NAMESPACE, KEYS.deprecated, "");
  if (restored) item.description = item.getSharedPluginData(NAMESPACE, KEYS.descriptionBefore);
  const { description } = item;
  if (description === "" || description.startsWith(IN_THE_CODE)) {
    item.description = token.reference ? `${IN_THE_CODE}${token.reference}` : "";
  }
  if (!isVariable(item)) return;
  if (token.reference) item.setVariableCodeSyntax("iOS", token.reference);
  else if (item.codeSyntax.iOS) item.removeVariableCodeSyntax("iOS");
  if (restored) item.hiddenFromPublishing = item.getSharedPluginData(NAMESPACE, KEYS.hiddenBefore) === "true";
}

/** Marks an item the code dropped, never deleting it, since designs may still use it, and keeps what it had for when
 * it comes back. Figma can hide a variable from publishing, but not a style, so a style is marked in its description
 * only. */
function deprecate(item: Variable | BaseStyle): void {
  item.setSharedPluginData(NAMESPACE, KEYS.deprecated, "true");
  item.setSharedPluginData(NAMESPACE, KEYS.descriptionBefore, item.description);
  item.description = DEPRECATED_NOTE;
  if (!isVariable(item)) return;
  item.setSharedPluginData(NAMESPACE, KEYS.hiddenBefore, String(item.hiddenFromPublishing));
  item.hiddenFromPublishing = true;
}

/** `size`, or none with a note when Figma can't have it. */
function sizeFor(name: string, size: number, notes: string[]): number | undefined {
  if (size >= MIN_SIZE) return size;
  notes.push(leftOut(name, `size ${size} is smaller than Figma allows`));
  return undefined;
}

/** The font a style should have, loaded along with its current one, since Figma changes a style's size only with its
 * font loaded; none, with a note, when this file can't have it. */
async function loadedFont(
  name: string,
  value: TextValue,
  current: FontName | undefined,
  fontStyles: Map<string, string[]>,
  notes: string[],
): Promise<FontName | undefined> {
  const { family, style } = fontFor(value, current, fontStyles);
  if (!style) {
    notes.push(missingFont(name, describeFont(family, value.weight)));
    return undefined;
  }
  const font = { family, style };
  try {
    if (current) await figma.loadFontAsync(current);
    await figma.loadFontAsync(font);
  } catch {
    notes.push(leftOut(name, "its font couldn't be loaded in this file"));
    return undefined;
  }
  return font;
}

function setText(style: TextStyle, font: FontName, size: number): void {
  // Setting the font only when it changes keeps a variable font's own axis settings.
  if (font.family !== style.fontName.family || font.style !== style.fontName.style) style.fontName = font;
  style.fontSize = size;
}
