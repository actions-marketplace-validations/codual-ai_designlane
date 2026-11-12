import type { ScanResult } from "./types.js";

/** What to do about a theme the app reads from a library outside the project, in a sentence, or undefined. */
export function themesOutsideNote(scan: Pick<ScanResult, "frameworks">): string | undefined {
  const themes = [...new Set(scan.frameworks.flatMap((f) => f.themesOutside ?? []))];
  if (!themes.length) return undefined;
  const names = themes.map((t) => `\`${t}\``).join(" and ");
  const one = themes.length === 1;
  return (
    `This app's theme (${names}) is defined outside this project, so its colours and text styles aren't here. ` +
    `Run Designmap on the repo that defines ${one ? "it" : "them"}, and connect the Figma plugin there.`
  );
}

/** What a navigation library Designmap doesn't read means for the result, in a sentence, or undefined. */
function navigationNotReadNote(scan: Pick<ScanResult, "frameworks">): string | undefined {
  const libraries = [...new Set(scan.frameworks.flatMap((f) => f.navigationNotRead ?? []))];
  if (!libraries.length) return undefined;
  return (
    `This app moves between screens with ${libraries.join(" and ")}, which Designmap doesn't read yet: its screens ` +
    "are found by what they contain, and the links between them aren't listed."
  );
}

/** Everything a reader of the scan should know about what it couldn't see, as sentences. */
export const scanNotes = (scan: Pick<ScanResult, "frameworks">) =>
  [themesOutsideNote(scan), navigationNotReadNote(scan)].filter((note) => note !== undefined);
