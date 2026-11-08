/**
 * How an app shows each of its views, read from the bracket structure of code Swift code. A view the app opens
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

/** Closures whose content the app opens as a page: `.sheet { Page() }`, `WindowGroup { Page() }`. */
const PRESENTING_CLOSURES = new Set([
  "sheet",
  "fullScreenCover",
  "popover",
  "navigationDestination",
  "WindowGroup",
  "Tab",
]);
/** Arguments whose value the app opens as a page: `NavigationLink(destination: Page())`. */
const PRESENTING_ARGUMENTS = new Set(["destination", "rootView"]);
/** Containers that don't change what a view is: `case .home: NavigationStack { Home() }`. */
const TRANSPARENT = new Set(["NavigationStack", "NavigationView", "AnyView", "Group"]);
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
  "ScrollView",
  "ForEach",
  "Form",
  "Section",
  "GeometryReader",
  "ViewThatFits",
  "Button",
  "Menu",
  "TabView",
  "NavigationSplitView",
  "HSplitView",
  "VSplitView",
]);
/** A switch over a value with one of these names, or inside a function with one, is a navigation router... */
const ROUTER_NAME = /route|destination|screen|page|tab|path|selection|section|content/i;
/** ...when it opens at least this many different views. */
const ROUTER_VIEWS = 3;
/** How far back to read for the code that owns a bracket, so hostile input stays fast. */
const HEADER_CHARS = 400;
const MAX_MODIFIERS = 20;
/** How many containers to look through around a view; real apps nest a few, hostile files nest thousands. */
const MAX_DEPTH = 8;

const CALL = /(?<![\w.])([A-Z]\w*)(?:<[^<>\n]{0,80}>)?(?:\.init)?\s*[({]/g;
const DECLARATION = /\b(?:struct|class|extension|enum|protocol|actor|typealias)\s+$/;

/** Usage of every name in `views` across the code sources. `containers` are the app's own views that hold
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
  const switches = new Map<string, { router: boolean; views: Set<string> }>();
  for (const { rel, code } of sources) {
    const tree = bracketTree(code);
    for (const m of code.matchAll(CALL)) {
      const name = m[1] ?? "";
      const at = m.index ?? 0;
      if (!views.has(name) || DECLARATION.test(code.slice(Math.max(0, at - 20), at))) continue;
      const place = placeOf(code, tree, { views, containers }, at, at + m[0].length - 1);
      if (place.kind === "presented") {
        usage(name).presented = true;
      } else if (place.kind === "switch") {
        usage(name).routed = true;
        const key = `${rel}:${place.open}`;
        const entry = switches.get(key) ?? {
          router: isRouter(code, tree, place.open),
          views: new Set<string>(),
        };
        entry.views.add(name);
        switches.set(key, entry);
      } else {
        usage(name);
        childFiles.set(name, (childFiles.get(name) ?? new Set()).add(rel));
      }
    }
  }
  for (const { router, views: opened } of switches.values()) {
    if (router && opened.size >= ROUTER_VIEWS) for (const name of opened) usage(name).presented = true;
  }
  for (const [name, files] of childFiles) usage(name).childFiles = files.size;
  return usages;
}

interface AppViews {
  views: ReadonlySet<string>;
  containers: ReadonlySet<string>;
}

type Place = { kind: "presented" } | { kind: "switch"; open: number } | { kind: "child" };

/** Where a view constructed at `at` (its own bracket at `bracket`) sits: in a presenter, a switch, or a view.
 * Navigation containers, `if` blocks and app-specific wrappers (`StoreProvider { Home() }`) are looked through;
 * layout containers and the app's own views are not. */
function placeOf(code: string, tree: BracketTree, app: AppViews, at: number, bracket: number): Place {
  if (code[bracket] === "(" && hasTabItem(code, tree, bracket)) return { kind: "presented" };
  let open = tree.enclosing[at] ?? -1;
  for (let depth = 0; open !== -1 && depth < MAX_DEPTH; depth++, open = tree.enclosing[open] ?? -1) {
    const owner = ownerOf(code, tree, open);
    if (code[open] === "(") {
      if (PRESENTING_ARGUMENTS.has(argumentLabel(code, open, at))) return { kind: "presented" };
    } else if (owner.kind === "switch") {
      return { kind: "switch", open };
    } else if (owner.kind === "call" && opensPage(owner)) {
      return { kind: "presented" };
    }
    const passesThrough =
      owner.kind === "conditional" ||
      (owner.kind === "call" &&
        (TRANSPARENT.has(owner.name) || app.containers.has(owner.name) || isWrapper(owner.name, app.views)));
    if (!passesThrough) return { kind: "child" };
  }
  return { kind: "child" };
}

/** An app-specific container such as a store or theme provider: a type that is neither layout nor one of the
 * app's views. Lowercase names are modifiers or functions, which don't wrap. */
const isWrapper = (name: string, views: ReadonlySet<string>) =>
  /^[A-Z]/.test(name) && !LAYOUT.has(name) && !views.has(name);

/** A trailing closure that is the page itself: `.sheet { … }`, or `NavigationLink { … }` with no arguments, whose
 * first closure is the destination (with arguments, the closure is the link's label). */
const opensPage = (owner: CallOwner) =>
  PRESENTING_CLOSURES.has(owner.name) || (owner.name === "NavigationLink" && !owner.hasArguments);

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

type CallOwner = { kind: "call"; name: string; hasArguments: boolean };
type Owner =
  | CallOwner
  | { kind: "declaration"; name: string }
  | { kind: "switch" }
  | { kind: "conditional" }
  | { kind: "labelled" };

/** What a bracket belongs to: a call (`sheet`, `NavigationStack`), a function or property, a switch, an `if`, or a
 * labelled closure (`label: {`). */
function ownerOf(code: string, tree: BracketTree, open: number): Owner {
  const end = skipSpaceBack(code, open);
  if (code[open] === "{") {
    const header = code.slice(Math.max(0, end - HEADER_CHARS), end);
    if (/\bswitch\b[^{}]*$/.test(header)) return { kind: "switch" };
    if (/\b(?:if|else|guard)\b[^{}]*$/.test(header)) return { kind: "conditional" };
    const declaration = header.match(/\b(?:func|var)\s+(\w+)[^{}]*$/)?.[1];
    if (declaration) return { kind: "declaration", name: declaration };
    if (header.endsWith(":")) return { kind: "labelled" };
  }
  const callOpen = code[open] === "{" && code[end - 1] === ")" ? (tree.openOf.get(end - 1) ?? -1) : -1;
  return {
    kind: "call",
    name: identifierBefore(code, callOpen === -1 ? end : callOpen),
    hasArguments: callOpen !== -1,
  };
}

const skipSpaceBack = (code: string, end: number) => {
  let j = end;
  while (j > 0 && /\s/.test(code[j - 1] ?? "")) j--;
  return j;
};

/** The word just before `end`, ignoring whitespace: `sheet` in `.sheet (`. */
function identifierBefore(code: string, end: number): string {
  const stop = skipSpaceBack(code, end);
  let start = stop;
  while (start > 0 && /\w/.test(code[start - 1] ?? "")) start--;
  return code.slice(start, stop);
}

/** The label of the argument holding `at` in the call opened at `open`, from at most 200 characters back:
 * `destination` for `NavigationLink(destination: Page())`. */
function argumentLabel(code: string, open: number, at: number): string {
  const text = code.slice(Math.max(open + 1, at - 200), at);
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
    const m = /^\s*\.(\w+)\s*([({])?/.exec(code.slice(j, j + 120));
    if (!m) return false;
    if (m[1] === "tabItem") return true;
    j += m[0].length;
    if (m[2]) j = (tree.closeOf.get(j - 1) ?? code.length) + 1;
  }
  return false;
}

interface BracketTree {
  /** For every offset, the `(` or `{` it sits directly inside, or -1. */
  enclosing: Int32Array;
  closeOf: Map<number, number>;
  openOf: Map<number, number>;
}

function bracketTree(code: string): BracketTree {
  const enclosing = new Int32Array(code.length).fill(-1);
  const closeOf = new Map<number, number>();
  const openOf = new Map<number, number>();
  const stack: number[] = [];
  for (let j = 0; j < code.length; j++) {
    const c = code[j];
    enclosing[j] = stack.at(-1) ?? -1;
    if (c === "(" || c === "{") {
      stack.push(j);
    } else if (c === ")" || c === "}") {
      const open = stack.pop();
      if (open === undefined) continue;
      closeOf.set(open, j);
      openOf.set(j, open);
    }
  }
  return { enclosing, closeOf, openOf };
}
