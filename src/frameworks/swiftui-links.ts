/** Which SwiftUI view opens which: each presentation joined to the view whose code makes it, links through the app's
 * router, which views hold which, and the app's starts. */

import { groupBy } from "../scan/counting.js";
import type { Opening } from "../scan/types.js";
import type { ViewLink, ViewPlacement, ViewRef } from "./plugin.js";
import { lineNumbers } from "./source-text.js";
import { type ClassDecl, classes, type StructDecl } from "./swift-source.js";
import { openingOf } from "./swiftui-presenters.js";
import { type RouteCall, routeCalls } from "./swiftui-routes.js";
import type { Presentation } from "./swiftui-usage.js";
import { distinctLinks, viewKey } from "./view-links.js";

/** A SwiftUI view where it's declared. */
export interface DeclaredView {
  view: StructDecl;
  rel: string;
  line: number;
}

type Source = { rel: string; code: string };

/** A place in a file where a view is named: presented, placed, or navigated to through the router. */
interface Mention {
  at: number;
}

/** Presenters that start the app rather than open a page from another. */
const STARTS = new Set(["WindowGroup"]);

export interface SwiftLinks {
  links: ViewLink[];
  starts: ViewRef[];
  placements: ViewPlacement[];
  unresolvedLinks: number;
}

export function swiftLinks(
  presentations: Presentation[],
  placed: { name: string; rel: string; at: number }[],
  declared: DeclaredView[],
  /** Every Swift file: a view model's navigation may sit in one that doesn't import SwiftUI. */
  sources: Source[],
): SwiftLinks {
  const byName = groupBy(declared, (d) => d.view.name);
  const inFile = groupBy(declared, (d) => d.rel);
  const codeOf = new Map(sources.map((s) => [s.rel, s.code]));
  const links: ViewLink[] = [];
  const starts: ViewRef[] = [];
  let unresolvedLinks = 0;
  for (const [rel, list] of groupBy(presentations, (p) => p.rel)) {
    eachInFile(rel, list, inFile, codeOf, (p, from, line) => {
      const to = target(byName.get(p.name) ?? [], rel);
      if (STARTS.has(p.by)) {
        if (to) starts.push(refOf(to));
        return;
      }
      const opening = openingOf(p.by);
      // A router written outside any view is opened wherever navigation names its case (see `routeLinks`).
      if (!from && p.routes) return;
      if (!opening || !to || !from) {
        // A widget's configuration isn't navigation; anything else that can't be tied to two views is counted.
        if (opening || !/Configuration$/.test(p.by)) unresolvedLinks++;
        return;
      }
      links.push({ from: refOf(from), to: refOf(to), opening, file: rel, line });
    });
  }
  const placements: ViewPlacement[] = [];
  for (const [rel, list] of groupBy(placed, (p) => p.rel)) {
    eachInFile(rel, list, inFile, codeOf, (p, holder) => {
      const view = target(byName.get(p.name) ?? [], rel);
      if (view && holder && view !== holder) placements.push({ view: refOf(view), in: refOf(holder) });
    });
  }
  const routed = routeLinks(routesOf(presentations, byName), inFile, codeOf, sources);
  return {
    links: distinctLinks([...links, ...routed.links]),
    starts: [...new Map(starts.map((s) => [viewKey(s), s])).values()],
    placements,
    unresolvedLinks: unresolvedLinks + routed.unresolved,
  };
}

/** Calls `visit` for each mention in a file, in order, with the innermost view whose body holds it and its line. */
function eachInFile<M extends Mention>(
  rel: string,
  mentions: M[],
  inFile: Map<string, DeclaredView[]>,
  codeOf: Map<string, string>,
  visit: (mention: M, view: DeclaredView | undefined, line: number) => void,
): void {
  const sorted = [...mentions].sort((a, b) => a.at - b.at);
  const lines = lineNumbers(
    codeOf.get(rel) ?? "",
    sorted.map((m) => m.at),
  );
  const views = innermostViews(inFile.get(rel) ?? [], sorted);
  sorted.forEach((m, i) => {
    visit(m, views[i], lines[i] ?? 1);
  });
}

interface Route {
  to: DeclaredView;
  opening: Opening;
  type?: string;
}

/** The pages each `case` of a navigation router opens (not a tab switch, not a window), by case name. */
function routesOf(presentations: Presentation[], byName: Map<string, DeclaredView[]>): Map<string, Route[]> {
  const routes = new Map<string, Route[]>();
  for (const presentation of presentations) {
    const opening = openingOf(presentation.by);
    const to = target(byName.get(presentation.name) ?? [], presentation.rel);
    if (!presentation.routes || !to || !opening || opening === "tab") continue;
    for (const route of presentation.routes) {
      const list = routes.get(route) ?? [];
      list.push({ to, opening, ...(presentation.routeType && { type: presentation.routeType }) });
      routes.set(route, list);
    }
  }
  // A case showing a page inside the app's own wrapper (`NavigationSheet { AboutView() }`) opens the page.
  for (const [route, list] of routes) {
    const pages = list.filter((r) => !r.to.view.holdsViews);
    if (pages.length > 0 && pages.length < list.length) routes.set(route, pages);
  }
  return routes;
}

/** Links through the app's router: every navigation call naming one of its cases, from the view making it. */
function routeLinks(
  routes: Map<string, Route[]>,
  inFile: Map<string, DeclaredView[]>,
  codeOf: Map<string, string>,
  sources: Source[],
): { links: ViewLink[]; unresolved: number } {
  if (routes.size === 0) return { links: [], unresolved: 0 };
  const names = new Set(routes.keys());
  const holders = viewModelHolders(inFile, codeOf);
  const links: ViewLink[] = [];
  let unresolved = 0;
  for (const { rel, code } of sources) {
    const calls = routeCalls(code, names);
    if (calls.length === 0) continue;
    const models = classes(code);
    eachInFile(rel, calls, inFile, codeOf, (call, view, line) => {
      const route = routeFor(call, routes.get(call.route) ?? []);
      const callers = view ? [view] : modelCallers(code, rel, call.at, models, holders);
      if (callers.length === 0 || !route) {
        unresolved++;
        return;
      }
      for (const caller of callers)
        links.push({ from: refOf(caller), to: refOf(route.to), opening: route.opening, file: rel, line });
    });
  }
  return { links, unresolved };
}

/** A class that is the app's navigation itself, by its name or its own `NavigationPath`. */
const ROUTER_CLASS = /(?:Router|RouterPath|Navigator|Coordinator|NavigationState)$/;
const OWN_PATH = /\bvar\s+path\s*(?::|=)|\bNavigationPath\s*\(/;

/** The views a call in a view model is made from: the views holding the model. A router's own methods are made from
 * wherever they're called, which isn't read. */
function modelCallers(
  code: string,
  rel: string,
  at: number,
  models: ClassDecl[],
  holders: (model: ClassDecl, rel: string) => DeclaredView[],
): DeclaredView[] {
  const model = models.findLast((c) => c.open < at && at < c.close);
  if (!model || ROUTER_CLASS.test(model.name) || OWN_PATH.test(code.slice(model.open, model.close)))
    return [];
  return holders(model, rel);
}

/** The case a call names: in the router whose enum the call writes, opening the way the call's wording says; none
 * when that still leaves two different pages. */
function routeFor(call: RouteCall, candidates: Route[]): Route | undefined {
  const typed = call.type ? candidates.filter((r) => r.type === call.type) : [];
  const pool = typed.length > 0 ? typed : candidates.filter((r) => !call.type || !r.type);
  const worded = pool.filter((r) => r.opening === call.opening);
  const picked = worded.length > 0 ? worded : pool;
  const pages = new Set(picked.map((r) => `${viewKey(refOf(r.to))}:${r.opening}`));
  return pages.size === 1 ? picked[0] : undefined;
}

/** How many views may hold one view model before it's taken as shared app state rather than a view's own. */
const MAX_HOLDERS = 3;
/** A view's property of a class: `@State private var viewModel: StatusRowViewModel`, `let model = Model(`. */
const PROPERTY =
  /(@(?:State|StateObject)\s+(?:\w+\s+)?)?\b(?:var|let)\s+\w+\s*(?::\s*([A-Z]\w*)\b|=\s*([A-Z]\w*)\s*\()/g;

interface Holder {
  view: DeclaredView;
  owns: boolean;
}

/** The views holding each view model, indexed once: those owning it as state when any do (the parts it's passed down
 * to don't), and those in the model's own file when any are (two files' `private class Model` are different classes);
 * none when so many hold it that it's app state. A model declared in a view, or its extension, is that view's. */
function viewModelHolders(inFile: Map<string, DeclaredView[]>, codeOf: Map<string, string>) {
  const byType = new Map<string, Holder[]>();
  for (const [rel, views] of inFile) {
    const code = codeOf.get(rel) ?? "";
    for (const view of views) {
      for (const m of code.slice(view.view.open, view.view.close).matchAll(PROPERTY)) {
        const type = m[2] ?? m[3] ?? "";
        const list = byType.get(type) ?? [];
        const holder = list.find((h) => h.view === view);
        if (holder) holder.owns ||= m[1] !== undefined;
        else list.push({ view, owns: m[1] !== undefined });
        byType.set(type, list);
      }
    }
  }
  const named = groupBy([...inFile.values()].flat(), (d) => d.view.name);
  return (model: ClassDecl, rel: string): DeclaredView[] => {
    if (model.outer) {
      const outer = named.get(model.outer) ?? [];
      const here = outer.filter((v) => v.rel === rel);
      return here.length > 0 ? here : outer.length === 1 ? outer : [];
    }
    const all = byType.get(model.name) ?? [];
    const here = all.filter((h) => h.view.rel === rel);
    const local = here.length > 0 ? here : all;
    const owners = local.filter((h) => h.owns);
    const chosen = (owners.length > 0 ? owners : local).map((h) => h.view);
    return chosen.length <= MAX_HOLDERS ? chosen : [];
  };
}

/** The view a mention names: the one in the same file, or the only one with that name. */
const target = (candidates: DeclaredView[], rel: string) =>
  candidates.find((d) => d.rel === rel) ?? (candidates.length === 1 ? candidates[0] : undefined);

const refOf = (d: DeclaredView): ViewRef => ({ name: d.view.name, file: d.rel, line: d.line });

/** For each place in a file (in order), the innermost view whose body holds it, found in one pass. */
function innermostViews(views: DeclaredView[], places: Mention[]): (DeclaredView | undefined)[] {
  const sorted = [...views].sort((a, b) => a.view.open - b.view.open);
  const open: DeclaredView[] = [];
  let next = 0;
  return places.map(({ at }) => {
    while (next < sorted.length && (sorted[next]?.view.open ?? Number.POSITIVE_INFINITY) < at) {
      const view = sorted[next++];
      if (!view) continue;
      while (open.length && (open.at(-1)?.view.close ?? 0) < view.view.open) open.pop();
      open.push(view);
    }
    while (open.length && (open.at(-1)?.view.close ?? 0) < at) open.pop();
    return open.at(-1);
  });
}
