import { expect, it } from "vitest";
import { commonNumbers, normalizeHex, rgbToHex } from "../../src/scan/tokens.js";

it("normalizeHex accepts every hex form and drops an opaque alpha", () => {
  expect(normalizeHex("#ABC")).toBe("#aabbcc");
  expect(normalizeHex("abcd")).toBe("#aabbccdd");
  expect(normalizeHex("#112233ff")).toBe("#112233");
  expect(normalizeHex("#11223380")).toBe("#11223380");
  expect(normalizeHex("#12345")).toBeUndefined();
  expect(normalizeHex("red")).toBeUndefined();
});

it("rgbToHex takes 0–1 channels, clamps the rest, and drops an opaque alpha", () => {
  expect(rgbToHex(1, 0.5, 0)).toBe("#ff8000");
  expect(rgbToHex(1, 0.5, 0, 0.5)).toBe("#ff800080");
  expect(rgbToHex(2, -1, 0)).toBe("#ff0000");
  expect(rgbToHex(Number.NaN, 1, 1)).toBe("#00ffff");
});

it("commonNumbers returns the most common values in range, ties smallest first", () => {
  const texts = [".padding(16) .padding(8) .padding(16)", ".padding(8) .padding(200) .padding(0)"];
  expect(commonNumbers(texts, /padding\((\d+)\)/g)).toEqual([8, 16]);
});
