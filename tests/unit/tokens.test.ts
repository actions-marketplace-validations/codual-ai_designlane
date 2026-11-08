import { expect, it } from "vitest";
import { commonNumbers, dedupeColors, normalizeHex, rgbToHex } from "../../src/scan/tokens.js";

it("normalizeHex accepts every hex form and drops an opaque alpha", () => {
  expect(normalizeHex("#ABC")).toBe("#aabbcc");
  expect(normalizeHex("abcd")).toBe("#aabbccdd");
  expect(normalizeHex("#112233ff")).toBe("#112233");
  expect(normalizeHex("#11223380")).toBe("#11223380");
  expect(normalizeHex("#12345")).toBeUndefined();
  expect(normalizeHex("red")).toBeUndefined();
});

it("rgbToHex accepts 0–1 floats, 0–255 integers and hex strings", () => {
  expect(rgbToHex(1, 0.5, 0)).toBe("#ff8000");
  expect(rgbToHex("255", "128", "0")).toBe("#ff8000");
  expect(rgbToHex("0xFF", "0x80", "0x00", 0.5)).toBe("#ff800080");
});

it("commonNumbers returns the most common values in range, ties smallest first", () => {
  const texts = [".padding(16) .padding(8) .padding(16)", ".padding(8) .padding(200) .padding(0)"];
  expect(commonNumbers(texts, /padding\((\d+)\)/g)).toEqual([8, 16]);
});

it("dedupeColors keeps the first colour of each name, ignoring case, up to the limit", () => {
  const color = (name: string, light: string) => ({ name, light, source: "a" });
  expect(
    dedupeColors([color("Brand", "#000000"), color("brand", "#ffffff"), color("Ink", "#111111")], 1),
  ).toEqual([color("Brand", "#000000")]);
});
