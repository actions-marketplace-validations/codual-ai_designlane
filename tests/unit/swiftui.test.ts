import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseColorset } from "../../src/frameworks/xcode-colors.js";
import { scanRepo } from "../../src/scan/index.js";
import { tempDir } from "../helpers/temp.js";

const fixture = path.join(import.meta.dirname, "..", "fixtures", "swiftui-app");

describe("scanning a SwiftUI app", () => {
  it("finds the screen, its component and the app's design tokens", async () => {
    const scan = await scanRepo(fixture);
    expect(scan.frameworks.map((f) => f.framework)).toEqual(["swiftui"]);
    const fw = scan.frameworks[0]!;
    expect(fw.platforms).toEqual(["ios"]);
    expect(fw.screens.map((s) => [s.name, s.kind, s.file, s.line])).toEqual([
      ["PaywallView", "screen", "Shop/Views/PaywallView.swift", 3],
      ["PlanRow", "component", "Shop/Views/PlanRow.swift", 3],
    ]);
    const colors = Object.fromEntries(fw.tokens.colors.map((c) => [c.name, c]));
    expect(colors.AccentColor?.light).toBe("#334de6");
    expect(colors.Brand).toMatchObject({ light: "#ff1a2e", dark: "#ff5566" });
    expect(colors.ink?.light).toBe("#16161a");
    expect(colors.mist?.light).toBe("#f2f2f7");
    expect(colors.tintColor?.light).toBe("#bb3be2");
    expect(fw.tokens.fonts).toEqual(["Inter"]);
    expect(fw.tokens.spacing).toEqual([16, 12]);
    expect(fw.tokens.radii).toEqual([12]);
    expect(scan).toMatchObject({ truncated: false, unreadable: [] });
  });

  it("skips previews, tests and Swift files that don't use SwiftUI", async () => {
    const root = await tempDir({
      "App/HomeScreen.swift":
        'import SwiftUI\nstruct HomeScreen: View { var body: some View { Text("Hi") } }',
      "App/HomeScreen_Previews.swift":
        "import SwiftUI\nstruct HomeScreen_Previews: PreviewProvider { static var previews: some View { HomeScreen() } }",
      "AppTests/LoginViewTests.swift":
        "import SwiftUI\nstruct LoginScreen: View { var body: some View { EmptyView() } }",
      "App/Model.swift": "struct Habit: Codable { var name: String }",
    });
    const scan = await scanRepo(root);
    expect(scan.frameworks[0]?.screens.map((s) => s.name)).toEqual(["HomeScreen"]);
  });

  it("ranks a navigation screen in a Screens folder above a row component", async () => {
    const nav = 'NavigationStack { List { Text("a") }.navigationTitle("Habits") }';
    const root = await tempDir({
      "Screens/Habits.swift": `import SwiftUI\nstruct Habits: View { var body: some View { ${nav} } }`,
      "Components/HabitRow.swift":
        'import SwiftUI\nstruct HabitRow: View { var body: some View { Text("a") } }',
    });
    const screens = (await scanRepo(root)).frameworks[0]!.screens;
    expect(screens.map((s) => [s.name, s.kind])).toEqual([
      ["Habits", "screen"],
      ["HabitRow", "component"],
    ]);
  });

  it("ignores views in comments, strings and #Preview blocks", async () => {
    const root = await tempDir({
      "App/Home.swift": [
        "import SwiftUI",
        "// struct OldScreen: View {",
        "/* struct LegacyScreen: View {} */",
        'let note = "struct FakeScreen: View {"',
        "struct HomeScreen: View { var body: some View { Text(note) } }",
        "#Preview { struct PreviewHost: View { var body: some View { HomeScreen() } }; return PreviewHost() }",
      ].join("\n"),
    });
    expect((await scanRepo(root)).frameworks[0]?.screens.map((s) => s.name)).toEqual(["HomeScreen"]);
  });

  it("keeps real views whose names end in Preview", async () => {
    const root = await tempDir({
      "App/LinkPreview.swift":
        "import SwiftUI\nstruct LinkPreview: View { var body: some View { EmptyView() } }",
    });
    expect((await scanRepo(root)).frameworks[0]?.screens.map((s) => s.name)).toEqual(["LinkPreview"]);
  });

  it("scores a nested view on its own body, not its parent's", async () => {
    const root = await tempDir({
      "App/Outer.swift": [
        "import SwiftUI",
        "struct Outer: View {",
        '  struct Inner: View { var body: some View { NavigationStack { List {}.navigationTitle("x").toolbar {} } } }',
        "  var body: some View { Inner() }",
        "}",
      ].join("\n"),
    });
    const kinds = Object.fromEntries(
      (await scanRepo(root)).frameworks[0]!.screens.map((s) => [s.name, s.kind]),
    );
    expect(kinds).toEqual({ Outer: "component", Inner: "screen" });
  });

  it("treats files as SwiftUI when the module re-exports it", async () => {
    const root = await tempDir({
      "App/Exports.swift": "@_exported import SwiftUI",
      "App/Home.swift": "struct HomeScreen: View { var body: some View { EmptyView() } }",
    });
    expect((await scanRepo(root)).frameworks[0]?.screens.map((s) => s.name)).toEqual(["HomeScreen"]);
  });

  it.each([
    ["a Screen name", "HomeScreen", "App", "screen"],
    ["a Screens folder plus navigation", "Home", "Screens", "screen"],
    ["a component name, even with navigation", "HabitRow", "App", "component"],
    ["a plain view", "Home", "App", "component"],
  ])("ranks %s", async (_, name, folder, kind) => {
    const nav =
      folder === "Screens" || name === "HabitRow"
        ? "NavigationStack { List { } }.navigationTitle(t)"
        : "Text(t)";
    const root = await tempDir({
      [`${folder}/${name}.swift`]: `import SwiftUI\nstruct ${name}: View { var body: some View { ${nav} } }`,
    });
    expect((await scanRepo(root)).frameworks[0]?.screens[0]?.kind).toBe(kind);
  });

  it("counts a long body as a sign of a screen", async () => {
    const lines = Array.from({ length: 70 }, () => "    Text(t)").join("\n");
    const root = await tempDir({
      "App/Settings.swift": `import SwiftUI\nstruct Settings: View { var body: some View { ScrollView { List {\n${lines}\n} } } }`,
    });
    expect((await scanRepo(root)).frameworks[0]?.screens[0]).toMatchObject({ kind: "screen", score: 3 });
  });

  it("gives views with the same name in one file distinct ids", async () => {
    const root = await tempDir({
      "App/Row.swift": "import SwiftUI\n#if os(iOS)\nstruct Row: View {}\n#else\nstruct Row: View {}\n#endif",
    });
    const ids = (await scanRepo(root)).frameworks[0]!.screens.map((s) => s.id);
    expect(ids).toEqual(["swiftui:App/Row.swift#Row@3", "swiftui:App/Row.swift#Row@5"]);
  });

  it("groups font weights into families, most used first, and ignores commented-out fonts", async () => {
    const font = (name: string) => `.font(.custom("${name}", size: 12))`;
    const root = await tempDir({
      "App/Fonts.swift": [
        "import SwiftUI",
        `let a = Text(x)${font("Inter-Regular")}${font("Inter-Bold")}${font("Inter-SemiBold")}`,
        `let b = Text(x)${font("Playfair Display")}`,
        `// ${font("Comic Sans")}`,
      ].join("\n"),
    });
    expect((await scanRepo(root)).frameworks[0]?.tokens.fonts).toEqual(["Inter", "Playfair Display"]);
  });

  it("reads colour opacity and skips colours in comments", async () => {
    const root = await tempDir({
      "App/Colors.swift":
        'import SwiftUI\nlet glass = Color(red: 1, green: 1, blue: 1, opacity: 0.5)\n// let old = Color(hex: "#000000")',
    });
    const colors = (await scanRepo(root)).frameworks[0]?.tokens.colors;
    expect(colors).toEqual([{ name: "glass", light: "#ffffff80", source: "App/Colors.swift" }]);
  });

  it("finds generic views and views with several conformances", async () => {
    const root = await tempDir({
      "App/Views.swift":
        "import SwiftUI\nstruct Card<Content: View>: View { var body: some View { EmptyView() } }\nstruct Badge: View, Equatable { var body: some View { EmptyView() } }",
    });
    const names = (await scanRepo(root)).frameworks[0]!.screens.map((s) => s.name);
    expect(names.sort()).toEqual(["Badge", "Card"]);
  });

  it("reports no frameworks for a project without SwiftUI", async () => {
    const root = await tempDir({ "README.md": "# Not an app" });
    expect((await scanRepo(root)).frameworks).toEqual([]);
  });
});

describe("parseColorset", () => {
  const rel = "App/Assets.xcassets/Accent.colorset/Contents.json";
  const color = (components: Record<string, string>, appearances?: object[]) => ({
    color: { components },
    ...(appearances ? { appearances } : {}),
  });

  it("reads light and dark variants", () => {
    const json = JSON.stringify({
      colors: [
        color({ red: "1.000", green: "0.000", blue: "0.000", alpha: "1.000" }),
        color({ red: "0x00", green: "0x00", blue: "0xFF" }, [{ appearance: "luminosity", value: "dark" }]),
      ],
    });
    expect(parseColorset(rel, json)).toEqual({
      name: "Accent",
      light: "#ff0000",
      dark: "#0000ff",
      source: rel,
    });
  });

  it("reads grayscale colours and drops a dark variant equal to light", () => {
    const json = JSON.stringify({
      colors: [
        color({ white: "0.5", alpha: "1" }),
        color({ white: "0.5", alpha: "1" }, [{ appearance: "luminosity", value: "dark" }]),
      ],
    });
    expect(parseColorset(rel, json)).toEqual({ name: "Accent", light: "#808080", source: rel });
  });

  it("ignores high-contrast variants", () => {
    const json = JSON.stringify({
      colors: [
        color({ red: "1", green: "1", blue: "1" }),
        color({ red: "0", green: "0", blue: "0" }, [{ appearance: "contrast", value: "high" }]),
      ],
    });
    expect(parseColorset(rel, json)).toEqual({ name: "Accent", light: "#ffffff", source: rel });
  });

  it.each(["not json", '{"colors": "wrong shape"}', '{"colors": []}'])("returns nothing for %j", (text) => {
    expect(parseColorset(rel, text)).toBeUndefined();
  });
});
