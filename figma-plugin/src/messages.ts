/** What the plugin's window and its Figma side say to each other, checked on arrival since either end only sees an
 * untyped message. */

import { z } from "zod";

const names = z.array(z.string());

const PlanSummary = z.object({
  create: names,
  update: names,
  restore: names,
  rename: z.array(z.object({ from: z.string(), to: z.string() })),
  deprecate: names,
  /** Styles whose font this file doesn't have, so the sync leaves them out. */
  missingFonts: names,
  unchanged: z.number(),
  /** The scan didn't read the whole app, so nothing is deprecated. */
  partial: z.boolean(),
  /** Too many tokens changed at once to guess renames. */
  renamesSkipped: z.boolean(),
  /** The collection couldn't take a Dark mode, so dark values are left out; Apply tries again. */
  darkLeftOut: z.boolean(),
  /** Whether Apply has anything to do. */
  applicable: z.boolean(),
});
export type PlanSummary = z.infer<typeof PlanSummary>;

const id = z.number().int().nonnegative();

/** Where in a GitHub repo the plugin reads tokens.json from; the token that reads it never reaches the window. */
export const RepoSource = z.object({ repo: z.string(), branch: z.string(), path: z.string() });
export type RepoSource = z.infer<typeof RepoSource>;

/** `id` ties a plan to the request that made it, so an Apply only ever applies the plan the designer is looking at. */
const ToPlugin = z.discriminatedUnion("type", [
  /** The window has opened: say which repo is connected, and plan from it if one is. */
  z.object({ type: z.literal("ready"), id }),
  z.object({ type: z.literal("connect"), id, ...RepoSource.shape, token: z.string() }),
  /** Plan from the connected repo's tokens.json as it is now. */
  z.object({ type: z.literal("fetch"), id }),
  z.object({ type: z.literal("disconnect") }),
  z.object({ type: z.literal("plan"), id, json: z.string() }),
  z.object({ type: z.literal("apply"), id }),
  z.object({ type: z.literal("close") }),
]);
export type ToPlugin = z.infer<typeof ToPlugin>;

const ToWindow = z.discriminatedUnion("type", [
  /** `saved`: the repo this file syncs from when this computer has no token for it, to fill in the form. */
  z.object({ type: z.literal("connection"), repo: RepoSource.nullable(), saved: RepoSource.optional() }),
  z.object({ type: z.literal("plan"), id, summary: PlanSummary }),
  z.object({ type: z.literal("applied"), notes: names }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type ToWindow = z.infer<typeof ToWindow>;

/** A message the window sent, or undefined for anything else. */
export const toPlugin = (data: unknown): ToPlugin | undefined => ToPlugin.safeParse(data).data;

/** A message the Figma side sent, or undefined for anything else. */
export const toWindow = (data: unknown): ToWindow | undefined => ToWindow.safeParse(data).data;
