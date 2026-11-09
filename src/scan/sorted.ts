/** Searching numbers kept in ascending order. */

/** The index of the first of `sorted` at or after `target`, or `sorted.length` when there's none, by binary search. */
export function firstAtOrAfter(sorted: readonly number[], target: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((sorted[mid] ?? 0) < target) low = mid + 1;
    else high = mid;
  }
  return low;
}
