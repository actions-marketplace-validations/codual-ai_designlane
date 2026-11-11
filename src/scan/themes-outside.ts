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
