import type { KotlinSource } from "./kotlin-sources.js";

/** A theme object the code reads colours or type from (`CompanyTheme.colors.primary`) this often, declared nowhere in
 * the project, comes from a library. */
const MIN_USES = 3;
const THEME_READ = /(?<![\w.])([A-Z]\w*Theme)\.(?:colors|colorScheme|typography|materialColors)\.\w/g;
/** Android's own themes (Glance's, for widgets) aren't an app's design system. */
const PLATFORM_THEME_IMPORT = /\bimport\s+(?:androidx|android|com\.google\.android)\.[\w.]*\.(\w+Theme)\b/g;

/** The theme objects the code reads its design from that are defined outside the project. */
export function themesOutside(sources: KotlinSource[]): string[] {
  const inside = new Set<string>(["MaterialTheme"]);
  for (const { code } of sources) {
    for (const m of code.matchAll(/\b(?:object|class|interface)\s+(\w+)/g)) inside.add(m[1] ?? "");
    for (const m of code.matchAll(PLATFORM_THEME_IMPORT)) inside.add(m[1] ?? "");
  }
  const uses = new Map<string, number>();
  for (const { code } of sources) {
    for (const m of code.matchAll(THEME_READ)) {
      const name = m[1] ?? "";
      if (!inside.has(name)) uses.set(name, (uses.get(name) ?? 0) + 1);
    }
  }
  return [...uses].flatMap(([name, n]) => (n >= MIN_USES ? [name] : []));
}
