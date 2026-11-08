import { describe, expect, it } from "vitest";
import { scanRepo } from "../../src/scan/index.js";
import { tempDir } from "../helpers/temp.js";

/** Hostile input spread over files small enough to be read (files over 512 KB are skipped as generated). */
function inFiles(lines: string[], perFile: number): Record<string, string> {
  const files: Record<string, string> = {};
  for (let i = 0; i < lines.length; i += perFile)
    files[`App/Part${i}.swift`] = lines.slice(i, i + perFile).join("\n");
  return files;
}

async function tokens(code: string, extra: Record<string, string> = {}) {
  const root = await tempDir({ "App/Screen.swift": `import SwiftUI\n${code}`, ...extra });
  return (await scanRepo(root)).frameworks[0]!.tokens;
}

describe("colour values", () => {
  it("collects colours pasted inline, most used first", async () => {
    const { colors } = await tokens(
      [
        "a.foregroundColor(Color(red: 0.2, green: 0.4, blue: 0.9))",
        "b.foregroundColor(Color(red: 0.2, green: 0.4, blue: 0.9))",
        "c.background(Color(white: 0.5))",
        'd.fill(Color(hex: "#ff0000"))',
        "e.fill(Color(hex: 0x00ff00))",
        'f.fill(Color("#0000FF"))',
        "g.fill(UIColor(red: 1, green: 1, blue: 0, alpha: 1))",
      ].join("\n"),
    );
    expect(colors.map((c) => [c.name, c.kind, c.uses])).toEqual([
      ["#3366e6", "inline", 2],
      ["#0000ff", "inline", 1],
      ["#00ff00", "inline", 1],
      ["#808080", "inline", 1],
      ["#ff0000", "inline", 1],
      ["#ffff00", "inline", 1],
    ]);
  });

  it("merges near-identical shades into the most used one", async () => {
    const { colors } = await tokens(
      'a(Color(hex: "#3366E6"))\nb(Color(hex: "#3366E6"))\nc(Color(hex: "#3467E5"))',
    );
    expect(colors.map((c) => [c.light, c.uses])).toEqual([["#3366e6", 3]]);
  });

  it("reads eight-digit hex numbers opacity last, like hex text", async () => {
    const { colors } = await tokens("a(Color(hex: 0xFFFFFF80))\nb(Color(hex: 0x3366E6FF))");
    expect(colors.map((c) => c.light).sort()).toEqual(["#3366e6", "#ffffff80"]);
  });

  it("reads them opacity first when the app's hex helper takes opacity from the top byte", async () => {
    const helper =
      "extension Color { init(hex argb: UInt32) { let a = Double((argb & 0xFF000000) >> 24) / 255 } }";
    const { colors } = await tokens(`${helper}\na(Color(hex: 0xFF3366E6))\nb(Color(hex: 0x803366E6))`);
    expect(colors.map((c) => c.light).sort()).toEqual(["#3366e6", "#3366e680"]);
  });

  it("ignores .init(red:…) unless it's declared as a colour", async () => {
    const { colors } = await tokens(
      "let p: Point3 = .init(red: 1, green: 0, blue: 0)\nlet c: Color = .init(red: 1, green: 0, blue: 0)",
    );
    expect(colors.map((c) => c.name)).toEqual(["c"]);
  });

  it("reads colour literals, P3 and HSB colours, calls over several lines, and every modifier argument", async () => {
    const { colors, systemColors } = await tokens(
      [
        "a(Color(#colorLiteral(red: 1, green: 0, blue: 0, alpha: 1)))",
        "b(UIColor(displayP3Red: 0, green: 1, blue: 0, alpha: 1))",
        "c(Color(hue: 0.6667, saturation: 1, brightness: 1))",
        "d(Color(\n  red: 1,\n  green: 1,\n  blue: 0\n))",
        "e.foregroundStyle(.red, .blue)",
        "f.background(.green.opacity(0.5))",
      ].join("\n"),
    );
    expect(colors.map((c) => c.light).sort()).toEqual(["#0000ff", "#00ff00", "#ff0000", "#ffff00"]);
    expect(systemColors.map((c) => c.name)).toEqual(["blue", "green", "red"]);
  });

  it("reads eight-character hex text opacity first too when the app's helper does", async () => {
    const helper =
      "extension Color { init(hex: String) { (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF) } }";
    const { colors } = await tokens(`${helper}\na(Color(hex: "#803366E6"))\nb(Color(hex: "FF3366E6"))`);
    expect(colors.map((c) => c.light).sort()).toEqual(["#3366e6", "#3366e680"]);
  });

  it("ignores malformed numbers rather than producing a broken colour", async () => {
    const { colors } = await tokens(
      "a(Color(red: 1.2.3, green: 0, blue: 0))\nb(Color(white: ., opacity: 1))",
    );
    expect(colors.every((c) => /^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(c.light))).toBe(true);
  });
});

describe("named colours and references", () => {
  it("counts references to a named colour and pasted copies of its value as its uses", async () => {
    const { colors } = await tokens(
      [
        'extension Color { static let brand = Color(hex: "#3366E6") }',
        "a.foregroundColor(.brand)",
        "b.background(Color.brand)",
        'c.fill(Color(hex: "#3366E6"))',
      ].join("\n"),
    );
    expect(colors).toEqual([
      { name: "brand", light: "#3366e6", source: "App/Screen.swift", kind: "code", uses: 3 },
    ]);
  });

  it('links asset catalog colours to Color("…"), UIColor(named:) and generated accessors', async () => {
    const colorset = JSON.stringify({
      colors: [{ color: { components: { red: "1.000", green: "0.000", blue: "0.000" } } }],
    });
    const { colors } = await tokens(
      'a(Color("Brand"))\nb(UIColor(named: "Brand"))\nc(Asset.Colors.brand.swiftUIColor)',
      { "App/Assets.xcassets/Brand.colorset/Contents.json": colorset },
    );
    expect(colors.map((c) => [c.name, c.kind, c.uses])).toEqual([["Brand", "asset", 3]]);
  });

  it("counts Xcode's generated symbols for asset colours as uses", async () => {
    const colorset = JSON.stringify({
      colors: [{ color: { components: { red: "1.000", green: "0.000", blue: "0.000" } } }],
    });
    const { colors } = await tokens(
      "a.foregroundColor(.steamGold)\nb(Color.steamGold)\nc.foregroundColor(.primary)",
      {
        "App/Assets.xcassets/steam_gold.colorset/Contents.json": colorset,
      },
    );
    expect(colors.map((c) => [c.name, c.uses])).toEqual([["steam_gold", 2]]);
  });

  it("doesn't read an asset name made of hex letters as a hex colour", async () => {
    const { colors } = await tokens('a(Color("Face"))');
    expect(colors).toEqual([]);
  });

  it("doesn't count ordinary code that shares a colour's name", async () => {
    const { colors } = await tokens(
      [
        'let background = Color(hex: "#111111")',
        'let error = Color(hex: "#ee2222")',
        "a.background(Color.red)",
        "switch state { case .error: break }",
        "state = .error",
      ].join("\n"),
    );
    expect(colors.map((c) => [c.name, c.uses])).toEqual([
      ["background", 0],
      ["error", 0],
    ]);
  });

  it("names a colour declared through a wrapper, and keeps one name with two values", async () => {
    const { colors } = await tokens(
      [
        "static let brand = Color(UIColor(red: 1, green: 0, blue: 0, alpha: 1))",
        'enum Light { static let bg = Color(hex: "#ffffff") }',
        'enum Dark { static let bg = Color(hex: "#000000") }',
      ].join("\n"),
    );
    expect(colors.map((c) => [c.name, c.light])).toEqual([
      ["brand", "#ff0000"],
      ["bg", "#ffffff"],
      ["bg", "#000000"],
    ]);
  });

  it("doesn't treat a hex string as an asset name", async () => {
    const green = JSON.stringify({
      colors: [{ color: { components: { red: "0.000", green: "1.000", blue: "0.000" } } }],
    });
    const { colors } = await tokens('a(Color("#0000FF"))', {
      "App/Assets.xcassets/0000FF.colorset/Contents.json": green,
    });
    expect(colors.map((c) => [c.name, c.uses])).toEqual([
      ["#0000ff", 1],
      ["0000FF", 0],
    ]);
  });

  it("names a colour whose value is on the next line", async () => {
    const { colors } = await tokens('static let brand =\n  Color(hex: "#3366E6")');
    expect(colors.map((c) => c.name)).toEqual(["brand"]);
  });
});

describe("platform colours", () => {
  it("counts platform colours separately, by name", async () => {
    const { systemColors } = await tokens(
      [
        "a.foregroundColor(.red)",
        "b.foregroundStyle(Color.red)",
        "c.background(Color(.systemBackground))",
        "d.background(Color(uiColor: .secondaryLabel))",
        "e.tint(UIColor.systemBlue)",
        "f.background(.ultraThinMaterial)",
      ].join("\n"),
    );
    expect(systemColors).toEqual([
      { name: "red", uses: 2 },
      { name: "secondaryLabel", uses: 1 },
      { name: "systemBackground", uses: 1 },
      { name: "systemBlue", uses: 1 },
    ]);
  });

  it("lets an app colour named like a platform colour win", async () => {
    const accent = JSON.stringify({
      colors: [{ color: { components: { red: "0.000", green: "0.5", blue: "1.000" } } }],
    });
    const found = await tokens(
      'static let primary = Color(hex: "#3366E6")\na.foregroundColor(.primary)\nb.tint(.accentColor)',
      {
        "App/Assets.xcassets/AccentColor.colorset/Contents.json": accent,
      },
    );
    expect(found.colors.map((c) => [c.name, c.uses])).toEqual([
      ["AccentColor", 1],
      ["primary", 1],
    ]);
    expect(found.systemColors).toEqual([]);
  });

  it("keeps platform styles platform, even when an asset shares their name", async () => {
    const grey = JSON.stringify({ colors: [{ color: { components: { white: "0.4" } } }] });
    const found = await tokens("a.foregroundStyle(.secondary)", {
      "App/Assets.xcassets/secondary.colorset/Contents.json": grey,
    });
    expect(found.colors.map((c) => [c.name, c.uses])).toEqual([["secondary", 0]]);
    expect(found.systemColors).toEqual([{ name: "secondary", uses: 1 }]);
  });

  it("counts the colours of a gradient, on its own or inside a modifier, once each", async () => {
    const { colors, systemColors } = await tokens(
      [
        'extension Color { static let brand = Color(hex: "#3366E6") }',
        "LinearGradient(colors: [.pink, .purple], startPoint: .top, endPoint: .bottom)",
        "a.fill(LinearGradient(colors: [.pink, .brand], startPoint: .top, endPoint: .bottom))",
      ].join("\n"),
    );
    expect(systemColors).toEqual([
      { name: "pink", uses: 2 },
      { name: "purple", uses: 1 },
    ]);
    expect(colors.map((c) => [c.name, c.uses])).toEqual([["brand", 1]]);
  });

  it("doesn't let a local variable take over a platform colour", async () => {
    const { colors, systemColors } = await tokens(
      'func f() { let red = Color(hex: "#ee1111") }\na.foregroundColor(.red)',
    );
    expect(colors.map((c) => [c.name, c.uses])).toEqual([["red", 0]]);
    expect(systemColors).toEqual([{ name: "red", uses: 1 }]);
  });
});

describe("the palette", () => {
  it("keeps the palette short and says how many colours it left out", async () => {
    const lines = Array.from(
      { length: 45 },
      (_, i) => `x(Color(red: ${(i % 9) / 8}, green: ${Math.floor(i / 9) / 4}, blue: 0))`,
    );
    const { colors, colorsOmitted } = await tokens(lines.join("\n"));
    expect(colors).toHaveLength(40);
    expect(colorsOmitted).toBe(5);
  });
});

describe("hostile input", () => {
  it("stays fast with thousands of different pasted colours", async () => {
    const lines = Array.from(
      { length: 20_000 },
      (_, i) => `x(Color(hex: 0x${(i * 997).toString(16).padStart(6, "0")}))`,
    );
    const started = performance.now();
    await tokens("", inFiles(lines, 300));
    expect(performance.now() - started).toBeLessThan(3000);
  });

  it("stays fast with thousands of identical named colours and near matches", async () => {
    const named = Array.from({ length: 20_000 }, (_, i) => `let c${i} = Color(hex: "#000000")`);
    const near = Array.from({ length: 20_000 }, (_, i) => `x(Color(hex: "#0${i % 4}0000"))`);
    const started = performance.now();
    await tokens("", inFiles([...named, ...near], 5000));
    expect(performance.now() - started).toBeLessThan(3000);
  });

  it("stays fast when lines are padded with long runs of spaces", async () => {
    const lines = Array.from(
      { length: 2000 },
      () => `let a${" ".repeat(400)}${"x(Color(white: 0.5)) ".repeat(40)}`,
    );
    const started = performance.now();
    await tokens("", inFiles(lines, 300));
    expect(performance.now() - started).toBeLessThan(3000);
  });

  it("stays fast on a line full of assignments with no shift", async () => {
    const started = performance.now();
    await tokens("", { "App/Hostile.swift": "a = ".repeat(120_000) });
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
