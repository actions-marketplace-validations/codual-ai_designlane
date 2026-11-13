/** Screens and links in apps built with Circuit: `Screen` classes, the views their UI factories draw, and presenters'
 * `goTo` and overlays. */

import { groupBy } from "../scan/counting.js";
import type { Opening } from "../scan/types.js";
import { type ComposableFunction, viewsByName } from "./compose-functions.js";
import type { Link } from "./compose-links.js";
import type { Destination } from "./compose-navigation.js";
import { callArguments } from "./kotlin-calls.js";
import { type KotlinSource, nearestTo, treeOf } from "./kotlin-sources.js";

const CIRCUIT_IMPORT = /\bimport\s+com\.slack\.circuit\./;
/** A class or object and the types it extends: `data object HomeScreen : Screen`. */
const TYPE = /\b(?:class|object|interface)\s+(\w+)(?:\s*<[^<>{}]*>)?(?:\s*\([^(){}]*\))?\s*:\s*([^{}=\n]+)/g;
const ABSTRACT = /\b(?:abstract|sealed|open)\s+class\s+(\w+)|\binterface\s+(\w+)/g;
/** How far a `Screen` may be from a screen class through the app's own base classes. */
const MAX_BASES = 6;
/** The navigator's `goTo` and `resetRoot`, and an overlay host showing a screen in a dialog or sheet. */
const GO_TO = /\.(goTo|resetRoot|showInDialog|showInBottomSheet)\s*\(/g;
const OPENED_BY: Record<string, Opening> = {
  goTo: "push",
  resetRoot: "replace",
  showInDialog: "dialog",
  showInBottomSheet: "sheet",
};
/** A factory branch for a screen, `is SettingsScreen ->`, or `SettingsScreen::class` in `@CircuitInject`. */
const MENTION = /\bis\s+(\w+)\s*->|\b(\w+)::class\b/g;
/** How far into a factory branch its view is looked for. */
const MAX_BRANCH = 600;

interface Mention {
  source: KotlinSource;
  at: number;
}

export function circuitScreens(
  sources: KotlinSource[],
  views: ComposableFunction[],
): { destinations: Destination[]; links: Link[] } {
  if (!sources.some((s) => CIRCUIT_IMPORT.test(s.code))) return { destinations: [], links: [] };
  const screens = screenClasses(sources);
  const byName = viewsByName(views);
  const mentioned = groupBy(mentions(sources, screens), (m) => m.name);
  const destinations: Destination[] = [];
  const presenters = new Map<Destination, Set<KotlinSource>>();
  for (const [name, declaredIn] of screens) {
    const found = mentioned.get(name) ?? [];
    const view = found.map((m) => viewInBranch(m, byName)).find((v) => v !== undefined);
    const destination: Destination = {
      key: name,
      path: name,
      opening: "push",
      source: declaredIn,
      ...(view && { view }),
    };
    destinations.push(destination);
    presenters.set(destination, new Set(found.map((m) => m.source)));
  }
  // A file whose branches name only one screen belongs to it: its presenter, whose navigation is that screen's.
  const screensIn = groupBy([...mentioned.values()].flat(), (m) => m.source);
  const onlyOne = (source: KotlinSource) => new Set(screensIn.get(source)?.map((m) => m.name)).size === 1;
  const byKey = new Map(destinations.map((d) => [d.key, d]));
  const links: Link[] = [];
  for (const [from, files] of presenters) {
    for (const source of [...files].filter(onlyOne)) {
      for (const m of source.code.matchAll(GO_TO)) {
        const open = (m.index ?? 0) + m[0].length - 1;
        const target = callArguments(source, open).args[0]?.value.match(/^[A-Za-z_][\w.]*/)?.[0];
        const to = target ? byKey.get(target.split(".").at(-1) ?? "") : undefined;
        // A presenter opening its own screen again (a related show's details) is a real link.
        if (to)
          links.push({
            from,
            fromView: from.view,
            to,
            opening: OPENED_BY[m[1] ?? ""] ?? "push",
            source,
            at: open,
          });
      }
    }
  }
  // A screen opened both from its presenter and as an overlay is shown as the overlay.
  const overlay = (l: Link) => l.opening === "dialog" || l.opening === "sheet";
  const overlaid = new Set(links.filter(overlay).map((l) => `${l.from.key}>${l.to.key}`));
  return {
    destinations,
    links: links.filter((l) => overlay(l) || !overlaid.has(`${l.from.key}>${l.to.key}`)),
  };
}

/** Every concrete Circuit `Screen` class, through the app's own base classes, with its declaring file. */
function screenClasses(sources: KotlinSource[]): Map<string, KotlinSource> {
  const bases = new Map<string, Set<string>>();
  const declaredIn = new Map<string, KotlinSource>();
  const abstract = new Set<string>();
  for (const source of sources) {
    for (const m of source.code.matchAll(TYPE)) {
      const name = m[1] ?? "";
      const own = bases.get(name) ?? new Set<string>();
      for (const base of (m[2] ?? "").split(","))
        own.add(
          base
            .trim()
            .replace(/[(<][\s\S]*$/, "")
            .split(".")
            .at(-1) ?? "",
        );
      bases.set(name, own);
      if (!declaredIn.has(name)) declaredIn.set(name, source);
    }
    for (const m of source.code.matchAll(ABSTRACT)) abstract.add(m[1] ?? m[2] ?? "");
  }
  // Each type's answer once; past MAX_BASES it's unknown, and not taken for a screen.
  const known = new Map<string, boolean>();
  const isScreen = (name: string, depth: number): boolean => {
    const cached = known.get(name);
    if (cached !== undefined) return cached;
    if (depth >= MAX_BASES) return false;
    known.set(name, false);
    const answer = [...(bases.get(name) ?? [])].some((b) => b === "Screen" || isScreen(b, depth + 1));
    known.set(name, answer);
    return answer;
  };
  return new Map([...declaredIn].filter(([name]) => !abstract.has(name) && isScreen(name, 0)));
}

function mentions(
  sources: KotlinSource[],
  screens: Map<string, KotlinSource>,
): (Mention & { name: string })[] {
  return sources.flatMap((source) =>
    [...source.code.matchAll(MENTION)].flatMap((m) => {
      const name = m[1] ?? m[2] ?? "";
      return screens.has(name) ? [{ name, source, at: m.index ?? 0 }] : [];
    }),
  );
}

/** The first of the app's views called or declared after a screen's branch, within its block. */
function viewInBranch({ source, at }: Mention, byName: Map<string, ComposableFunction[]>) {
  const { enclosing, closeOf } = treeOf(source);
  const block = enclosing[at] ?? -1;
  const blockEnd = block === -1 ? source.code.length : (closeOf.get(block) ?? source.code.length);
  const end = Math.min(blockEnd, at + MAX_BRANCH);
  for (const m of source.code.slice(at, end).matchAll(/\bfun\s+([A-Z]\w*)\s*\(|(?<![\w.])([A-Z]\w*)\s*\(/g)) {
    const named = byName.get(m[1] ?? m[2] ?? "") ?? [];
    // A declared function is this one, in this file; a called view is the nearest of that name.
    const view = m[1] ? named.find((v) => v.source === source) : nearestTo(named, source, (v) => v.source);
    if (view) return view;
  }
  return undefined;
}
