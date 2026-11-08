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
export const byNumber = (a: number, b: number) => a - b;
