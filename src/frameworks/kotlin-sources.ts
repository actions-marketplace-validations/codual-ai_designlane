import { isTestPath } from "../scan/test-paths.js";
import { kotlinCodeOnly } from "./kotlin-source.js";
import type { ScanContext } from "./plugin.js";
import { type BracketTree, bracketTree } from "./source-text.js";

export interface KotlinSource {
  rel: string;
  text: string;
  /** The text with comments, strings and characters blanked out. */
  code: string;
  /** Uses Jetpack Compose (or Compose Multiplatform). */
  compose: boolean;
}

const COMPOSE_IMPORT = /\bimport\s+(?:androidx\.compose|org\.jetbrains\.compose)\./;

/** Every non-test Kotlin file, read once, with comments and strings blanked out. */
export async function kotlinSources(ctx: ScanContext): Promise<KotlinSource[]> {
  const out: KotlinSource[] = [];
  for (const f of ctx.files.filter((f) => f.rel.endsWith(".kt") && !isTestPath(f.rel))) {
    const text = await ctx.read(f);
    if (!text) continue;
    const code = kotlinCodeOnly(text);
    out.push({ rel: f.rel, text, code, compose: COMPOSE_IMPORT.test(code) });
  }
  return out;
}

const trees = new WeakMap<KotlinSource, BracketTree>();

/** The source's brackets, matched once for every reader. */
export function treeOf(source: KotlinSource): BracketTree {
  let tree = trees.get(source);
  if (!tree) {
    tree = bracketTree(source.code);
    trees.set(source, tree);
  }
  return tree;
}
