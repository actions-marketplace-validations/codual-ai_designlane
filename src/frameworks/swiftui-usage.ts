import {
  type BracketTree,
  bracketTree,
  type CallOwner,
  HEADER_CHARS,
  identifierBefore,
  ownerOf,
  skipSpaceBack,
} from "./swift-source.js";

/**
 * How an app shows each of its views, read from the bracket structure of its code (comments and strings blanked). A view the app opens
 * as a page (a sheet, cover, popover, navigation destination, tab, window, hosting root or navigation router) is a
 * screen, wherever it's declared; a view that many other files place inside themselves is a component.
 */

export interface ViewUsage {
  /** Opened as a page somewhere. */
  presented: boolean;
  /** Returned from a switch that isn't clearly a navigation router: a weaker sign of a page. */
  routed: boolean;
  /** Distinct files that place it inside another view. */
  childFiles: number;
}

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
/** Arguments whose value the app opens as a page: `NavigationLink(destination: Page())`. */
const PRESENTING_ARGUMENTS = new Set(["destination", "rootView"]);
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
/** A switch over a value with one of these names, or inside a function with one, is a navigation router... */
const ROUTER_NAME = /route|destination|screen|page|tab|path|selection|section|content/i;
/** ...when it opens at least this many different views. */
const ROUTER_VIEWS = 3;
/** How many modifiers to read after a view when looking for `.tabItem`. */
const MAX_MODIFIERS = 20;
/** How far back to read for an argument's label, and how much of each modifier to read. */
const ARGUMENT_CHARS = 200;
const MODIFIER_CHARS = 120;
/** How many containers to look through around a view; real apps nest a few, hostile files nest thousands. */
const MAX_DEPTH = 8;

const CALL = /(?<![\w.])([A-Z]\w*)(?:<[^<>\n]{0,80}>)?(?:\.init)?\s*[({]/g;
/** How far back to read for `let x =` before a view. */
const ASSIGNMENT_CHARS = 120;
/** Trailing closures to step back over: `NavigationSplitView { } content: { } detail: { }` has three. */
const MAX_TRAILING_CLOSURES = 4;
/** `let page = Page(` or `lazy var page = Page(`: stored for later rather than placed in a layout. */
const ASSIGNED = /\b(?:let|var)\s+\w+\s*(?::[^=\n]*)?=\s*$/;
/** `struct Page(`-style declarations, read from the few characters before a name. */
const DECLARATION_CHARS = 20;
const DECLARATION = /\b(?:struct|class|extension|enum|protocol|actor|typealias)\s+$/;

/** Usage of every name in `views` across the blanked sources. `containers` are the app's own views that hold
 * other views (`NavigationTab { Page() }`), looked through like `NavigationStack`. Linear in the code size. */
export function viewUsages(
  sources: { rel: string; code: string }[],
  views: ReadonlySet<string>,
  containers: ReadonlySet<string> = new Set(),
) {
  const usages = new Map<string, ViewUsage>();
  const usage = (name: string) => {
    let found = usages.get(name);
    if (!found) {
      found = { presented: false, routed: false, childFiles: 0 };
      usages.set(name, found);
    }
    return found;
  };
  const childFiles = new Map<string, Set<string>>();
  const switches = new Map<string, { inPresenter: boolean; router: boolean; views: Set<string> }>();
  const app = { views, containers };
  for (const { rel, code } of sources) {
    // Built per file and dropped, rather than kept for every file, so memory stays flat on large apps.
    const tree = bracketTree(code);
    for (const m of code.matchAll(CALL)) {
      const name = m[1] ?? "";
      const at = m.index ?? 0;
      if (!views.has(name) || DECLARATION.test(code.slice(Math.max(0, at - DECLARATION_CHARS), at))) continue;
      const found = usage(name);
      const place = placeOf(code, tree, app, at, at + m[0].length - 1);
      if (place.kind === "presented") {
        found.presented = true;
      } else if (place.kind === "switch") {
        found.routed = true;
        const key = `${rel}:${place.open}`;
        let entry = switches.get(key);
        if (!entry) {
          const inPresenter = withinPresenter(code, tree, app, place.open);
          entry = { inPresenter, router: !inPresenter && isRouter(code, tree, place.open), views: new Set() };
          switches.set(key, entry);
        }
        entry.views.add(name);
      } else if (place.kind === "child") {
        childFiles.set(name, (childFiles.get(name) ?? new Set()).add(rel));
      }
    }
  }
  for (const { inPresenter, router, views: opened } of switches.values()) {
    if (inPresenter || (router && opened.size >= ROUTER_VIEWS))
      for (const name of opened) usage(name).presented = true;
  }
  for (const [name, files] of childFiles) usage(name).childFiles = files.size;
  return usages;
}

interface AppViews {
  views: ReadonlySet<string>;
  containers: ReadonlySet<string>;
}

/** "indirect": built in a helper (`var drafts: some View { Drafts() }`) or stored in a variable, so where it ends up
 * is unknown; it counts as neither a page nor an embedded part. A sheet that shows such a helper is missed. */
type Place =
  | { kind: "presented" }
  | { kind: "switch"; open: number }
  | { kind: "child" }
  | { kind: "indirect" };

/** What one surrounding bracket means for a view inside it. */
type Step = "presents" | "switch" | "indirect" | "passes" | "stops";

/** Where a view constructed at `at` (its own bracket at `bracket`) sits, walking out through its brackets.
 * Navigation containers, `if` blocks and app-specific wrappers (`StoreProvider { Home() }`) are looked through;
 * layout containers and the app's own views are not. */
function placeOf(code: string, tree: BracketTree, app: AppViews, at: number, bracket: number): Place {
  if (code[bracket] === "(" && hasTabItem(code, tree, bracket)) return { kind: "presented" };
  if (ASSIGNED.test(code.slice(Math.max(0, at - ASSIGNMENT_CHARS), at))) return { kind: "indirect" };
  let open = tree.enclosing[at] ?? -1;
  for (let depth = 0; open !== -1 && depth < MAX_DEPTH; depth++, open = tree.enclosing[open] ?? -1) {
    const step = stepThrough(code, tree, app, open, at);
    if (step === "presents") return { kind: "presented" };
    if (step === "switch") return { kind: "switch", open };
    if (step === "indirect") return { kind: "indirect" };
    if (step === "stops") return { kind: "child" };
  }
  return { kind: "child" };
}

/** A switch sits in a presenter's content, so each page it picks is presented: `.sheet { switch kind { … } }`. */
function withinPresenter(code: string, tree: BracketTree, app: AppViews, open: number): boolean {
  let up = tree.enclosing[open] ?? -1;
  for (let depth = 0; up !== -1 && depth < MAX_DEPTH; depth++, up = tree.enclosing[up] ?? -1) {
    const step = stepThrough(code, tree, app, up, open);
    if (step === "presents") return true;
    if (step !== "passes") return false;
  }
  return false;
}

/** What the bracket at `open` means for something inside it at `at`: it presents a page, is a switch, holds a
 * helper (indirect), can be looked through, or is a layout that makes the view a part. */
function stepThrough(code: string, tree: BracketTree, app: AppViews, open: number, at: number): Step {
  const owner = ownerOf(code, tree, open);
  if (code[open] === "(") {
    if (PRESENTING_ARGUMENTS.has(argumentLabel(code, open, at))) return "presents";
  } else if (owner.kind === "switch") {
    return "switch";
  } else if (owner.kind === "call" && opensPage(owner)) {
    return "presents";
  } else if (owner.kind === "labelled") {
    return CONTENT_LABELS.has(owner.label) && labelledContentOpensPage(code, tree, open)
      ? "presents"
      : "stops";
  } else if (owner.kind === "declaration") {
    return owner.name === "body" ? "stops" : "indirect";
  }
  if (owner.kind === "conditional") return "passes";
  if (owner.kind !== "call") return "stops";
  const looksThrough =
    TRANSPARENT.has(owner.name) || app.containers.has(owner.name) || isWrapper(owner.name, app.views);
  return looksThrough ? "passes" : "stops";
}

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
function isRouter(code: string, tree: BracketTree, open: number): boolean {
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
function hasTabItem(code: string, tree: BracketTree, open: number): boolean {
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
