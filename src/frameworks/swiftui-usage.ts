/**
 * How an app shows each of its views, read from the bracket structure of its code (comments and strings blanked).
 * A view the app opens as a page (a sheet, cover, popover, navigation destination, tab, window, hosting root or
 * navigation router) is a screen, wherever it's declared; a view that many other files place inside themselves is
 * a component. What each bracket means is decided in `swiftui-presenters.ts`; this file walks the code and counts.
 */

import { type BracketTree, bracketTree } from "./source-text.js";
import {
  type AppViews,
  hasTabItem,
  isRouter,
  MAX_DEPTH,
  presenterOf,
  stepThrough,
} from "./swiftui-presenters.js";
import { casesBefore, routeTypeBefore } from "./swiftui-routes.js";

/** One place the code opens a view as a page: where, and the presenter that opens it (`sheet`, `NavigationLink`,
 * `tabItem`, `WindowGroup`…), or `router` (`tabRouter` over a tab) for a switch that routes between pages. */
export interface Presentation {
  name: string;
  rel: string;
  at: number;
  by: string;
  /** The `case .accountDetail` labels a router switch opens it for, which navigation elsewhere names. */
  routes?: string[];
  /** The enum those cases belong to, when the switch's code names it (`navigationDestination(for: RouterDestination.self)`). */
  routeType?: string;
}

export interface ViewUsage {
  /** Opened as a page somewhere. */
  presented: boolean;
  /** Returned from a switch that isn't clearly a navigation router: a weaker sign of a page. */
  routed: boolean;
  /** The files that place it inside another view. */
  childIn: Set<string>;
}

/** A navigation router (a switch over a route, tab or destination) must open at least this many views. */
const ROUTER_VIEWS = 3;
/** A capitalised name followed by `(` or `{` (with optional generics or `.init`): a possible view being built, also
 * when named inside a namespace (`StatusEditor.MainView(`, the namespace in the first group). */
const CALL = /(?<![\w.])((?:[A-Z]\w*\.)*)([A-Z]\w*)(?:<[^<>\n]{0,80}>)?(?:\.init)?\s*[({]/g;
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
  const presentations: Presentation[] = [];
  /** Where each view is placed inside another, for crediting a part's links to its screen. */
  const placements: { name: string; rel: string; at: number }[] = [];
  const usage = (name: string) => {
    let found = usages.get(name);
    if (!found) {
      found = { presented: false, routed: false, childIn: new Set() };
      usages.set(name, found);
    }
    return found;
  };
  const switches = new Map<
    string,
    {
      inPresenter: string | undefined;
      router: boolean;
      /** Switches over a tab (`switch selectedTab`), so its pages are tabs. */
      overTab: boolean;
      views: Map<string, { name: string; at: number; routes: string[] }>;
      rel: string;
      routeType?: string;
    }
  >();
  const app = { views, containers };
  for (const { rel, code } of sources) {
    // Built per file and dropped, rather than kept for every file, so memory stays flat on large apps.
    const tree = bracketTree(code);
    for (const m of code.matchAll(CALL)) {
      const name = m[2] ?? "";
      // A namespaced name may be another type sharing a view's name (`AppConfig.Settings(id:)`), so it only counts
      // when something presents it, never as placing the view inside another.
      const namespaced = (m[1] ?? "") !== "";
      const at = m.index ?? 0;
      if (!views.has(name) || DECLARATION.test(code.slice(Math.max(0, at - DECLARATION_CHARS), at))) continue;
      const found = usage(name);
      const place = placeOf(code, tree, app, at, at + m[0].length - 1);
      if (place.kind === "presented") {
        found.presented = true;
        presentations.push({ name, rel, at, by: place.by });
      } else if (place.kind === "switch") {
        found.routed = true;
        const key = `${rel}:${place.open}`;
        let entry = switches.get(key);
        if (!entry) {
          const inPresenter = withinPresenter(code, tree, app, place.open);
          const router = !inPresenter && isRouter(code, tree, place.open);
          const header = code.slice(Math.max(0, place.open - SWITCH_HEAD), place.open);
          const overTab = TAB_VALUE.test(header.slice(header.lastIndexOf("switch") + "switch".length));
          const routeType = routeTypeBefore(code, tree, place.open);
          entry = { inPresenter, router, overTab, views: new Map(), rel, ...(routeType && { routeType }) };
          switches.set(key, entry);
        }
        // A router can show one view for several cases (`TimelineView` for `.hashTag` and `.list`): each counts.
        const routes = casesBefore(code, tree, place.open, at);
        const caseKey = `${name}|${routes.join(",")}`;
        if (!entry.views.has(caseKey)) entry.views.set(caseKey, { name, at, routes });
      } else if (place.kind === "child" && !namespaced) {
        found.childIn.add(rel);
        placements.push({ name, rel, at });
      }
    }
  }
  for (const { inPresenter, router, overTab, views: opened, rel, routeType } of switches.values()) {
    if (!inPresenter && !router) continue;
    const by = inPresenter ?? (overTab ? "tabRouter" : "router");
    // A router must open at least ROUTER_VIEWS different views, however many cases show each.
    if (!inPresenter && new Set([...opened.values()].map((v) => v.name)).size < ROUTER_VIEWS) continue;
    for (const { name, at, routes } of opened.values()) {
      usage(name).presented = true;
      presentations.push({
        name,
        rel,
        at,
        by,
        ...(routes.length > 0 && { routes }),
        ...(routeType && routes.length > 0 && { routeType }),
      });
    }
  }
  return { usages, presentations, placements };
}

/** How much of a switch's header is read for what it switches over. */
const SWITCH_HEAD = 200;
/** A switch over a tab: `selectedTab`, `tab`, `currentTab`, `tabSelection`; not `tableLayout`. */
const TAB_VALUE = /(?:\b[a-z]\w*Tab|\btabs?|\btabSelection)\s*$/;
/** "indirect": built in a helper (`var drafts: some View { Drafts() }`) or stored in a variable, so where it ends up
 * is unknown; it counts as neither a page nor an embedded part. A sheet that shows such a helper is missed. */
type Place =
  | { kind: "presented"; by: string }
  | { kind: "switch"; open: number }
  | { kind: "child" }
  | { kind: "indirect" };

/** Where a view constructed at `at` (its own bracket at `bracket`) sits, walking out through its brackets.
 * Navigation containers, `if` blocks and app-specific wrappers (`StoreProvider { Home() }`) are looked through;
 * layout containers and the app's own views are not. */
function placeOf(code: string, tree: BracketTree, app: AppViews, at: number, bracket: number): Place {
  if (code[bracket] === "(" && hasTabItem(code, tree, bracket)) return { kind: "presented", by: "tabItem" };
  if (ASSIGNED.test(code.slice(Math.max(0, at - ASSIGNMENT_CHARS), at))) return { kind: "indirect" };
  let open = tree.enclosing[at] ?? -1;
  for (let depth = 0; open !== -1 && depth < MAX_DEPTH; depth++, open = tree.enclosing[open] ?? -1) {
    const step = stepThrough(code, tree, app, open, at);
    if (step === "presents") return { kind: "presented", by: presenterOf(code, tree, open) };
    if (step === "switch") return { kind: "switch", open };
    if (step === "indirect") return { kind: "indirect" };
    if (step === "stops") return { kind: "child" };
  }
  return { kind: "child" };
}

/** The presenter whose content a switch sits in, so each page it picks is presented: `.sheet { switch kind { … } }`. */
function withinPresenter(code: string, tree: BracketTree, app: AppViews, open: number): string | undefined {
  let up = tree.enclosing[open] ?? -1;
  for (let depth = 0; up !== -1 && depth < MAX_DEPTH; depth++, up = tree.enclosing[up] ?? -1) {
    const step = stepThrough(code, tree, app, up, open);
    if (step === "presents") return presenterOf(code, tree, up);
    if (step !== "passes") return undefined;
  }
  return undefined;
}
