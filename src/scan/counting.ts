/** Each distinct value with how often it appears, most common first, ties in `compare` order. */
export function mostCommon<T>(
  values: Iterable<T>,
  compare: (a: T, b: T) => number,
): { value: T; count: number }[] {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || compare(a[0], b[0]))
    .map(([value, count]) => ({ value, count }));
}

export const byText = (a: string, b: string) => a.localeCompare(b);
/** Code-unit order, the same on every machine (unlike `localeCompare`, which follows the system's language). */
export const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export const byNumber = (a: number, b: number) => a - b;

/** `items` grouped by `keyOf`, each group in the items' order. */
export function groupBy<T, K>(items: Iterable<T>, keyOf: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

/** `n` with the word for one or for many: `1 use`, `2 uses`. */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
