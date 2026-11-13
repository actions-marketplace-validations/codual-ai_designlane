import { FRAMEWORK_NAMES, type FrameworkScan, type Opening, type ScreenLink } from "../scan/types.js";

/** How each opening reads in a sentence. */
export const OPENING_WORDS: Record<Opening, string> = {
  push: "pushed",
  sheet: "sheet",
  dialog: "dialog",
  fullScreen: "full screen",
  popover: "popover",
  tab: "tab",
  replace: "replaces",
  pane: "pane beside",
};

export interface NamedLink extends ScreenLink {
  fromName: string;
  toName: string;
}

/** Every link between screens, with the names of the screens at each end. */
export function namedLinks(frameworks: FrameworkScan[]): NamedLink[] {
  return frameworks.flatMap(({ screens, links = [] }) => {
    const nameOf = new Map(screens.map((s) => [s.id, s.name]));
    return links.map((l) => ({
      ...l,
      fromName: nameOf.get(l.from) ?? l.from,
      toName: nameOf.get(l.to) ?? l.to,
    }));
  });
}

/** What a reader of the links should also know, as sentences: where the app starts, navigation that couldn't be tied to
 * two screens, and frameworks whose links aren't read. */
export function linkNotes(frameworks: FrameworkScan[]): string[] {
  const starts = frameworks.flatMap(({ screens, starts = [] }) => {
    const nameOf = new Map(screens.map((s) => [s.id, s.name]));
    return starts.map((id) => nameOf.get(id) ?? id);
  });
  const unresolved = frameworks.reduce((sum, f) => sum + (f.unresolvedLinks ?? 0), 0);
  // Both frameworks read links today; the next one (React Native) may not at first.
  const unread = frameworks.filter((f) => !f.links).map((f) => FRAMEWORK_NAMES[f.framework]);
  return [
    starts.length ? `The app starts on ${[...new Set(starts)].join(", ")}.` : "",
    unresolved
      ? `${unresolved} navigation call${unresolved === 1 ? "" : "s"} couldn't be tied to two screens (a screen from a library, say), so some links may be missing.`
      : "",
    unread.length ? `Links between screens aren't read for ${unread.join(" or ")} yet.` : "",
  ].filter(Boolean);
}
