import { describe, expect, it } from "vitest";
import { categoryOf } from "../../src/catalog/components.js";
import { catalogOf, kotlin, named, RN_MANIFEST, swift, tsx } from "../helpers/catalog.js";
import { speedIt } from "../helpers/speed.js";

describe("component categories", () => {
  it("reads a category from the end of a name, whole parts only", () => {
    expect(categoryOf("SubscribeButton", "component")).toBe("button");
    expect(categoryOf("PlanRow", "component")).toBe("list");
    expect(categoryOf("ProfileCard", "component")).toBe("card");
    expect(categoryOf("TopBar", "component")).toBe("header");
    expect(categoryOf("SearchField", "component")).toBe("input");
    expect(categoryOf("PriceTag", "component")).toBe("label");
    expect(categoryOf("UserAvatar", "component")).toBe("media");
    expect(categoryOf("Cardigan", "component")).toBe("other");
    expect(categoryOf("Settings", "screen")).toBe("screen");
    expect(categoryOf("Rowboat", "component")).toBe("other");
  });
});

describe("SwiftUI components", () => {
  const app = {
    "App/PlanRow.swift": swift(
      "struct PlanRow: View {",
      "    let title: String",
      '    var price: String = "$1"',
      "    @Binding var selected: Bool",
      "    @State private var pressed = false",
      "    @Environment(\\.dismiss) var dismiss",
      "    private let formatter = Formatter()",
      "    let fixed = 3",
      "    static var height: CGFloat = 44",
      "    private var token: String",
      "    var label: String { title.uppercased() }",
      "    static func sample() -> some View { PlanRow(title: s, selected: .constant(true)) }",
      "    func tap() { var scratch: Int; scratch = 1 }",
      "    var body: some View {",
      "        let inner: Int = 2",
      "        HStack { Text(title).font(.headline); Spacer() }",
      '            .foregroundStyle(Color("Brand"))',
      "            .background(Color.accentColor)",
      "            .tint(.ink)",
      "    }",
      "}",
      "extension PlanRow { func pressedStyle() -> some View { self } }",
      "struct PlanRow_Previews: PreviewProvider { static var previews: some View { PlanRow(title: t, selected: .constant(true)) } }",
      "#Preview { PlanRow(title: t, selected: .constant(true)) }",
    ),
    "App/Paywall.swift": swift(
      "struct Paywall: View {",
      "    var body: some View { NavigationStack { VStack { PlanRow(title: a, selected: $x); PlanRow(title: b, selected: $y) }.navigationTitle(t) } }",
      "    // PlanRow(title: c) in a comment",
      "}",
      "struct Upsell: View { var body: some View { PlanRow(title: c, selected: $z) } }",
    ),
    "App/Settings.swift": swift(
      "struct Settings: View { var body: some View { PlanRow(title: d, selected: $w) } }",
    ),
    "App/Colors.swift": swift("extension Color { static let ink = Color(red: 0.1, green: 0.1, blue: 0.1) }"),
    "App/Assets.xcassets/Brand.colorset/Contents.json": colorset("0xFF", "0x1A", "0x2E"),
    "App/Assets.xcassets/AccentColor.colorset/Contents.json": colorset("0x33", "0x4D", "0xE6"),
  };

  it("lists a view's parameters: what the code using it passes, not its own state", async () => {
    const { components } = await catalogOf(app);
    expect(named(components, "PlanRow").params).toEqual([
      "title: String",
      "price: String",
      "@Binding selected: Bool",
    ]);
  });

  it("counts uses outside its own code, previews and comments, with the files most using it first", async () => {
    const { components } = await catalogOf(app);
    const row = named(components, "PlanRow");
    expect(row.uses).toBe(4);
    expect(row.usedIn).toEqual(["App/Paywall.swift", "App/Settings.swift"]);
  });

  it("names the colours and text styles a view's code refers to, by their keys", async () => {
    const { components } = await catalogOf(app);
    const row = named(components, "PlanRow");
    expect([...row.colors].sort()).toEqual(["AccentColor", "Brand", "ink"]);
    expect(row.typeStyles).toEqual(["headline"]);
    expect(named(components, "Paywall").colors).toEqual([]);
  });

  it("keeps the declaration's code, and lists components before screens, most used first", async () => {
    const { components } = await catalogOf(app);
    expect(named(components, "PlanRow").source.startsWith("struct PlanRow: View {")).toBe(true);
    expect(named(components, "PlanRow").source.endsWith("}")).toBe(true);
    expect(components.map((c) => c.kind)).toEqual([...components.map((c) => c.kind)].sort());
    expect(components[0]?.name).toBe("PlanRow");
  });

  it("reads a one-line view's parameters", async () => {
    const { components } = await catalogOf({
      "App/Badge.swift": swift("struct Badge: View { let count: Int; var body: some View { Text(t) } }"),
      "App/Home.swift": swift(
        "struct Home: View { var body: some View { NavigationStack { Badge(count: 1).navigationTitle(t) } } }",
      ),
    });
    expect(named(components, "Badge").params).toEqual(["count: Int"]);
  });
});

describe("Compose components", () => {
  const app = {
    "app/src/main/java/a/Chip.kt": kotlin(
      "import androidx.compose.material3.MaterialTheme",
      "@Composable",
      "fun PriceChip(",
      "    @StringRes label: Int,",
      '    text: String = "a, b",',
      "    onClick: () -> Unit = {},",
      "    extras: Map<String, Int> = emptyMap(),",
      "    modifier: Modifier = Modifier,",
      ") {",
      "    Text(stringResource(label), color = MaterialTheme.colorScheme.primary)",
      "}",
      "@Preview(showBackground = true)",
      "@Composable",
      "fun PriceChipPreview() { PriceChip(label = 1) }",
    ),
    "app/src/main/java/a/Home.kt": kotlin(
      "@Composable fun Home() { Scaffold { Column { PriceChip(label = 1); PriceChip(label = 2) } } }",
    ),
  };

  it("lists a composable's parameters without annotations or defaults, split at its own commas", async () => {
    const { components } = await catalogOf(app);
    expect(named(components, "PriceChip").params).toEqual([
      "label: Int",
      "text: String",
      "onClick: () -> Unit",
      "extras: Map<String, Int>",
      "modifier: Modifier",
    ]);
  });

  it("counts uses outside previews", async () => {
    const { components } = await catalogOf(app);
    expect(named(components, "PriceChip").uses).toBe(2);
    expect(named(components, "PriceChip").usedIn).toEqual(["app/src/main/java/a/Home.kt"]);
  });
});

describe("React Native components", () => {
  const app = {
    ...RN_MANIFEST,
    "src/theme.ts": 'export const colors = { primary: "#3366ff", muted: "#999999" };',
    "src/Card.tsx": tsx(
      'import { colors } from "./theme";',
      "interface CardProps { title: string; onPress?: () => void }",
      "export function Card({ title, onPress }: CardProps) {",
      "  return <View style={{ backgroundColor: colors.primary }}><Text>{title}</Text></View>;",
      "}",
      "export const Pill = ({ label, ...rest }) => <Text {...rest}>{label}</Text>;",
      "export const Tag = (props: { text: string }) => <Text>{props.text}</Text>;",
    ),
    "src/Home.tsx": tsx(
      'import { Card, Pill, Tag } from "./Card";',
      "export function Home() { return <View><Card title={a} /><Card title={b}></Card><Pill label={c} /><Tag text={d} /></View>; }",
    ),
  };

  it("lists props from a props type, from what's destructured, or as written", async () => {
    const { components } = await catalogOf(app);
    expect(named(components, "Card").params).toEqual(["title: string", "onPress?: () => void"]);
    expect(named(components, "Pill").params).toEqual(["label", "...rest"]);
    expect(named(components, "Tag").params).toEqual(["text: string"]);
  });

  it("counts JSX uses and names the theme colours a component reads", async () => {
    const { components } = await catalogOf(app);
    expect(named(components, "Card").uses).toBe(2);
    expect(named(components, "Card").colors).toEqual(["primary"]);
  });
});

describe("component reading on hostile input", () => {
  speedIt("stays fast on a long line of words and many views", async () => {
    const words = "word ".repeat(40_000);
    const views = Array.from(
      { length: 300 },
      (_, i) => `struct V${i}: View { let a: Int; var body: some View { V${(i + 1) % 300}(a: 1) } }`,
    );
    const started = performance.now();
    const { components } = await catalogOf({ "App/Many.swift": swift(...views, `// ${words}`, words) });
    expect(components.length).toBeGreaterThan(0);
    expect(performance.now() - started).toBeLessThan(5000);
  });
});

function colorset(red: string, green: string, blue: string) {
  return JSON.stringify({
    colors: [
      {
        idiom: "universal",
        color: { "color-space": "srgb", components: { red, green, blue, alpha: "1.000" } },
      },
    ],
  });
}
