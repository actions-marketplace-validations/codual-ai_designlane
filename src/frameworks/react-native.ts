import { palette } from "../scan/palette.js";
import { jsSources } from "./js-sources.js";
import type { FrameworkPlugin, ScanContext } from "./plugin.js";
import { rnColors } from "./rn-colors.js";
import { tailwindColors } from "./tailwind-colors.js";

/** Packages a React Native app depends on: React Native itself, or Expo, which brings it. */
const RN_PACKAGES = ["react-native", "expo"];

/** The folders of the project's React Native apps: each `package.json` depending on React Native or Expo. */
export async function reactNativeRoots(ctx: ScanContext): Promise<string[]> {
  const roots: string[] = [];
  for (const file of ctx.files.filter((f) => f.rel === "package.json" || f.rel.endsWith("/package.json"))) {
    const text = await ctx.read(file);
    let manifest: Record<string, unknown> | undefined;
    try {
      manifest = text ? JSON.parse(text) : undefined;
    } catch {
      continue;
    }
    const depends = ["dependencies", "devDependencies", "peerDependencies"].some((field) => {
      const deps = manifest?.[field];
      return typeof deps === "object" && deps !== null && RN_PACKAGES.some((p) => p in deps);
    });
    if (depends) roots.push(file.rel === "package.json" ? "" : file.rel.slice(0, -"/package.json".length));
  }
  return roots;
}

/** Whether `rel` is in one of `roots` (`""` is the whole project). */
export const within = (rel: string, roots: string[]) =>
  roots.some((root) => root === "" || rel.startsWith(`${root}/`));

/** React Native (and Expo): its colours, from theme objects, Tailwind and styles. */
export const reactNative: FrameworkPlugin = {
  id: "react-native",
  platforms: ["react-native"],
  async scan(ctx) {
    const roots = await reactNativeRoots(ctx);
    if (roots.length === 0) return undefined;
    const sources = (await jsSources(ctx)).filter((s) => within(s.rel, roots));
    if (!sources.some((s) => s.reactNative)) return undefined;
    const tailwind = await tailwindColors(ctx, sources);
    const theme = rnColors(sources, tailwind.files);
    // A JavaScript copy of a CSS theme's colours (`colors.charcoal[100]` beside `--color-charcoal-100`) is one colour.
    const inTailwind = new Set(tailwind.named.map((c) => `${c.name}|${c.light}`));
    return {
      views: [],
      ...(theme.otherThemes.length > 0 && { otherThemes: theme.otherThemes }),
      tokens: {
        ...palette({
          named: [...tailwind.named, ...theme.named.filter((c) => !inTailwind.has(`${c.name}|${c.light}`))],
          references: [...theme.references, ...tailwind.references],
          literals: theme.literals,
          system: theme.system,
        }),
        typeStyles: [],
        fonts: [],
        spacing: [],
        radii: [],
      },
    };
  },
};
