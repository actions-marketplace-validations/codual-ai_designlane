/**
 * How an app shows each of its views, read from the bracket structure of its code (comments and strings blanked).
 * A view the app opens as a page (a sheet, cover, popover, navigation destination, tab, window, hosting root or
 * navigation router) is a screen, wherever it's declared; a view that many other files place inside themselves is
 * a component. What each bracket means is decided in `swiftui-presenters.ts`; this file walks the code and counts.
 */

import { type BracketTree, bracketTree } from "./swift-source.js";
import { type AppViews, hasTabItem, isRouter, MAX_DEPTH, stepThrough } from "./swiftui-presenters.js";

export interface ViewUsage {
  /** Opened as a page somewhere. */
  presented: boolean;
  /** Returned from a switch that isn't clearly a navigation router: a weaker sign of a page. */
  routed: boolean;
  /** Distinct files that place it inside another view. */
  childFiles: number;
}

/** A navigation router (a switch over a route, tab or destination) must open at least this many views. */
const ROUTER_VIEWS = 3;
/** A capitalised name followed by `(` or `{` (with optional generics or `.init`): a possible view being built. */
const CALL = /(?<![\w.])([A-Z]\w*)(?:<[^<>\n]{0,80}>)?(?:\.init)?\s*[({]/g;
/** How far back to read for `let x =` before a view. */
const ASSIGNMENT_CHARS = 120;
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

/** "indirect": built in a helper (`var drafts: some View { Drafts() }`) or stored in a variable, so where it ends up
 * is unknown; it counts as neither a page nor an embedded part. A sheet that shows such a helper is missed. */
type Place =
  | { kind: "presented" }
  | { kind: "switch"; open: number }
  | { kind: "child" }
  | { kind: "indirect" };

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
