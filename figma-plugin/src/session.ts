/** The plugin's conversation with its window: actions in turn, a plan made from the file as it is now, and an apply of
 * exactly the plan the designer saw. */

import { planSync, type SyncPlan } from "../../src/sync/plan.js";
import { readTokensFile, type SyncColor, type SyncTokens } from "../../src/sync/tokens-file.js";
import { type ApplyOptions, applyPlan } from "./apply.js";
import { availableFontStyles, darkUnavailable, readDesignFile, textStyleFonts } from "./design-file.js";
import { type PlanSummary, type ToWindow, toPlugin } from "./messages.js";
import { missingFont } from "./notes.js";
import { describeFont, type FontValue, fontFor, hasOwnDark } from "./values.js";

interface Pending {
  id: number;
  plan: SyncPlan;
  options: ApplyOptions;
  /** Styles left out of the plan for want of their font, still to be named once it's applied. */
  missingFonts: MissingFont[];
}

/** A text style left out of a sync, and the font this file doesn't have for it. */
interface MissingFont {
  name: string;
  font: string;
}

/** Answers each message from the window in turn, replying through `send`. */
export function createSession(send: (message: ToWindow) => void): (data: unknown) => Promise<void> {
  let pending: Pending | undefined;
  let queue = Promise.resolve();

  /** Runs `step` after any already running, so a file picked during an apply is planned against its result. */
  const inTurn = (step: () => Promise<void>): Promise<void> => {
    queue = queue.then(() =>
      step().catch((error: unknown) => send({ type: "error", message: messageOf(error) })),
    );
    return queue;
  };

  async function plan(id: number, json: string): Promise<void> {
    // A new file replaces any plan already shown, even if this one can't be read.
    pending = undefined;
    const inCode = readTokensFile(parseJson(json));
    const darkLeftOut =
      (await darkUnavailable()) && inCode.colors.some((color) => hasOwnDark(color.light, color.dark));
    const tokens = darkLeftOut ? withoutDark(inCode) : withoutRedundantDark(inCode);
    const { plan, missingFonts } = await withoutMissingFonts(planSync(tokens, await readDesignFile()));
    pending = {
      id,
      plan,
      options: { retryDark: darkLeftOut, ...(tokens.app ? { app: tokens.app } : {}) },
      missingFonts,
    };
    const summary = summarize(plan, !tokens.complete);
    const changes = [summary.create, summary.update, summary.restore, summary.rename, summary.deprecate];
    const applicable = changes.some((list) => list.length > 0) || darkLeftOut;
    const missingFontNames = missingFonts.map(({ name, font }) => `${name} (${font})`);
    send({
      type: "plan",
      id,
      summary: { ...summary, missingFonts: missingFontNames, darkLeftOut, applicable },
    });
  }

  async function apply(id: number): Promise<void> {
    if (!pending) throw new Error("Pick a tokens.json first.");
    if (pending.id !== id) throw new Error("The plan changed. Look it over, then press Apply again.");
    const { plan, options, missingFonts } = pending;
    pending = undefined;
    try {
      const notes = await applyPlan(plan, options);
      const missingFontNotes = missingFonts.map(({ name, font }) => missingFont(name, font));
      send({ type: "applied", notes: [...missingFontNotes, ...notes] });
    } catch (error) {
      throw new Error(
        `The sync stopped partway. Pick tokens.json again to see what is left. (${messageOf(error)})`,
      );
    }
  }

  return (data: unknown): Promise<void> => {
    const message = toPlugin(data);
    if (!message) return Promise.resolve();
    // Closing waits its turn too, so it never cuts an apply short.
    if (message.type === "close") return inTurn(async () => figma.closePlugin());
    return message.type === "plan"
      ? inTurn(() => plan(message.id, message.json))
      : inTurn(() => apply(message.id));
  };
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      "This file isn't valid JSON. Pick the tokens.json Designmap wrote, or run designmap again.",
    );
  }
}

const lightOnly = ({ dark: _, ...color }: SyncColor): SyncColor => color;

/** The code's tokens for a file that can't have a Dark mode, so dark values don't show as changed on every sync. */
const withoutDark = (tokens: SyncTokens): SyncTokens => ({ ...tokens, colors: tokens.colors.map(lightOnly) });

/** The code's tokens with a dark value only where it differs from the light one, as the file holds them. */
const withoutRedundantDark = (tokens: SyncTokens): SyncTokens => ({
  ...tokens,
  colors: tokens.colors.map((color) => (hasOwnDark(color.light, color.dark) ? color : lightOnly(color))),
});

/** The plan without the text styles whose font this file doesn't have, which no sync could make, so they'd otherwise
 * show as new or changed every time; and their names, with the font they need. */
async function withoutMissingFonts(plan: SyncPlan): Promise<{ plan: SyncPlan; missingFonts: MissingFont[] }> {
  const fontStyles = await availableFontStyles();
  const currentFonts = await textStyleFonts();
  const fontOfNew = (entry: { value: FontValue }) => ({ value: entry.value, current: undefined });
  const fontOfExisting = (entry: { id: string; token: { value: FontValue } }) => ({
    value: entry.token.value,
    current: currentFonts.get(entry.id),
  });
  const { textStyles } = plan;
  const create = splitByFont(textStyles.create, fontOfNew, fontStyles);
  const update = splitByFont(textStyles.update, fontOfExisting, fontStyles);
  const rename = splitByFont(textStyles.rename, fontOfExisting, fontStyles);
  return {
    plan: {
      ...plan,
      textStyles: { ...textStyles, create: create.kept, update: update.kept, rename: rename.kept },
    },
    missingFonts: [...create.missing, ...update.missing, ...rename.missing],
  };
}

/** `entries` split into those whose font this file has, and the rest with the font they need. */
function splitByFont<T extends { name: string }>(
  entries: T[],
  fontOf: (entry: T) => { value: FontValue; current: FontName | undefined },
  fontStyles: Map<string, string[]>,
): { kept: T[]; missing: MissingFont[] } {
  const kept: T[] = [];
  const missing: MissingFont[] = [];
  for (const entry of entries) {
    const { value, current } = fontOf(entry);
    const { family, style } = fontFor(value, current, fontStyles);
    if (style) kept.push(entry);
    else missing.push({ name: entry.name, font: describeFont(family, value.weight) });
  }
  return { kept, missing };
}

function summarize(
  plan: SyncPlan,
  partial: boolean,
): Omit<PlanSummary, "missingFonts" | "darkLeftOut" | "applicable"> {
  const { variables, textStyles } = plan;
  const updates = [...variables.update, ...textStyles.update];
  return {
    create: [...variables.create, ...textStyles.create].map((entry) => entry.name),
    update: updates.filter((entry) => !entry.restored).map((entry) => entry.name),
    restore: updates.filter((entry) => entry.restored).map((entry) => entry.name),
    rename: [...variables.rename, ...textStyles.rename].map((entry) => ({
      from: entry.name,
      to: entry.token.reference ?? entry.token.name,
    })),
    deprecate: [...variables.deprecate, ...textStyles.deprecate].map((entry) => entry.name),
    unchanged: variables.unchanged + textStyles.unchanged,
    partial,
    renamesSkipped: variables.renamesSkipped || textStyles.renamesSkipped,
  };
}
