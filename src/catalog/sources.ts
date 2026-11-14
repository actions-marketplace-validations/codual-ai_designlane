/** Each framework's source files, read once for the catalog and the drift report. */

import { jsCodeOnly } from "../frameworks/js-code.js";
import { type JsSource, jsSources } from "../frameworks/js-sources.js";
import { type KotlinSource, kotlinSources } from "../frameworks/kotlin-sources.js";
import type { ScanContext } from "../frameworks/plugin.js";
import { type SwiftSource, swiftSources } from "../frameworks/swiftui-sources.js";
import { createContext } from "../scan/index.js";
import type { FrameworkId, ScanResult } from "../scan/types.js";
import { perSource } from "./reader.js";

/** A source file as written and with its comments and strings blanked, at the same offsets. */
export interface CodeFile {
  rel: string;
  text: string;
  code: string;
}

export type FrameworkSources =
  | { framework: "swiftui"; files: SwiftSource[] }
  | { framework: "compose"; files: KotlinSource[] }
  | { framework: "react-native"; files: JsSource[] };

async function frameworkSources(ctx: ScanContext, framework: FrameworkId): Promise<FrameworkSources> {
  if (framework === "swiftui") return { framework, files: await swiftSources(ctx) };
  if (framework === "compose") return { framework, files: await kotlinSources(ctx) };
  return { framework, files: await jsSources(ctx) };
}

export type AppSources = ReadonlyMap<FrameworkId, FrameworkSources>;

/** The source files of every framework the scan found, read again from the app's folder. */
export async function readSources(scan: ScanResult): Promise<AppSources> {
  const ctx = await createContext(scan.root);
  const out = new Map<FrameworkId, FrameworkSources>();
  for (const f of scan.frameworks) out.set(f.framework, await frameworkSources(ctx, f.framework));
  return out;
}

const jsCodeOf = perSource((source: JsSource) => jsCodeOnly(source.file));

/** The files with their blanked code, for readers that need no more of a framework than that. */
export function codeFiles(sources: FrameworkSources): CodeFile[] {
  if (sources.framework === "react-native")
    return sources.files.map((f) => ({ rel: f.rel, text: f.text, code: jsCodeOf(f) }));
  return sources.files.map((f) => ({ rel: f.rel, text: f.text, code: f.code }));
}
