/**
 * SwiftUI views a UIKit or AppKit app shows through a hosting controller: `UIHostingController(rootView: Page())`, a
 * subclass's `super.init(rootView: Page())`, a view built first and hosted later (`let page = Page(…)` then
 * `UIHostingController(rootView: page)`), or a property typed `UIHostingController<Page>`. Whether a hosted view is a
 * page depends on what the code does with its controller: presented, pushed, shown or returned, or filling a
 * controller as its only child, it's a page; added as one of several children, or hosted inside a UIKit view, cell
 * or bar, it's part of one. Files that only import UIKit are read too, since that's where most hosting is.
 */

import { firstAtOrAfter } from "../scan/sorted.js";
import { expressionAt } from "./swift-expressions.js";
import { type SwiftTokens, swiftTokens } from "./swift-tokens.js";
import type { SwiftSource } from "./swiftui-sources.js";

export interface Hosting {
  name: string;
  /** The file that hosts it. */
  file: string;
  /** Shown as a page of its own rather than as part of one. */
  asPage: boolean;
}

/** UIKit types that are always part of a page: a SwiftUI view hosted inside one is a component. */
const PART_OF_PAGE = /(?:View|Cell|Bar|Button|Label|Control)$/;
/** Hosts that are views by definition: `NSHostingView(rootView:)`. */
const VIEW_HOSTS = /HostingView$/;
const TYPE_KEYWORDS = new Set(["class", "struct", "extension", "enum", "actor"]);
/** Words after `class` that make it a member (`class func make()`), not a type. */
const MEMBER_WORDS = new Set([
  "func",
  "var",
  "let",
  "static",
  "override",
  "final",
  "private",
  "public",
  "internal",
]);
/** How many brackets out from a hosting site its type is looked for, and how many superclasses up a class is followed. */
const MAX_OWNER_DEPTH = 16;
/** How far back from a `{` a type's declaration header can start. */
const MAX_HEADER_TOKENS = 64;
/** How far into a hosting root a wrapped view (`Provider { Page() }`) is looked for. */
const MAX_ROOT_TOKENS = 64;

/** `class Banner: UIView`: a class and what it inherits from, so an `extension Banner` knows it's a view too. One
 * optional space-run per gap, so a long run of spaces can't be split two ways. */
const CLASS_HEADER = /\bclass\s+([A-Za-z_]\w*)\s*(?:<[^<>{\n]{0,80}>\s*)?:\s*([A-Za-z_][\w.]*)/g;

/** Every hosted view among `views`, with whether it's shown as a page. `containers` are the app's views that hold
 * other views (`Shell { Page() }`); the page is the view inside one. */
export function hostedViews(
  sources: SwiftSource[],
  views: ReadonlySet<string>,
  containers: ReadonlySet<string> = new Set(),
): Hosting[] {
  const superclasses = new Map<string, string>();
  for (const { code } of sources) {
    for (const m of code.matchAll(CLASS_HEADER)) {
      superclasses.set(m[1] ?? "", (m[2] ?? "").split(".").at(-1) ?? "");
    }
  }
  const files = new Map<SwiftSource, SwiftTokens>();
  for (const source of sources) {
    if (/Hosting|rootView|addChild/.test(source.code)) files.set(source, swiftTokens(source.text));
  }
  const children = new Map<string, Children>();
  for (const file of files.values()) addChildrenOf(file, children);
  const app: App = { views, containers, superclasses, children };
  const found: Hosting[] = [];
  for (const [source, file] of files) {
    if (!/Hosting|rootView/.test(source.code)) continue;
    for (const { name, asPage } of hostingSites(file, app)) found.push({ name, file: source.rel, asPage });
  }
  return found;
}

interface App {
  views: ReadonlySet<string>;
  containers: ReadonlySet<string>;
  /** Each class's superclass, across the app. */
  superclasses: ReadonlyMap<string, string>;
  /** The child controllers each type adds, across the app (its extensions in other files included). */
  children: ReadonlyMap<string, Children>;
}

/** How many child controllers a type adds, and the properties it adds. */
interface Children {
  count: number;
  added: Set<string>;
}

/** Each view hosted in `file`, and whether it's shown as a page. */
function hostingSites(file: SwiftTokens, app: App): { name: string; asPage: boolean }[] {
  const { tokens } = file;
  const assigned = assignments(file);
  const addedHere = addChildSites(file);
  const sites: { name: string; asPage: boolean }[] = [];
  tokens.forEach((token, i) => {
    let name: string | undefined;
    // `rootView: Page(…)`, `rootView: Provider { Page() }` or `rootView: page`.
    if (token.text === "rootView" && tokens[i + 1]?.text === ":") {
      const value = expressionAt(file, tokens[i + 2]?.start ?? file.text.length);
      name =
        value?.kind === "name"
          ? lastAssigned(assigned, value.name, token.start)
          : value && firstView(file, i + 2, value.end, app);
    }
    // `UIHostingController<Page>`, `let hosting: SelfSizingHostingController<Page>`, but not a cast's type,
    // `as? UIHostingController<Row>`, which names a controller made elsewhere.
    else if (
      token.text.endsWith("HostingController") &&
      tokens[i + 1]?.text === "<" &&
      // `UIHostingController<Page>?` reads as one `>?`.
      tokens[i + 3]?.text.startsWith(">") &&
      !isCast(file, i)
    ) {
      name = tokens[i + 2]?.text;
    }
    if (name && app.views.has(name)) sites.push({ name, asPage: shownAsPage(file, i, app, addedHere) });
  });
  return sites;
}

function isCast(file: SwiftTokens, index: number): boolean {
  const before = file.tokens[index - 1]?.text;
  const previous = before === "?" || before === "!" ? file.tokens[index - 2]?.text : before;
  return previous === "as" || previous === "is";
}

/** The first of the app's views in the tokens from `from` up to offset `end`, past its own containers: the page
 * inside a hosting root. */
function firstView(file: SwiftTokens, from: number, end: number, app: App): string | undefined {
  for (let i = from; i < from + MAX_ROOT_TOKENS && (file.tokens[i]?.start ?? end) < end; i++) {
    const token = file.tokens[i];
    if (token?.kind === "name" && app.views.has(token.text) && !app.containers.has(token.text))
      return token.text;
  }
  return undefined;
}

/** Adds each `addChild(…)` in `file` to the type it's written in. */
function addChildrenOf(file: SwiftTokens, byType: Map<string, Children>): void {
  file.tokens.forEach((token, i) => {
    if (token.text !== "addChild" || file.tokens[i + 1]?.text !== "(") return;
    const type = typeAt(file, i);
    const children = byType.get(type) ?? { count: 0, added: new Set() };
    byType.set(type, children);
    children.count++;
    const added = childAdded(file, i);
    if (added) children.added.add(added);
  });
}

/** Where in `file` each controller is added: the token indexes of `addChild(name)`, in order, by name. */
function addChildSites(file: SwiftTokens): Map<string, number[]> {
  const sites = new Map<string, number[]>();
  file.tokens.forEach((token, i) => {
    if (token.text !== "addChild" || file.tokens[i + 1]?.text !== "(") return;
    const added = childAdded(file, i);
    if (!added) return;
    const list = sites.get(added) ?? [];
    sites.set(added, list);
    list.push(i);
  });
  return sites;
}

/** The controller `addChild(…)` at token `index` adds, by name: `summary` for `summary` or `self.summary`. */
function childAdded(file: SwiftTokens, index: number): string | undefined {
  const e = expressionAt(file, file.tokens[index + 2]?.start ?? file.text.length);
  return e?.kind === "name" || e?.kind === "member" ? e.name : undefined;
}

/** Whether the hosting written at token `index` shows its view as a page. */
function shownAsPage(file: SwiftTokens, index: number, app: App, addedHere: Map<string, number[]>): boolean {
  const type = typeAt(file, index);
  // A UIKit class (`class Card: UIView`, an extension of one, or a subclass of one), never a SwiftUI struct
  // conforming to `View`.
  if (isPartOfPage(type, app.superclasses)) return false;
  const host = hostCall(file, index);
  if (host && VIEW_HOSTS.test(host)) return false;
  const holder = holderOf(file, index);
  if (!holder) return true;
  const { count, added } = app.children.get(type) ?? { count: 0, added: new Set<string>() };
  // Presented, pushed or returned rather than added as a child, or the only child filling its controller: a page.
  // One child among several: a section.
  if (count <= 1) return true;
  if (holder.kind === "inPlace") return false;
  if (holder.kind === "property") return !added.has(holder.name);
  // A local variable is added if an `addChild` of its name falls inside its own block.
  const sites = addedHere.get(holder.name) ?? [];
  const inBlock = sites[firstAtOrAfter(sites, holder.block)];
  return inBlock === undefined || inBlock > (file.match[holder.block] ?? -1);
}

function isPartOfPage(type: string, superclasses: ReadonlyMap<string, string>): boolean {
  let current = superclasses.get(type);
  for (let depth = 0; current && depth < MAX_OWNER_DEPTH; depth++, current = superclasses.get(current)) {
    if (PART_OF_PAGE.test(current)) return true;
  }
  return false;
}

/** The name of the call the token at `index` is an argument of: `UIHostingController` in `UIHostingController(rootView:`. */
function hostCall(file: SwiftTokens, index: number): string | undefined {
  const open = file.enclosing[index] ?? -1;
  return file.tokens[open]?.text === "(" ? file.tokens[open - 1]?.text : undefined;
}

/** Where a hosting controller is kept: made in place inside `addChild(…)`, in a property, or in a local variable of
 * the block (`{` index) it's declared in. */
type Holder =
  | { kind: "inPlace" }
  | { kind: "property"; name: string }
  | { kind: "local"; name: string; block: number };

/** Where the hosting controller written at token `index` is kept: `hosting` in `let hosting = UIHostingController(…)`,
 * `self.hosting = …` or `let hosting: UIHostingController<Page>`. One built in a closure that initializes a property,
 * `lazy var hosting = { let c = UIHostingController(…); return c }()`, is kept in that property. */
function holderOf(file: SwiftTokens, index: number): Holder | undefined {
  const { tokens } = file;
  const open = file.enclosing[index] ?? -1;
  const start = tokens[open]?.text === "(" ? open - 1 : index;
  const outer = file.enclosing[start] ?? -1;
  if (tokens[outer]?.text === "(" && tokens[outer - 1]?.text === "addChild") return { kind: "inPlace" };
  if (tokens[start - 1]?.text === ":") {
    const name = tokens[start - 2];
    return name?.kind === "name" ? { kind: "property", name: name.text } : undefined;
  }
  return assignedAt(file, start);
}

/** The variable that the value starting at token `start`, just after an `=`, is assigned to. */
function assignedAt(file: SwiftTokens, start: number, inClosure = true): Holder | undefined {
  const { tokens } = file;
  if (tokens[start - 1]?.text !== "=") return undefined;
  const block = file.enclosing[start] ?? -1;
  const inBody = tokens[block]?.text === "{" && !typeNameOf(file, block);
  // Built in a property's initializing closure, `= { … }()`: kept in that property. One level only.
  if (inClosure && inBody && tokens[block - 1]?.text === "=") {
    const property = assignedAt(file, block, false);
    if (property?.kind !== "local") return property;
  }
  // `let hosting: SomeType = …`: the name after the nearest `let` or `var`; otherwise the name just before `=`.
  for (let k = start - 2; k >= 0 && k >= start - MAX_HEADER_TOKENS; k--) {
    const text = tokens[k]?.text;
    const name = tokens[k + 1];
    if ((text === "let" || text === "var") && name?.kind === "name") {
      return inBody ? { kind: "local", name: name.text, block } : { kind: "property", name: name.text };
    }
    if (text === ";" || text === "{" || text === "}" || tokens[k + 1]?.newlineBefore) break;
  }
  const name = tokens[start - 2];
  return name?.kind === "name" ? { kind: "property", name: name.text } : undefined;
}

/** Each variable's `let page = Page(…)` and `var page: Page = Page(…)` in `file`, in order: where, and the view. */
interface Assignments {
  at: number[];
  built: string[];
}

function assignments(file: SwiftTokens): Map<string, Assignments> {
  const { tokens } = file;
  const found = new Map<string, Assignments>();
  tokens.forEach((token, i) => {
    if ((token.text !== "let" && token.text !== "var") || tokens[i + 1]?.kind !== "name") return;
    let equals = i + 2;
    if (tokens[equals]?.text === ":") equals += 2;
    if (tokens[equals]?.text !== "=") return;
    const callee = tokens[equals + 1];
    if (callee?.kind !== "name" || tokens[equals + 2]?.text !== "(") return;
    const name = tokens[i + 1]?.text ?? "";
    const list = found.get(name) ?? { at: [], built: [] };
    found.set(name, list);
    list.at.push(token.start);
    list.built.push(callee.text);
  });
  return found;
}

/** The view `name` was last built as before offset `at`. */
function lastAssigned(assigned: Map<string, Assignments>, name: string, at: number): string | undefined {
  const list = assigned.get(name);
  return list?.built[firstAtOrAfter(list.at, at) - 1];
}

/** The name of the nearest type around the token at `index` (for an extension, the type it extends), or empty. */
function typeAt(file: SwiftTokens, index: number): string {
  let open = file.enclosing[index] ?? -1;
  for (let depth = 0; open !== -1 && depth < MAX_OWNER_DEPTH; depth++, open = file.enclosing[open] ?? -1) {
    const name = file.tokens[open]?.text === "{" ? typeNameOf(file, open) : undefined;
    if (name) return name;
  }
  return "";
}

/** The type whose body the `{` at `brace` opens, if it's a type's: `final class Card: UIView {`, `extension Card {`. */
function typeNameOf(file: SwiftTokens, brace: number): string | undefined {
  for (let k = brace - 1; k >= 0 && k >= brace - MAX_HEADER_TOKENS; k--) {
    const token = file.tokens[k];
    if (!token || token.text === "{" || token.text === "}") return undefined;
    const next = file.tokens[k + 1];
    if (!TYPE_KEYWORDS.has(token.text) || next?.kind !== "name" || MEMBER_WORDS.has(next.text)) continue;
    // `extension SwiftUI.Banner`: the type is the last part of its name.
    let name = k + 1;
    while (file.tokens[name + 1]?.text === "." && file.tokens[name + 2]?.kind === "name") name += 2;
    return file.tokens[name]?.text;
  }
  return undefined;
}
