import { describe, expect, it } from "vitest";
import { findDrift } from "../../src/drift/drift.js";
import { duplicates } from "../../src/drift/duplicates.js";
import { toDriftMd } from "../../src/output/drift-md.js";
import { catalogOf, kotlin, RN_MANIFEST, swift, tsx } from "../helpers/catalog.js";

async function driftOf(files: Record<string, string>) {
  const { scan, sources, components } = await catalogOf(files);
  return { scan, report: findDrift(scan, sources, components) };
}

const THEME = swift(
  "enum Theme {",
  '  static let brand = Color(hex: "#3366E6")',
  '  static let night = Color(light: Color(hex: "#ffffff"), dark: Color(hex: "#101010"))',
  "}",
);

describe("colours written as values", () => {
  it("lists each with its places, naming the named colour with that value first", async () => {
    const { report } = await driftOf({
      "App/Theme.swift": THEME,
      "App/Home.swift": swift(
        "struct Home: View { var body: some View { NavigationStack { VStack {",
        '  Text(a).foregroundStyle(Color(hex: "#3366e6"))',
        '  Text(b).foregroundStyle(Color(hex: "#123456"))',
        "  Text(c).foregroundStyle(Color(red: 0.2, green: 0.4, blue: 0.9))",
        '  // Text(d).foregroundStyle(Color(hex: "#abcdef"))',
        '  Text("Color(hex: #fedcba)")',
        "}.navigationTitle(t) } } }",
      ),
    });
    expect(report.colors).toEqual([
      {
        framework: "swiftui",
        value: "#3366e6",
        token: { key: "brand", reference: "Theme.brand" },
        uses: [
          { file: "App/Home.swift", line: 3 },
          { file: "App/Home.swift", line: 5 },
        ],
      },
      { framework: "swiftui", value: "#123456", uses: [{ file: "App/Home.swift", line: 4 }] },
    ]);
  });

  it("leaves out theme files and the files the app's colours are declared in", async () => {
    const { report } = await driftOf({
      "App/Brand.swift": swift('extension Color { static let brand = Color(hex: "#3366e6") }'),
      "App/Theme/Swatch.swift": swift(
        'struct Swatch: View { var body: some View { Text(t).foregroundStyle(Color(hex: "#123456")) } }',
      ),
    });
    expect(report.colors).toEqual([]);
  });

  it("reads Compose's ARGB values and React Native's style colours", async () => {
    const compose = await driftOf({
      "app/src/main/java/a/Home.kt": kotlin(
        "@Composable fun Home() { Scaffold { Text(t, color = Color(0x80112233)) } }",
      ),
    });
    expect(compose.report.colors.map((c) => c.value)).toEqual(["#11223380"]);
    const rn = await driftOf({
      ...RN_MANIFEST,
      "src/Home.tsx": tsx("export function Home() { return <View style={{ backgroundColor: '#FFF' }} />; }"),
    });
    expect(rn.report.colors.map((c) => c.value)).toEqual(["#ffffff"]);
  });
});

describe("spacing and corners off the scale the code uses", () => {
  const paddings = (values: number[]) =>
    swift(
      "struct Home: View { var body: some View { NavigationStack { VStack {",
      ...values.map((v) => `  Text(t).padding(${v})`),
      "  Text(t).cornerRadius(11)",
      "  Text(t).cornerRadius(12).cornerRadius(12).cornerRadius(12)",
      "}.navigationTitle(t) } } }",
    );

  it("lists a value used once or twice beside one used often, with that value, not a token name", async () => {
    const { scan, report } = await driftOf({ "App/Home.swift": paddings([12, 12, 12, 13, 10, 8, 30]) });
    expect(report.scale).toEqual([
      {
        framework: "swiftui",
        kind: "radius",
        value: 11,
        nearest: 12,
        nearestUses: 3,
        uses: [{ file: "App/Home.swift", line: 10 }],
      },
      {
        framework: "swiftui",
        kind: "spacing",
        value: 10,
        nearest: 12,
        nearestUses: 3,
        uses: [{ file: "App/Home.swift", line: 7 }],
      },
      {
        framework: "swiftui",
        kind: "spacing",
        value: 13,
        nearest: 12,
        nearestUses: 3,
        uses: [{ file: "App/Home.swift", line: 6 }],
      },
    ]);
    const md = toDriftMd(scan, report);
    expect(md).toContain("| 13pt | spacing | 1 | 12pt, used 3× | `App/Home.swift:6` |");
    expect(md).toContain("not named spacing tokens");
  });

  it("lists nothing when no value is used often, or the rare one is far off", async () => {
    expect(
      (await driftOf({ "App/Home.swift": paddings([12, 13]) })).report.scale.filter(
        (s) => s.kind === "spacing",
      ),
    ).toEqual([]);
    expect(
      (await driftOf({ "App/Home.swift": paddings([12, 12, 12, 17]) })).report.scale.filter(
        (s) => s.kind === "spacing",
      ),
    ).toEqual([]);
  });

  it("takes the smaller of two values on the scale equally near", async () => {
    const { report } = await driftOf({ "App/Home.swift": paddings([9, 9, 9, 11, 11, 11, 10]) });
    expect(report.scale.find((s) => s.kind === "spacing" && s.value === 10)?.nearest).toBe(9);
  });

  it("leaves a rare value on the 4-point grid alone", async () => {
    const { report } = await driftOf({ "App/Home.swift": paddings([14, 14, 14, 16]) });
    expect(report.scale.filter((s) => s.kind === "spacing")).toEqual([]);
  });
});

describe("text styles written in place", () => {
  it("names the named style with the same font, size and weight", async () => {
    const { report } = await driftOf({
      "App/Fonts.swift": swift(
        'extension Font { static let brandTitle = Font.custom("Inter", size: 28).weight(.bold) }',
      ),
      "App/Home.swift": swift(
        "struct Home: View { var body: some View { NavigationStack { VStack {",
        "  Text(a).font(.brandTitle)",
        '  Text(b).font(.custom("Inter", size: 28).weight(.bold))',
        '  Text(c).font(.custom("Inter", size: 20).weight(.bold))',
        "}.navigationTitle(t) } } }",
      ),
    });
    expect(report.typeStyles).toEqual([
      {
        framework: "swiftui",
        name: "Inter 28 bold",
        uses: 1,
        token: { key: "brandTitle", reference: "Font.brandTitle" },
      },
    ]);
  });
});

describe("near-duplicate components", () => {
  const body = (name: string, extra = "") =>
    `struct ${name}: View { let title: String; let subtitle: String; var body: some View { VStack(alignment: .leading, spacing: 4) { HStack { Image(systemName: "star"); Text(title).font(.headline).bold().lineLimit(1); Spacer(); Text(subtitle).foregroundStyle(.secondary).italic().underline() }; Divider().padding(.horizontal, 8).opacity(0.5); Rectangle().frame(height: 2).cornerRadius(1).shadow(radius: 3)${extra} } } }`;

  it("pairs components sharing most of their code, ignoring their names, most alike first", async () => {
    const { components } = await catalogOf({
      "App/A.swift": swift(body("ProductRow"), body("OrderRow"), body("Thin")),
      "App/B.swift": swift(
        "struct Small: View { var body: some View { Text(t) } }",
        "struct Tiny: View { var body: some View { Text(t) } }",
        body(
          "PlanRow",
          "; Toggle(isOn: $on) { Label(a, systemImage: b) }.tint(.green).toggleStyle(.switch).labelsHidden().disabled(locked).accessibilityHint(hint).padding(20).background(Color.red).clipShape(Capsule()).overlay(Circle())",
        ),
      ),
    });
    const pairs = duplicates(
      components.map((c) => (c.name === "Thin" ? { ...c, kind: "screen" as const } : c)),
    );
    expect(pairs.map((p) => [p.first.name, p.second.name].sort())).toEqual([["OrderRow", "ProductRow"]]);
    expect(pairs[0]?.similarity).toBe(1);
  });
});

describe("drift.md", () => {
  it("says there's no drift when there's none, and escapes table cells", async () => {
    const { scan, report } = await driftOf({
      "App/Home.swift": swift("struct Home: View { var body: some View { Text(t) } }"),
    });
    expect(toDriftMd(scan, report)).toContain("No drift found.");
    const withPipe = toDriftMd(scan, {
      ...report,
      typeStyles: [{ framework: "swiftui", name: "a | b", uses: 1, token: { key: "k`x" } }],
    });
    expect(withPipe).toContain("| a \\| b | 1 | `k'x` |");
  });
});
