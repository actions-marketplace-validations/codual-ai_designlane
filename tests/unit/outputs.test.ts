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
  const tokens = {
    colors: colors.map(color),
    colorsOmitted: 0,
    systemColors: [],
    typeStyles: typeStyles.map(style),
    typeStylesOmitted: 0,
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

  it("gives two names that read the same, and a dark value's name, their own keys", () => {
    const scan = scanOf([
      { name: "a.b", light: "#111111", dark: "#222222" },
      { name: "a-b", light: "#333333" },
      { name: "a-b-dark", light: "#444444" },
    ]);
    expect(ownKeys(toDesignTokens(scan).color)).toEqual(["a-b", "a-b-2", "a-b-dark"]);
    const front = toDesignMd(scan).split("---")[1] ?? "";
    for (const line of [
      'a-b: "#111111"',
      'a-b-2: "#333333"',
      'a-b-dark: "#444444"',
      'a-b-dark-2: "#222222"',
    ]) {
      expect(front).toContain(line);
    }
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
    expect(md).toContain("- **brand** `#3366e6`: 3 uses, from `Shop/Theme.swift`.");
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

  it("names the first screens and counts the rest", async () => {
    const page = (i: number) =>
      `import SwiftUI\nstruct S${i}: View { var body: some View { NavigationStack { List { Text(t) }.navigationTitle(t) } } }`;
    const files = Object.fromEntries(Array.from({ length: 35 }, (_, i) => [`App/S${i}.swift`, page(i)]));
    expect(toDesignMd(await scanRepo(await tempDir(files)))).toMatch(/Screens: (?:S\d+, ){30}and 5 more\./);
  });

  it("quotes names YAML would otherwise misread", async () => {
    const root = path.join(await tempDir({ "my: app #1/A.swift": APP["Shop/Theme.swift"] }), "my: app #1");
    expect(toDesignMd(await scanRepo(root))).toContain('name: "my: app #1"');
    expect(toDesignMd(scanOf([{ name: "on" }, { name: "null" }]))).toContain(
      '  "on": "#000000"\n  "null": "#000000"',
    );
  });

  it("says plainly when the app has no code it reads", async () => {
    const md = toDesignMd(await scanRepo(await tempDir({ "README.md": "hi" })));
    expect(md).toContain("Designmap found no SwiftUI code in");
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
