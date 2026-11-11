import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scanRepo, toDesignMd, toDesignTokens, writeOutputs } from "../../src/index.js";
import { colorValue } from "../../src/output/tokens-json.js";
import type { ColorToken, DesignTokens, ScanResult, TypeStyle } from "../../src/scan/types.js";
import { tempDir } from "../helpers/temp.js";

const APP = {
  "Shop/Theme.swift": [
    "import SwiftUI",
    "enum Theme {",
    "  static let brand = Color(red: 0.2, green: 0.4, blue: 0.9)",
    "  static let ink = Color(red: 0.1, green: 0.1, blue: 0.1, opacity: 0.5)",
    "}",
    "extension Font { static let heading = Font.system(size: 22, weight: .semibold) }",
  ].join("\n"),
  "Shop/Home.swift": [
    "import SwiftUI",
    "struct Home: View {",
    "  var body: some View {",
    "    NavigationStack {",
    "      List { Price().padding(16) }",
    "        .navigationTitle(t)",
    "        .foregroundStyle(Theme.brand)",
    "    }",
    "  }",
    "}",
    "struct Price: View {",
    "  var body: some View {",
    "    Text(p).font(.heading).foregroundStyle(Theme.ink).background(Theme.brand)",
    "      .font(.system(size: size, weight: .bold)).cornerRadius(12).padding(8).padding(0.5)",
    "      .foregroundStyle(Color(red: 1, green: 0, blue: 0)).tint(Theme.brand).border(Theme.ink)",
    "  }",
    "}",
  ].join("\n"),
};

const shop = async () => scanRepo(await tempDir(APP));
const ownKeys = (group: unknown) => Object.keys(group ?? {}).filter((k) => !k.startsWith("$"));

/** A scan with exactly these colours and styles, for cases real code rarely produces. */
function scanOf(
  colors: Partial<ColorToken>[],
  typeStyles: Partial<TypeStyle>[] = [],
  more: Partial<DesignTokens> = {},
): ScanResult {
  const color = (c: Partial<ColorToken>): ColorToken => ({
    name: "c",
    light: "#000000",
    source: "A.swift",
    kind: "code",
    uses: 1,
    ...c,
  });
  const style = (s: Partial<TypeStyle>): TypeStyle => ({
    name: "s",
    kind: "system",
    family: "System",
    weight: "regular",
    uses: 1,
    ...s,
  });
  const tokens: DesignTokens = {
    colors: colors.map(color),
    systemColors: [],
    typeStyles: typeStyles.map(style),
    fonts: [],
    spacing: [],
    radii: [],
    ...more,
  };
  const framework = { framework: "swiftui" as const, platforms: ["ios" as const], screens: [], tokens };
  return { root: "/apps/Shop", frameworks: [framework], filesScanned: 1, truncated: false, unreadable: [] };
}

describe("tokens.json", () => {
  it("writes colours as W3C colours, most used first, with where each came from", async () => {
    const color = toDesignTokens(await shop()).color as Record<
      string,
      { $value: unknown; $description: string }
    >;
    expect(ownKeys(color)).toEqual(["brand", "ink", "hex-ff0000"]);
    expect(color.brand).toMatchObject({
      $value: { colorSpace: "srgb", components: [0.2, 0.4, 0.902], hex: "#3366e6" },
      $description: "From Shop/Theme.swift, 3 uses",
    });
    expect(color["hex-ff0000"]?.$description).toBe("Written without a name in Shop/Home.swift, 1 use");
  });

  it("keeps a colour's opacity", () => {
    expect(colorValue("#1a1a1a80")).toEqual({
      colorSpace: "srgb",
      components: [0.102, 0.102, 0.102],
      alpha: 0.502,
      hex: "#1a1a1a",
    });
  });

  it("writes each text style's values as their own tokens, only those the code sets", async () => {
    const { typography } = toDesignTokens(await shop());
    expect(typography).toMatchObject({
      heading: {
        fontFamily: { $type: "fontFamily", $value: "SF Pro" },
        fontSize: { $type: "dimension", $value: { value: 22, unit: "px" } },
        fontWeight: { $type: "fontWeight", $value: 600 },
      },
    });
    expect(ownKeys((typography as Record<string, unknown>)["system-bold"])).toEqual([
      "fontFamily",
      "fontWeight",
    ]);
  });

  it("writes spacing and radii smallest first, decimals included", () => {
    const scan = scanOf([], [], { spacing: [16, 0.5, 8], radii: [12, 4] });
    const tokens = toDesignTokens(scan);
    expect(ownKeys(tokens.spacing)).toEqual(["space-0_5", "space-8", "space-16"]);
    expect(ownKeys(tokens.radius)).toEqual(["radius-4", "radius-12"]);
    expect(tokens.radius).toMatchObject({
      "radius-12": { $type: "dimension", $value: { value: 12, unit: "px" } },
    });
    expect(toDesignMd(scan)).toContain("smallest first: 0.5px, 8px, 16px.");
  });

  it("names same-named colours by how the code refers to each, so none overwrites another", () => {
    const scan = scanOf([
      { name: "surface", light: "#111111", dark: "#222222", reference: "Theme.surface" },
      {
        name: "surface",
        light: "#333333",
        source: "Assets.xcassets/surface",
        kind: "asset",
        reference: 'Color("surface")',
      },
      { name: "surface-dark", light: "#444444", reference: "Theme.surfaceDark" },
    ]);
    expect(ownKeys(toDesignTokens(scan).color)).toEqual(["Theme-surface", "Color-surface", "surface-dark"]);
    const front = toDesignMd(scan).split("---")[1] ?? "";
    for (const line of ['Theme-surface: "#111111"', 'Color-surface: "#333333"', 'surface-dark: "#444444"']) {
      expect(front).toContain(line);
    }
    expect(front).toContain('Theme-surface-dark: "#222222"');
  });
});

describe("tokens.json for syncing", () => {
  it("records the app's name and platform, so a sync names what it makes after the app and shows its code", async () => {
    const scan = await shop();
    expect(toDesignTokens(scan).$extensions).toEqual({
      designmap: { app: path.basename(scan.root), platform: "ios" },
    });
  });

  it("records how the code refers to each colour and text style, where it's from, and its uses", async () => {
    const tokens = toDesignTokens(await shop());
    const color = tokens.color as Record<string, { $extensions: unknown }>;
    expect(color.brand?.$extensions).toEqual({
      designmap: { reference: "Theme.brand", source: "Shop/Theme.swift", line: 3, uses: 3 },
    });
    expect(color["hex-ff0000"]?.$extensions).toEqual({ designmap: { source: "Shop/Home.swift", uses: 1 } });
    expect((tokens.typography as Record<string, { $extensions: unknown }>).heading?.$extensions).toEqual({
      designmap: { name: "heading", reference: "Font.heading", uses: 1 },
    });
  });

  it("names a font helper function by its argument labels, as Swift does", async () => {
    const root = await tempDir({
      "App/Fonts.swift": [
        "import SwiftUI",
        "extension Font {",
        '  static func brand(size: CGFloat, weight w: Font.Weight = .bold, tags: [String] = ["a", "b"], options: Dictionary<String, Int> = [:]) -> Font {',
        "    .system(size: size, weight: w)",
        "  }",
        "  static func caption(_ size: CGFloat) -> Font { .system(size: size) }",
        "}",
      ].join("\n"),
      "App/Home.swift":
        "import SwiftUI\nstruct Home: View { var body: some View { Text(t).font(.brand(size: 20)).font(.caption(12)) } }",
    });
    const { typeStyles } = (await scanRepo(root)).frameworks[0]?.tokens ?? { typeStyles: [] };
    expect(typeStyles.map((s) => s.reference).sort()).toEqual([
      "Font.brand(size:weight:tags:options:)",
      "Font.caption(_:)",
    ]);
  });

  it("records a font helper's full reference through nested types", async () => {
    const root = await tempDir({
      "App/Fonts.swift":
        "import SwiftUI\nenum Fonts { enum Brand { static let heading = Font.system(size: 22, weight: .bold) } }",
      "App/Home.swift":
        "import SwiftUI\nstruct Home: View { var body: some View { Text(t).font(Fonts.Brand.heading) } }",
    });
    const { typeStyles } = (await scanRepo(root)).frameworks[0]?.tokens ?? { typeStyles: [] };
    expect(typeStyles.find((s) => s.name === "heading")?.reference).toBe("Fonts.Brand.heading");
  });

  it("numbers same-named colours in order, one key each", () => {
    const colors = Array.from({ length: 5 }, (_, i) => ({ name: "same", light: `#00000${i}`, uses: 1 }));
    expect(ownKeys(toDesignTokens(scanOf(colors)).color)).toEqual([
      "same",
      "same-2",
      "same-3",
      "same-4",
      "same-5",
    ]);
  });

  it("keeps each token's key when the ranking changes, so a sync updates it rather than replacing it", () => {
    const sameName = [
      { name: "brand", light: "#111111", dark: "#222222", source: "A.swift", reference: "brand" },
      { name: "brand", light: "#333333", dark: "#444444", source: "B.swift", reference: "brand" },
      { name: "surface", light: "#555555", reference: "Theme.surface" },
      { name: "surface", light: "#666666", reference: 'Color("surface")' },
    ];
    const ranked = (order: number[]) => scanOf(order.map((i, rank) => ({ ...sameName[i], uses: 10 - rank })));
    const keysByValue = (scan: ScanResult) => {
      const color = toDesignTokens(scan).color as Record<string, { $value: { hex: string } }>;
      const light = ownKeys(color).map((k) => [color[k]?.$value.hex, k]);
      const dark = [...(toDesignMd(scan).matchAll(/^ {2}([\w-]+-dark): "(#\w+)"$/gm) ?? [])].map((m) => [
        m[2],
        m[1],
      ]);
      return Object.fromEntries([...light, ...dark]);
    };
    const before = keysByValue(ranked([0, 1, 2, 3]));
    expect(before).toEqual({
      "#111111": "brand",
      "#222222": "brand-dark",
      "#333333": "brand-2",
      "#444444": "brand-2-dark",
      "#555555": "Theme-surface",
      "#666666": "Color-surface",
    });
    expect(keysByValue(ranked([3, 2, 1, 0]))).toEqual(before);
  });
});

describe("DESIGN.md", () => {
  it("puts the tokens in the front matter, with primary pointing at the colour named brand", async () => {
    const front = toDesignMd(await shop()).split("---")[1] ?? "";
    expect(front).toContain('version: "alpha"');
    expect(front).toContain('  brand: "#3366e6"');
    expect(front).toContain('  primary: "{colors.brand}"');
    expect(front).toContain(
      '  heading:\n    fontFamily: "SF Pro"\n    fontSize: "22px"\n    fontWeight: 600',
    );
    expect(front).toContain('  space-16: "16px"');
    expect(front).toContain('omitted:\n  - section: "components"');
  });

  it("points primary only at a colour named for it, never a guess", () => {
    const front = toDesignMd(scanOf([{ name: "tintedBackground" }])).split("---")[1] ?? "";
    expect(front).not.toContain("primary");
  });

  it("states use counts and sources in the prose, with sections in the format's order", async () => {
    const md = toDesignMd(await shop());
    expect(md).toContain("- **brand** `#3366e6`: 3 uses, from `Shop/Theme.swift` as `Theme.brand`.");
    expect(md).toContain(
      "- **hex-ff0000** `#ff0000`: 1 use, written without a name, first in `Shop/Home.swift`.",
    );
    expect(md).toContain("- **system-bold** (SF Pro bold): 1 use.");
    expect(md).toContain("Screens: Home.");
    expect(md.match(/^## .+$/gm)).toEqual([
      "## Overview",
      "## Colors",
      "## Typography",
      "## Layout",
      "## Shapes",
    ]);
  });

  it("lists a style the code works out as it runs in prose, without an empty token", () => {
    const md = toDesignMd(
      scanOf([], [{ name: "Custom", kind: "custom", family: "", weight: "computed", uses: 3 }]),
    );
    expect(md).toContain("Also used, with a font the code works out as it runs: Custom (3 uses).");
    expect(md).toContain('  - section: "typography"');
    expect(md).not.toContain("typography:\n");
  });

  it("describes the most used colours in full and lists every other one briefly", () => {
    const colors = Array.from({ length: 14 }, (_, i) => ({
      name: `c${i}`,
      light: `#0000${String(i).padStart(2, "0")}`,
      uses: 20 - i,
    }));
    const md = toDesignMd(scanOf(colors));
    expect(md).toContain("- **c11** `#000011`: 9 uses");
    expect(md).not.toContain("- **c12**");
    expect(md).toContain("Also used, 2 more colours: c12 `#000012` ×8, c13 `#000013` ×7.");
    expect(md.split("---")[1]).toContain('  c13: "#000013"');
  });

  it("names the first screens and counts the rest", async () => {
    const page = (i: number) =>
      `import SwiftUI\nstruct S${i}: View { var body: some View { NavigationStack { List { Text(t) }.navigationTitle(t) } } }`;
    const files = Object.fromEntries(Array.from({ length: 35 }, (_, i) => [`App/S${i}.swift`, page(i)]));
    expect(toDesignMd(await scanRepo(await tempDir(files)))).toMatch(/Screens: (?:S\d+, ){30}and 5 more\./);
  });

  it("quotes names YAML would otherwise misread", async () => {
    // `#` starts a YAML comment, and is allowed in folder names everywhere (`:` isn't on Windows).
    const root = path.join(await tempDir({ "#1 app/A.swift": APP["Shop/Theme.swift"] }), "#1 app");
    expect(toDesignMd(await scanRepo(root))).toContain('name: "#1 app"');
    expect(toDesignMd(scanOf([{ name: "on" }, { name: "null" }]))).toContain(
      '  "on": "#000000"\n  "null": "#000000"',
    );
  });

  it("says plainly when the app has no code it reads", async () => {
    const md = toDesignMd(await scanRepo(await tempDir({ "README.md": "hi" })));
    expect(md).toContain("Designmap found no SwiftUI or Jetpack Compose code in");
    expect(md).toContain('  - section: "colors"');
  });
});

describe("writing", () => {
  it("writes tokens.json and DESIGN.md into designmap/ in the app, or where it's told", async () => {
    const scan = await shop();
    const { tokens, design } = await writeOutputs(scan);
    expect(path.relative(scan.root, tokens)).toBe(path.join("designmap", "tokens.json"));
    expect(JSON.parse(await readFile(tokens, "utf8"))).toEqual(toDesignTokens(scan));
    expect(await readFile(design, "utf8")).toBe(toDesignMd(scan));
    const elsewhere = path.join(await tempDir({}), "out");
    expect((await writeOutputs(scan, elsewhere)).design).toBe(path.join(elsewhere, "DESIGN.md"));
  });
});
