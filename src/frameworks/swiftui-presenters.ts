/**
 * What a bracket means for a SwiftUI view inside it: whether the code around the view opens it as a page (a sheet,
 * a tab, a navigation destination…), passes it through (a navigation container, an `if`), or makes it part of a
 * larger view. `swiftui-usage.ts` walks out through a view's brackets and asks this file about each one.
 */

import {
  type BracketTree,
  type CallOwner,
  HEADER_CHARS,
  identifierBefore,
  type Owner,
  ownerOf,
  skipSpaceBack,
} from "./swift-source.js";

/** Closures whose content the app opens as a page: `.sheet { Page() }`, `WindowGroup { Page() }`, a split view's
 * columns, and the whole view of a widget or Live Activity. A plain `TabView`'s children only count with `.tabItem`
 * or inside `Tab`, since a paged `TabView` is usually a carousel inside a page. */
const PRESENTING_CLOSURES = new Set([
  "sheet",
  "fullScreenCover",
  "popover",
  "navigationDestination",
  "WindowGroup",
  "Tab",
  "NavigationSplitView",
  "StaticConfiguration",
  "AppIntentConfiguration",
  "IntentConfiguration",
  "ActivityConfiguration",
]);
/** App-specific presentation helpers: `.appSheet { Page() }`, `.customFullScreenCover { Page() }`. Not `*Cover`
 * alone, which apps also use for overlays (`.loadingCover`). */
const PRESENTING_HELPER = /^[a-z]\w*(?:Sheet|FullScreenCover)$/;
/** Labelled closures that hold a presenter's content: `StaticConfiguration(…, content: { Widget() })`. */
const CONTENT_LABELS = new Set(["content", "destination", "detail", "sidebar"]);
/** Arguments whose value the app opens as a page: `NavigationLink(destination: Page())`. A hosting controller's
 * `rootView:` is decided by what hosts it (`swiftui-hosting.ts`). */
const PRESENTING_ARGUMENTS = new Set(["destination"]);
/** Containers that don't change what a view is: `case .home: NavigationStack { Home() }`. */
const TRANSPARENT = new Set(["NavigationStack", "NavigationView", "AnyView", "Group", "ScrollView"]);
/** Layout containers: a view inside one is part of a larger view, not a page of its own. */
const LAYOUT = new Set([
  "VStack",
  "HStack",
  "ZStack",
  "LazyVStack",
  "LazyHStack",
  "LazyVGrid",
  "LazyHGrid",
  "Grid",
  "GridRow",
  "List",
  "ForEach",
  "Form",
  "Section",
  "GeometryReader",
  "ViewThatFits",
  "Button",
  "Menu",
  "HSplitView",
  "VSplitView",
]);
/** A switch over a value with one of these names, or inside a function with one, is a navigation router. */
const ROUTER_NAME = /route|destination|screen|page|tab|path|selection|section|content/i;
/** How many modifiers to read after a view when looking for `.tabItem`. */
const MAX_MODIFIERS = 20;
/** How far back to read for an argument's label, and how much of each modifier to read. */
const ARGUMENT_CHARS = 200;
const MODIFIER_CHARS = 120;
/** Trailing closures to step back over: `NavigationSplitView { } content: { } detail: { }` has three. */
const MAX_TRAILING_CLOSURES = 4;
/** How many containers to look through around a view; real apps nest a few, hostile files nest thousands. */
export const MAX_DEPTH = 8;

export interface AppViews {
  views: ReadonlySet<string>;
  containers: ReadonlySet<string>;
}

/** What one surrounding bracket means for a view inside it. */
export type Step = "presents" | "switch" | "indirect" | "passes" | "stops";

/** A bracket around a view, with what it belongs to. */
interface Bracket {
  code: string;
  tree: BracketTree;
  app: AppViews;
  /** The `(` or `{` itself. */
  open: number;
  /** Where the view inside it starts. */
  at: number;
  owner: Owner;
}

/** What a bracket means for a view inside it. Checked in order; the first rule that applies decides, and a bracket
 * no rule matches makes the view a part of whatever owns it. Only a `{` can belong to a switch, a label or a
 * declaration (`ownerOf` reports every `(` as a call), so those rules need no bracket check of their own. */
const RULES: { means: Step; when: (b: Bracket) => boolean }[] = [
  // `NavigationLink(destination: Page())`
  {
    means: "presents",
    when: (b) => b.code[b.open] === "(" && PRESENTING_ARGUMENTS.has(argumentLabel(b.code, b.open, b.at)),
  },
  // `switch tab { case .home: Home() }`: decided once per switch, by the caller
  { means: "switch", when: (b) => b.owner.kind === "switch" },
  // `.sheet { Page() }`, `Tab("Home") { Page() }`, `NavigationLink { Page() } label: { … }`
  { means: "presents", when: (b) => b.code[b.open] === "{" && b.owner.kind === "call" && opensPage(b.owner) },
  // `.sheet(item: $x, content: { Page() })`, `NavigationSplitView { … } detail: { Page() }`
  {
    means: "presents",
    when: (b) =>
      b.owner.kind === "labelled" &&
      CONTENT_LABELS.has(b.owner.label) &&
      labelledContentOpensPage(b.code, b.tree, b.open),
  },
  // any other labelled closure, such as a link's `label: { … }`
  { means: "stops", when: (b) => b.owner.kind === "labelled" },
  // `var body: some View { … }`: placed straight into a view
  { means: "stops", when: (b) => b.owner.kind === "declaration" && b.owner.name === "body" },
  // `var drafts: some View { Drafts() }`, `func detail() -> some View { … }`: a helper, so where the view ends up is
  // unknown
  { means: "indirect", when: (b) => b.owner.kind === "declaration" },
  // `if ready { … }`, `NavigationStack { … }`, `StoreProvider { … }`, the app's own `NavigationTab { … }`
  {
    means: "passes",
    when: (b) =>
      b.owner.kind === "conditional" || (b.owner.kind === "call" && looksThrough(b.owner.name, b.app)),
  },
];

export function stepThrough(code: string, tree: BracketTree, app: AppViews, open: number, at: number): Step {
  const bracket: Bracket = { code, tree, app, open, at, owner: ownerOf(code, tree, open) };
  return RULES.find((rule) => rule.when(bracket))?.means ?? "stops";
}

const looksThrough = (name: string, app: AppViews) =>
  TRANSPARENT.has(name) || app.containers.has(name) || isWrapper(name, app.views);

/** The labelled closure at `open` holds a presenter's content: an argument (`.sheet(item: $x, content: { … })`) or
 * a trailing closure after the presenter's first one (`NavigationSplitView { … } detail: { … }`). */
function labelledContentOpensPage(code: string, tree: BracketTree, open: number): boolean {
  const parent = tree.enclosing[open] ?? -1;
  if (parent !== -1 && code[parent] === "(") return presents(identifierBefore(code, parent));
  // Step back over earlier labelled closures (`content: { … }`) to the call that owns the first one.
  let closure = open;
  for (let n = 0; n < MAX_TRAILING_CLOSURES; n++) {
    const colon = skipSpaceBack(code, closure) - 1;
    const beforeLabel = skipSpaceBack(code, colon - identifierBefore(code, colon).length);
    const previous = tree.openOf.get(beforeLabel - 1);
    if (previous === undefined || code[previous] !== "{") return false;
    const owner = ownerOf(code, tree, previous);
    if (owner.kind === "call") return presents(owner.name);
    if (owner.kind !== "labelled") return false;
    closure = previous;
  }
  return false;
}

const presents = (name: string) => PRESENTING_CLOSURES.has(name) || PRESENTING_HELPER.test(name);

/** An app-specific container such as a store or theme provider: a type that is neither layout nor one of the
 * app's views. Lowercase names are modifiers or functions, which don't wrap. */
const isWrapper = (name: string, views: ReadonlySet<string>) =>
  /^[A-Z]/.test(name) && !LAYOUT.has(name) && !views.has(name);

/** A trailing closure that is the page itself: `.sheet { … }`, or `NavigationLink { … }` with no arguments, whose
 * first closure is the destination (with arguments, the closure is the link's label). */
const opensPage = (owner: CallOwner) =>
  presents(owner.name) || (owner.name === "NavigationLink" && !owner.hasArguments);

/** A switch over a navigation-named value, inside a navigation-named function, or inside `.navigationDestination`. */
export function isRouter(code: string, tree: BracketTree, open: number): boolean {
  const header = code.slice(Math.max(0, open - HEADER_CHARS), open);
  if (ROUTER_NAME.test(header.slice(header.lastIndexOf("switch")))) return true;
  let up = tree.enclosing[open] ?? -1;
  for (let depth = 0; up !== -1 && depth < MAX_DEPTH; depth++, up = tree.enclosing[up] ?? -1) {
    if (code[up] !== "{") continue;
    const owner = ownerOf(code, tree, up);
    if (owner.kind === "call" && owner.name === "navigationDestination") return true;
    if (owner.kind === "declaration") return ROUTER_NAME.test(owner.name);
  }
  return false;
}

/** The label of the argument holding `at` in the call opened at `open`, from at most `ARGUMENT_CHARS` back:
 * `destination` for `NavigationLink(destination: Page())`. */
function argumentLabel(code: string, open: number, at: number): string {
  const text = code.slice(Math.max(open + 1, at - ARGUMENT_CHARS), at);
  let depth = 0;
  let start = 0;
  for (let j = text.length - 1; j >= 0; j--) {
    const c = text[j];
    if (c === ")" || c === "}" || c === "]") depth++;
    else if (c === "(" || c === "{" || c === "[") depth--;
    else if (c === "," && depth === 0) {
      start = j + 1;
      break;
    }
  }
  return text.slice(start).match(/^\s*(\w+)\s*:/)?.[1] ?? "";
}

/** The view's modifier chain contains `.tabItem`: `Feed().environmentObject(s).tabItem { … }`. */
export function hasTabItem(code: string, tree: BracketTree, open: number): boolean {
  let j = (tree.closeOf.get(open) ?? code.length) + 1;
  for (let n = 0; n < MAX_MODIFIERS; n++) {
    const m = /^\s*\.(\w+)\s*([({])?/.exec(code.slice(j, j + MODIFIER_CHARS));
    if (!m) return false;
    if (m[1] === "tabItem") return true;
    j += m[0].length;
    if (m[2]) j = (tree.closeOf.get(j - 1) ?? code.length) + 1;
  }
  return false;
}
