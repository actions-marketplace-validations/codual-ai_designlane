import { describe, expect, it } from "vitest";
import { fontFor, fromFigmaColor, toFigmaColor, weightOfStyle } from "../../figma-plugin/src/values.js";

describe("Figma values", () => {
  it("turns a token's colour into Figma's and back unchanged", () => {
    const color = { hex: "#3366e6", alpha: 0.5 };
    expect(toFigmaColor(color)).toEqual({ r: 0.2, g: 0.4, b: 230 / 255, a: 0.5 });
    expect(fromFigmaColor(toFigmaColor(color))).toEqual(color);
  });

  it("finds a font's style for a weight however the font spells it", () => {
    const families = new Map([
      ["SF Pro", ["Regular", "Semibold", "Bold"]],
      ["Inter", ["Regular", "Semi Bold"]],
      ["Mono", ["Regular", "Bold"]],
    ]);
    expect([
      fontFor({ family: "SF Pro", weight: 600 }, undefined, families).style,
      fontFor({ family: "Inter", weight: 600 }, undefined, families).style,
      fontFor({ family: "Mono", weight: 600 }, undefined, families).style,
    ]).toEqual(["Semibold", "Semi Bold", undefined]);
  });

  it("reads the weight a style name stands for, italic or not, and regular for a name it doesn't know", () => {
    expect([
      weightOfStyle("Semi Bold"),
      weightOfStyle("Bold Italic"),
      weightOfStyle("Condensed Black"),
    ]).toEqual([600, 700, 400]);
  });
});
