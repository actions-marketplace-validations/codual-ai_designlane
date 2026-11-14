import { type ComponentInfo, inventory } from "../../src/catalog/components.js";
import { readSources } from "../../src/catalog/sources.js";
import { scanRepo } from "../../src/scan/index.js";
import { tempDir } from "./temp.js";

/** The scan, the sources and the components of an app made of `files`. */
export async function catalogOf(files: Record<string, string>) {
  const scan = await scanRepo(await tempDir(files));
  const sources = await readSources(scan);
  return { scan, sources, components: inventory(scan, sources) };
}

/** The one component named `name`. */
export function named(components: ComponentInfo[], name: string): ComponentInfo {
  const found = components.find((c) => c.name === name);
  if (!found) throw new Error(`no component ${name}: ${components.map((c) => c.name).join(", ")}`);
  return found;
}

export const swift = (...lines: string[]) => ["import SwiftUI", ...lines].join("\n");
export const kotlin = (...lines: string[]) =>
  ["import androidx.compose.runtime.Composable", ...lines].join("\n");
export const tsx = (...lines: string[]) =>
  ['import { View, Text } from "react-native";', ...lines].join("\n");
export const RN_MANIFEST = { "package.json": '{ "dependencies": { "react-native": "0.76.0" } }' };
