/** Components whose code is mostly the same: merged, they'd be one place to fix and restyle. */

import type { ComponentInfo } from "../catalog/components.js";
import { byCode } from "../scan/counting.js";

type Summary = Pick<ComponentInfo, "name" | "file" | "line" | "uses">;

export interface DuplicatePair {
  framework: ComponentInfo["framework"];
  first: Summary;
  second: Summary;
  /** 0–1: the share of the two declarations' words they have in common. */
  similarity: number;
}

/** Words, numbers and strings of a declaration. */
const WORD = /[A-Za-z_]\w*|\d+(?:\.\d+)?|"[^"\n]*"|'[^'\n]*'/g;
/** Thin wrappers look alike by design; only declarations with at least this many distinct words are compared. */
const MIN_WORDS = 30;
export const DUPLICATE_SIMILARITY = 0.8;

interface Entry {
  c: ComponentInfo;
  words: Set<string>;
}

/** A declaration's distinct words, leaving out its own name so a renamed copy still matches. */
function wordsOf(c: ComponentInfo): Set<string> {
  return new Set([...c.source.matchAll(WORD)].map((m) => m[0]).filter((word) => word !== c.name));
}

const summary = ({ name, file, line, uses }: ComponentInfo): Summary => ({ name, file, line, uses });

/**
 * The pairs worth comparing, found by prefix filtering: with words ordered rarest first, two sets sharing at least
 * `DUPLICATE_SIMILARITY` of their words must share one of each set's first `size - ceil(similarity × size) + 1`
 * words. So only components sharing a rare word are compared, not every pair.
 */
function candidatePairs(pool: Entry[]): [Entry, Entry][] {
  const frequency = new Map<string, number>();
  for (const { words } of pool) for (const word of words) frequency.set(word, (frequency.get(word) ?? 0) + 1);
  const rarestFirst = (a: string, b: string) =>
    (frequency.get(a) ?? 0) - (frequency.get(b) ?? 0) || byCode(a, b);
  const holders = new Map<string, number[]>();
  const pairs = new Map<string, [Entry, Entry]>();
  for (const [i, entry] of pool.entries()) {
    const prefix = [...entry.words].sort(rarestFirst);
    prefix.length = entry.words.size - Math.ceil(DUPLICATE_SIMILARITY * entry.words.size) + 1;
    for (const word of prefix) {
      const earlier = holders.get(word) ?? [];
      for (const j of earlier) {
        const other = pool[j];
        if (other) pairs.set(`${j}:${i}`, [other, entry]);
      }
      earlier.push(i);
      holders.set(word, earlier);
    }
  }
  return [...pairs.values()];
}

/** Pairs of components in one framework, the same name or not, sharing at least `DUPLICATE_SIMILARITY` of their words,
 * most alike first. */
export function duplicates(components: ComponentInfo[]): DuplicatePair[] {
  const pool = components
    .filter((c) => c.kind === "component")
    .map((c) => ({ c, words: wordsOf(c) }))
    .filter(({ words }) => words.size >= MIN_WORDS);
  const out: DuplicatePair[] = [];
  for (const [a, b] of candidatePairs(pool)) {
    if (a.c.framework !== b.c.framework) continue;
    let shared = 0;
    for (const word of a.words) if (b.words.has(word)) shared++;
    const similarity = shared / (a.words.size + b.words.size - shared);
    if (similarity >= DUPLICATE_SIMILARITY)
      out.push({
        framework: a.c.framework,
        first: summary(a.c),
        second: summary(b.c),
        similarity: Math.round(similarity * 100) / 100,
      });
  }
  return out.sort(
    (x, y) =>
      y.similarity - x.similarity || byCode(x.first.name, y.first.name) || byCode(x.first.file, y.first.file),
  );
}
