import type { FrameworkId, ScreenRef } from "./types.js";

/**
 * What a framework plugin reports about each view, in the same shape for every language. The classifier turns
 * these facts into screens and components, so the rules are written once for all frameworks.
 */
export interface ViewFacts {
  name: string;
  /** Relative to the project root, with forward slashes. */
  file: string;
  line: number;
  /** Page-like elements in the view's own code: navigation, lists, scrolling, tabs, toolbars. */
  pageElements: number;
  bodyLines: number;
  /** The app opens it as a page: a sheet, dialog, tab, route, navigation destination or the app's root. */
  presented: boolean;
  /** Returned from a branch that isn't clearly navigation, a weaker sign of a page. */
  routed: boolean;
  /** Distinct files that place it inside another view. */
  childFiles: number;
}

/** A view scoring this or more is a whole screen rather than a component. */
const SCREEN_THRESHOLD = 3;
/** How much each sign moves a view towards being a screen. How the app opens a view outweighs what's inside it. */
const WEIGHT = {
  /** One point per page-like element, up to this many. */
  pageElements: 3,
  screenName: 3,
  screenFolder: 1,
  longBody: 1,
  presented: 3,
  routed: 2,
  reused: -2,
  componentEnding: -3,
  componentWord: -2,
} as const;
const LONG_BODY_LINES = 60;
/** Used inside this many other files, a view is a reusable part, unless the app also opens it as a page. */
const REUSED_IN_FILES = 3;
const SCREEN_NAME = /(Screen|Page|Scene|Route)$/;
const SCREEN_FOLDER = /\/(screens?|features?|scenes?|pages?|flows?)\//i;
/** Words that mark a part of a screen rather than a whole one. */
const COMPONENT_WORDS = new Set([
  "Row",
  "Cell",
  "Button",
  "Badge",
  "Icon",
  "Label",
  "Item",
  "Chip",
  "Avatar",
  "Header",
  "Footer",
  "Field",
  "Toggle",
  "Divider",
  "Tag",
  "Pill",
  "Toolbar",
  "Bar",
  "Card",
  "Tile",
]);

/** Each view as a screen or a component, with the score that decided it. */
export function classify(framework: FrameworkId, views: ViewFacts[]): ScreenRef[] {
  return views.map((view) => {
    const score = screenScore(view);
    return {
      id: `${framework}:${view.file}#${view.name}`,
      framework,
      name: view.name,
      file: view.file,
      line: view.line,
      kind: score >= SCREEN_THRESHOLD ? "screen" : "component",
      score,
    };
  });
}

function screenScore(view: ViewFacts): number {
  let score = Math.min(WEIGHT.pageElements, view.pageElements) + nameScore(view.name);
  if (SCREEN_FOLDER.test(`/${view.file}`)) score += WEIGHT.screenFolder;
  if (view.bodyLines > LONG_BODY_LINES) score += WEIGHT.longBody;
  if (view.presented) score += WEIGHT.presented;
  else if (view.routed) score += WEIGHT.routed;
  else if (view.childFiles >= REUSED_IN_FILES) score += WEIGHT.reused;
  return score;
}

/** `ProfileScreen` points to a screen; `PlanRow` and `AvatarView` to a component, `StatusRowText` less so. */
function nameScore(name: string): number {
  if (SCREEN_NAME.test(name)) return WEIGHT.screenName;
  const words = name.match(/[A-Z][a-z0-9]*/g) ?? [];
  if (words.at(-1) === "View") words.pop();
  if (COMPONENT_WORDS.has(words.at(-1) ?? "")) return WEIGHT.componentEnding;
  return words.some((w) => COMPONENT_WORDS.has(w)) ? WEIGHT.componentWord : 0;
}
