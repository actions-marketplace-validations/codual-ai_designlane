/** An app's own SwiftUI router: the `case`s its switches open, and the navigation elsewhere that names them
 * (`navigate(to: .accountDetail(id))`, `path.append(.post)`, `NavigationLink(value: .post)`, `presentedSheet = .settings`). */

import type { Opening } from "../scan/types.js";
import { type BracketTree, identifierBefore } from "./source-text.js";

/** A place the code navigates to a router's case. */
export interface RouteCall {
  at: number;
  route: string;
  /** How its wording says the page opens (`presentedSheet =`, `router.present(`); a push otherwise. */
  opening: Opening;
  /** The enum the call names (`RouterDestination` in `path.append(RouterDestination.post)`), when written. */
  type?: string;
}

/** A case name after a navigation call's `(`: `.post`, `to: .post`, `value: RouterDestination.post`. */
const CASE = String.raw`\(\s*(?:to:\s*|value:\s*)?(?:([A-Z]\w*)\.|\.)([a-z]\w*)\b`;
/** A method that navigates when called on a path, stack, router, navigator or coordinator: `path.append(.post)`. */
const METHOD_CALL = new RegExp(String.raw`\.(navigate|append|push|present|show|open)\s*${CASE}`, "g");
/** `navigate(to: .post)` on the view's own router, and `NavigationLink(value: .post)`. */
const PLAIN_CALL = new RegExp(String.raw`(?<![\w.])(?:navigate|NavigationLink)\s*${CASE}`, "g");
/** An assignment of a case: `presentedSheet = .settings`; not `==`, `!=`, `<=` or `>=`. */
const ASSIGNMENT = /(?<![=!<>])=\s*(?:([A-Z]\w*)\.|\.)([a-z]\w*)\b/g;
/** What a navigating method is called on. */
const NAVIGATOR = /(?:path|stack|router|navigator|coordinator)$/i;
/** Stacks that aren't navigation, though they're named like it. */
const NOT_NAVIGATOR = /^(?:undo|redo)/i;
/** What a navigating assignment sets: `presentedSheet`, `sheetDestination`, `route`; not `spreadsheetMode`. */
const DESTINATION_PROPERTY = /(?:Sheet|FullScreenCover|Destination|Route)$|^(?:sheet|destination|route)$/;
const FULL_SCREEN_PROPERTY = /FullScreenCover$/;
const SHEET_PROPERTY = /Sheet$|^sheet$/;
/** A written enum name that's a destination type: `RouterDestination`, `SheetRoute`, `AppScreen`; not `AnalyticsEvent`. */
const DESTINATION_TYPE = /(?:Destination|Route|Sheet|Screen|Tab|Path|Page)s?$/;
/** How far back an assignment is read for a declaration or a type annotation before it. */
const DECLARATION_CHARS = 200;
/** A declaration's or a parameter's value, not an assignment: `var destination = .x`, `: RouterDestination = .x`,
 * `sheet: SheetDestination = .about`. */
const DECLARED = /(?:\b(?:var|let)\s+\w+|:\s*[\w.]+)\s*$/;

/** Every place `code` navigates to one of `routes`. */
export function routeCalls(code: string, routes: ReadonlySet<string>): RouteCall[] {
  const isKnownRoute = (type: string | undefined, route: string | undefined): route is string =>
    route !== undefined && routes.has(route) && (type === undefined || DESTINATION_TYPE.test(type));
  const calls: RouteCall[] = [];
  for (const m of code.matchAll(METHOD_CALL)) {
    const receiver = identifierBefore(code, m.index ?? 0);
    const onNavigator = m[1] === "navigate" || (NAVIGATOR.test(receiver) && !NOT_NAVIGATOR.test(receiver));
    if (onNavigator && isKnownRoute(m[2], m[3]))
      calls.push(call(m.index ?? 0, m[3], m[1] === "present" ? "sheet" : "push", m[2]));
  }
  for (const m of code.matchAll(PLAIN_CALL))
    if (isKnownRoute(m[1], m[2])) calls.push(call(m.index ?? 0, m[2], "push", m[1]));
  for (const m of code.matchAll(ASSIGNMENT)) {
    const at = m.index ?? 0;
    const property = identifierBefore(code, at);
    const declared = DECLARED.test(code.slice(Math.max(0, at - DECLARATION_CHARS), at));
    if (DESTINATION_PROPERTY.test(property) && !declared && isKnownRoute(m[1], m[2]))
      calls.push(call(at, m[2], assignedOpening(property), m[1]));
  }
  return calls.sort((a, b) => a.at - b.at);
}

const assignedOpening = (property: string): Opening =>
  FULL_SCREEN_PROPERTY.test(property) ? "fullScreen" : SHEET_PROPERTY.test(property) ? "sheet" : "push";

const call = (at: number, route: string, opening: Opening, type: string | undefined): RouteCall => ({
  at,
  route,
  opening,
  ...(type && { type }),
});

/** How far back a switch case's label is read from the view it opens. */
const MAX_CASE_HEAD = 400;
/** A switch's label, ending in `:` (not `if case .loaded = state`, not a `.default` argument). */
const LABEL =
  /(?<![\w.])(?:case\s+(?:let\s+)?((?:\.[a-z]\w*(?:\([^()]*\))?\s*,\s*)*\.[a-z]\w*)(?:\([^()]*\))?\s*:|default\s*:)/g;
/** Each case name in a label: `home` and `feed` in `.home, .feed(let id)`. */
const CASE_NAME = /\.([a-z]\w*)/g;

/** The enum cases a view in the switch at `switchOpen` is opened for: `["home", "feed"]` for
 * `case .home, .feed: Feed()`; none under `default:`. A nested switch's labels are its own. */
export function casesBefore(code: string, tree: BracketTree, switchOpen: number, at: number): string[] {
  const start = Math.max(switchOpen, at - MAX_CASE_HEAD);
  const own = [...code.slice(start, at).matchAll(LABEL)].filter(
    (m) => tree.enclosing[start + (m.index ?? 0)] === switchOpen,
  );
  const label = own.at(-1)?.[1];
  return label ? [...label.matchAll(CASE_NAME)].map((m) => m[1] ?? "") : [];
}

/** How much of each enclosing block's header is read for the enum a router switches over. */
const HEADER_CHARS = 300;
/** How many enclosing blocks are read for it. */
const MAX_HEADERS = 6;
const ROUTE_TYPE = /\b([A-Z]\w*)\.self\b|Binding<([A-Z]\w*)\??>|\(\s*\w+\s*:\s*([A-Z]\w*)\??\s*\)/g;

/** The enum a router switch at `switchOpen` picks between, read from the headers of the blocks holding it, nearest
 * first: `navigationDestination(for: RouterDestination.self) {`, `func withSheets(_ s: Binding<SheetDestination?>) … {`.
 * Not from a sibling presenter before it. */
export function routeTypeBefore(code: string, tree: BracketTree, switchOpen: number): string | undefined {
  let open = tree.enclosing[switchOpen] ?? -1;
  for (let n = 0; open !== -1 && n < MAX_HEADERS; n++, open = tree.enclosing[open] ?? -1) {
    if (code[open] !== "{") continue;
    const head = code.slice(Math.max(0, open - HEADER_CHARS), open);
    const header = head.slice(
      Math.max(head.lastIndexOf("{"), head.lastIndexOf("}"), head.lastIndexOf(";")) + 1,
    );
    const named = [...header.matchAll(ROUTE_TYPE)].at(-1);
    const type = named?.[1] ?? named?.[2] ?? named?.[3];
    if (type) return type;
  }
  return undefined;
}
