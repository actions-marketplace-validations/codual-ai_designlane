/** The plugin's conversation with its window: actions in turn, a plan made from the file as it is now, and an apply of
 * exactly the plan the designer saw. */

import { type Plan, planSync, type SyncPlan } from "../../src/sync/plan.js";
import { readTokensFile, type SyncColor, type SyncTokens } from "../../src/sync/tokens-file.js";
import { type ApplyOptions, applyPlan } from "./apply.js";
import {
  type Connection,
  checkConnection,
  fileSource,
  forgetConnection,
  saveConnection,
  savedConnection,
} from "./connection.js";
import {
  availableFontStyles,
  type DarkUnavailable,
  darkUnavailable,
  readDesignFile,
  textStyleFonts,
} from "./design-file.js";
import { fetchTokensFile } from "./github.js";
import { type PlanSummary, type RepoSource, type ToWindow, toPlugin } from "./messages.js";
import {
  darkModeAdded,
  invalidJson,
  missingFont,
  type Origin,
  pageNotRedrawn,
  stoppedPartway,
} from "./notes.js";
import { drawDesignSystemPage } from "./page.js";
import { describeFont, type FontValue, fontFor, hasOwnDark } from "./values.js";

interface Pending {
  id: number;
  plan: SyncPlan;
  options: ApplyOptions;
  origin: Origin;
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

  async function plan(id: number, json: string, origin: Origin): Promise<void> {
    // A new file replaces any plan already shown, even if this one can't be read.
    pending = undefined;
    const inCode = readTokensFile(parseJson(json, origin));
    const leftOut = darkLeftOutOf(inCode, await darkUnavailable());
    const darkLeftOut = leftOut.main || leftOut.themes.size > 0;
    const tokens = withDarkWhereRoom(inCode, leftOut);
    const { plan, missingFonts } = await withoutMissingFonts(planSync(tokens, await readDesignFile()));
    pending = {
      id,
      plan,
      options: {
        retryDark: leftOut,
        ...(tokens.app ? { app: tokens.app } : {}),
        ...(tokens.platform ? { platform: tokens.platform } : {}),
      },
      origin,
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
    if (!pending) throw new Error("There's no plan to apply yet.");
    if (pending.id !== id) throw new Error("The plan changed. Look it over, then press Apply again.");
    const { plan, options, origin, missingFonts } = pending;
    pending = undefined;
    try {
      const { notes, darkValuesPending } = await applyPlan(plan, options);
      const pageNotes = await drawDesignSystemPage(options.app).then(
        () => [],
        (error: unknown) => [pageNotRedrawn(messageOf(error))],
      );
      const missingFontNotes = missingFonts.map(({ name, font }) => missingFont(name, font));
      const darkNotes = darkValuesPending ? [darkModeAdded(origin)] : [];
      send({ type: "applied", notes: [...missingFontNotes, ...notes, ...darkNotes, ...pageNotes] });
    } catch (error) {
      throw new Error(stoppedPartway(origin, messageOf(error)));
    }
  }

  /** Says which repo is connected, and plans from it if one is; or, when this computer has no token for the repo the
   * file syncs from (a teammate's computer), which repo that is, so only the token is asked for. */
  async function ready(id: number): Promise<void> {
    const connection = await savedConnection();
    if (connection) {
      send({ type: "connection", repo: repoOf(connection) });
      await planFromRepo(id, connection);
      return;
    }
    const saved = fileSource();
    send({ type: "connection", repo: null, ...(saved ? { saved } : {}) });
  }

  /** Saves a connection once it has read tokens.json, so a mistyped one is never kept. */
  async function connect(id: number, connection: Connection): Promise<void> {
    const json = await fetchTokensFile(checkConnection(connection));
    await saveConnection(connection);
    send({ type: "connection", repo: repoOf(connection) });
    await plan(id, json, "repo");
  }

  async function fetchPlan(id: number): Promise<void> {
    const connection = await savedConnection();
    if (!connection) throw new Error("Connect a repo first.");
    await planFromRepo(id, connection);
  }

  async function planFromRepo(id: number, connection: Connection): Promise<void> {
    await plan(id, await fetchTokensFile(connection), "repo");
  }

  async function disconnect(): Promise<void> {
    await forgetConnection();
    send({ type: "connection", repo: null });
  }

  return (data: unknown): Promise<void> => {
    const message = toPlugin(data);
    if (!message) return Promise.resolve();
    switch (message.type) {
      case "ready":
        return inTurn(() => ready(message.id));
      case "connect": {
        const { id, type: _, ...connection } = message;
        return inTurn(() => connect(id, connection));
      }
      case "fetch":
        return inTurn(() => fetchPlan(message.id));
      case "disconnect":
        return inTurn(disconnect);
      case "plan":
        return inTurn(() => plan(message.id, message.json, "file"));
      case "apply":
        return inTurn(() => apply(message.id));
      // Closing waits its turn too, so it never cuts an apply short.
      case "close":
        return inTurn(async () => figma.closePlugin());
    }
  };
}

const repoOf = ({ repo, branch, path }: Connection): RepoSource => ({ repo, branch, path });

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

function parseJson(text: string, origin: Origin): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(invalidJson(origin));
  }
}

const lightOnly = ({ dark: _, ...color }: SyncColor): SyncColor => color;
const hasDarkValues = (colors: SyncColor[]) => colors.some((color) => hasOwnDark(color.light, color.dark));

/** The collections whose dark values are left out: those that couldn't take a Dark mode and have dark values to
 * write, each on its own, so one theme's full collection doesn't take the others' dark values. */
function darkLeftOutOf(tokens: SyncTokens, full: DarkUnavailable): DarkUnavailable {
  const themes = (tokens.themes ?? []).filter((t) => full.themes.has(t.name) && hasDarkValues(t.colors));
  return { main: full.main && hasDarkValues(tokens.colors), themes: new Set(themes.map((t) => t.name)) };
}

/** The code's tokens as a file holds them: no dark values in a collection that can't have a Dark mode, so they
 * don't show as changed on every sync, and elsewhere a dark value only where it differs from the light one. */
function withDarkWhereRoom(tokens: SyncTokens, leftOut: DarkUnavailable): SyncTokens {
  const own = (color: SyncColor) => (hasOwnDark(color.light, color.dark) ? color : lightOnly(color));
  const change = (isLeftOut: boolean) => (isLeftOut ? lightOnly : own);
  return {
    ...tokens,
    colors: tokens.colors.map(change(leftOut.main)),
    ...(tokens.themes
      ? {
          themes: tokens.themes.map((theme) => ({
            ...theme,
            colors: theme.colors.map(change(leftOut.themes.has(theme.name))),
          })),
        }
      : {}),
  };
}

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

/** Every plan a sync makes, each with what its names are shown after: a theme's name (`Desert: color/tint`), since
 * each theme has its own collection with the same names. */
function plansOf({ variables, textStyles, themes }: SyncPlan): { label: string; plan: Plan<unknown> }[] {
  return [
    { label: "", plan: variables },
    { label: "", plan: textStyles },
    ...themes.map(({ theme, variables }) => ({ label: `${theme}: `, plan: variables })),
  ];
}

function summarize(
  plan: SyncPlan,
  partial: boolean,
): Omit<PlanSummary, "missingFonts" | "darkLeftOut" | "applicable"> {
  const plans = plansOf(plan);
  const each = <T>(list: (p: Plan<unknown>) => T[]) =>
    plans.flatMap(({ label, plan }) => list(plan).map((entry) => ({ label, entry })));
  const updates = each((p) => p.update);
  return {
    create: each((p) => p.create).map(({ label, entry }) => label + entry.name),
    update: updates.filter(({ entry }) => !entry.restored).map(({ label, entry }) => label + entry.name),
    restore: updates.filter(({ entry }) => entry.restored).map(({ label, entry }) => label + entry.name),
    rename: each((p) => p.rename).map(({ label, entry }) => ({
      from: label + entry.name,
      to: label + (entry.token.reference ?? entry.token.name),
    })),
    deprecate: each((p) => p.deprecate).map(({ label, entry }) => label + entry.name),
    unchanged: plans.reduce((sum, { plan }) => sum + plan.unchanged, 0),
    partial,
    renamesSkipped: plans.some(({ plan }) => plan.renamesSkipped),
  };
}
