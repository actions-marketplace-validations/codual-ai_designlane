import { it } from "vitest";

/** What every speed test's name starts with, so `pnpm test` can run them apart (see package.json). */
export const SPEED = "speed:";

type Body<A extends unknown[] = []> = (...args: A) => void | Promise<void>;

/** A test that the code stays fast on hostile input. Speed tests run after the rest, one file at a time, so a busy
 * machine running other tests beside them can't make them fail. */
export const speedIt = Object.assign(
  (name: string, fn: Body, timeout?: number) => it(`${SPEED} ${name}`, fn, timeout),
  {
    each:
      <T extends unknown[]>(cases: readonly T[]) =>
      (name: string, fn: Body<T>, timeout?: number) =>
        it.each(cases)(`${SPEED} ${name}`, fn, timeout),
  },
);
