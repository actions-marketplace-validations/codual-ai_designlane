import { byNumber, mostCommon } from "../scan/counting.js";
import { palette } from "../scan/palette.js";
import { typeScale } from "../scan/type-scale.js";
import { jsSources } from "./js-sources.js";
import type { FrameworkPlugin, ScanContext } from "./plugin.js";
import { rnColors } from "./rn-colors.js";
import { rnType } from "./rn-type.js";
import { TAILWIND_CONFIG, tailwindColors } from "./tailwind-colors.js";
import { type TailwindType, tailwindType } from "./tailwind-type.js";

/** Packages a React Native app depends on: React Native itself, or Expo, which brings it. */
const RN_PACKAGES = ["react-native", "expo"];

/** The folders of the project's React Native apps: each `package.json` depending on React Native or Expo. */
export async function reactNativeRoots(ctx: ScanContext): Promise<string[]> {
  return (await packages(ctx)).filter((p) => p.reactNative).map((p) => p.root);
}

/** Every package in the project, by its folder (`""` is the whole project), and whether it's a React Native app. */
async function packages(ctx: ScanContext): Promise<{ root: string; reactNative: boolean }[]> {
  const found: { root: string; reactNative: boolean }[] = [];
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
    found.push({
      root: file.rel === "package.json" ? "" : file.rel.slice(0, -"/package.json".length),
      reactNative: depends,
    });
  }
  return found;
}

/** Tool configs (`app.config.ts`, `babel.config.js`) aren't the app's styles; a Tailwind config is read on its own. */
const TOOL_CONFIG = /(?:^|\/)[\w-]+\.config\.[cm]?[jt]s$/;

/** Whether `rel` is in one of `roots` (`""` is the whole project). */
export const within = (rel: string, roots: string[]) =>
  roots.some((root) => root === "" || rel.startsWith(`${root}/`));

const ranked = (values: number[]) => mostCommon(values, byNumber).map(({ value }) => value);

/** React Native (and Expo): its colours, text styles, spacing and radii, from theme objects, Tailwind and styles. */
export const reactNative: FrameworkPlugin = {
  id: "react-native",
  platforms: ["react-native"],
  async scan(ctx) {
    const all = await packages(ctx);
    const roots = all.filter((p) => p.reactNative).map((p) => p.root);
    if (roots.length === 0) return undefined;
    const scripts = await jsSources(ctx);
    // A package of its own inside the app that isn't React Native (a web embed, a server) isn't the app; one whose
    // code imports React Native is (a local native module, which the app provides React Native to).
    const others = all
      .filter((p) => !p.reactNative && p.root !== "" && roots.some((r) => within(`${p.root}/`, [r])))
      .map((p) => p.root)
      .filter((o) => !scripts.some((s) => s.reactNative && within(s.rel, [o])));
    const sources = scripts.filter(
      (s) =>
        within(s.rel, roots) &&
        !within(s.rel, others) &&
        (!TOOL_CONFIG.test(s.rel) || TAILWIND_CONFIG.test(s.rel)),
    );
    if (!sources.some((s) => s.reactNative)) return undefined;
    const tailwind = await tailwindColors(ctx, sources);
    const theme = rnColors(sources, tailwind.files);
    const type = rnType(sources, tailwind.files);
    // Tailwind's classes only in an app using Tailwind: elsewhere `p-4` is just a string.
    const classes: TailwindType =
      tailwind.used || tailwind.named.length > 0
        ? tailwindType(sources, tailwind.fonts)
        : { uses: [], spacing: [], radii: [] };
    const scale = typeScale({ uses: [...type.uses, ...classes.uses], helperFonts: type.helperFonts });
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
        typeStyles: [...type.named, ...scale.typeStyles].sort(
          (a, b) => b.uses - a.uses || a.name.localeCompare(b.name),
        ),
        fonts: scale.fonts,
        spacing: ranked([...type.spacing, ...classes.spacing]),
        radii: ranked([...type.radii, ...classes.radii]),
      },
    };
  },
};
