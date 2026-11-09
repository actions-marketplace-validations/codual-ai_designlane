import { describe, expect, it } from "vitest";
import { codeOnly, withoutPreviews } from "../../src/frameworks/swift-source.js";
import { swiftType } from "../../src/frameworks/swiftui-type.js";
import { scanRepo } from "../../src/scan/index.js";
import { tempDir } from "../helpers/temp.js";

async function tokens(code: string, extra: Record<string, string> = {}) {
  const root = await tempDir({ "App/Screen.swift": `import SwiftUI\n${code}`, ...extra });
  return (await scanRepo(root)).frameworks[0]!.tokens;
}

const summary = (styles: { name: string; size?: number; weight: string; uses: number }[]) =>
  styles.map((s) => [s.name, s.size, s.weight, s.uses]);

describe("platform text styles", () => {
  it("reads Apple's text styles at their default sizes, however they're written", async () => {
    const { typeStyles: type } = await tokens(
      [
        "a.font(.headline)",
        "b.font(.headline)",
        "c.font(Font.title2)",
        "d.font(.system(.body, design: .rounded))",
        "let f = UIFont.preferredFont(forTextStyle: .footnote)",
      ].join("\n"),
    );
    expect(summary(type)).toEqual([
      ["headline", 17, "semibold", 2],
      ["body", 17, "regular", 1],
      ["footnote", 13, "regular", 1],
      ["title2", 22, "regular", 1],
    ]);
  });
});

describe("system fonts at a size", () => {
  it("reads sizes and weights, merging the two ways of writing a weight", async () => {
    const { typeStyles: type } = await tokens(
      [
        "a.font(.system(size: 15, weight: .semibold))",
        "b.font(.system(size: 15).weight(.semibold))",
        "c.font(.system(size: 12))",
        "let d = UIFont.systemFont(ofSize: 17)",
        "let e = UIFont.boldSystemFont(ofSize: 17)",
      ].join("\n"),
    );
    expect(summary(type)).toEqual([
      ["System 15 semibold", 15, "semibold", 2],
      ["System 12", 12, "regular", 1],
      ["System 17", 17, "regular", 1],
      ["System 17 bold", 17, "bold", 1],
    ]);
  });
});

describe("custom fonts", () => {
  it("merges family spellings and reads the weight from the font's name", async () => {
    const { typeStyles: type, fonts } = await tokens(
      [
        'a.font(.custom("HelveticaNeue", fixedSize: 14))',
        'b.font(.custom("Helvetica Neue", size: 14))',
        'c.font(.custom("Helvetica Neue", size: 14))',
        'd.font(.custom("Inter-SemiBold", size: 17))',
        'let e = UIFont(name: "Inter-Regular_Medium", size: 12)',
      ].join("\n"),
    );
    expect(summary(type)).toEqual([
      ["Helvetica Neue 14", 14, "regular", 3],
      ["Inter 12 medium", 12, "medium", 1],
      ["Inter 17 semibold", 17, "semibold", 1],
    ]);
    expect(fonts).toEqual(["Helvetica Neue", "Inter"]);
  });

  it("ignores an app's own .custom(\"…\") values that aren't fonts, and fonts in comments", async () => {
    const { typeStyles: type } = await tokens(
      'let e = Event.custom("PinCreateFailure")\n// a.font(.custom("Comic Sans", size: 12))',
    );
    expect(type).toEqual([]);
  });
});

describe("the app's own font helpers", () => {
  it("never guesses a helper's font from its name: one worked out at run time is computed", async () => {
    const { typeStyles } = await tokens(
      [
        "extension Font { static var scaledFootnote: Font { customFont(size: base * 13, relativeTo: .footnote) } }",
        "extension Font { static var footnoteBold: Font { compute() } }",
        "extension Font { static var titleSmall: Font { compute() } }",
        "a.font(.scaledFootnote)",
        "b.font(.footnoteBold)",
        "c.font(.titleSmall)",
      ].join("\n"),
    );
    expect(typeStyles.map((s) => [s.name, s.family, s.size, s.weight])).toEqual([
      ["footnoteBold", "", undefined, "computed"],
      ["scaledFootnote", "", undefined, "computed"],
      ["titleSmall", "", undefined, "computed"],
    ]);
  });

  it("counts uses of a helper, reading its font from its body or the size from the call", async () => {
    const { typeStyles: type } = await tokens(
      [
        "extension Font { static var scaledBody: Font { .system(size: 18) } }",
        "extension Font { static func brandTitle(_ s: CGFloat) -> Font { .custom(brand, size: s) } }",
        "a.font(.scaledBody)",
        "b.font(.scaledBody)",
        "c.font(.brandTitle(30))",
      ].join("\n"),
    );
    expect(type.map((s) => [s.name, s.family, s.size, s.uses])).toEqual([
      ["scaledBody", "System", 18, 2],
      ["brandTitle 30", "", 30, 1],
    ]);
  });
});

describe("the type scale", () => {
  it("keeps the scale short and says how many styles it left out", async () => {
    const lines = Array.from({ length: 25 }, (_, i) => `x.font(.system(size: ${10 + i}))`);
    const { typeStyles: type, typeStylesOmitted } = await tokens(lines.join("\n"));
    expect(type).toHaveLength(20);
    expect(typeStylesOmitted).toBe(5);
  });

  it("reads 512KB hostile files of every shape quickly", async () => {
    const fill = (unit: string) => unit.repeat(Math.floor((512 * 1024) / unit.length));
    const started = performance.now();
    await tokens("", {
      "App/A.swift": fill("T.a "),
      "App/B.swift": fill(".font(.body)"),
      "App/C.swift": fill("f(font: .title) "),
      "App/D.swift": fill("static var a: Font { .title }\n"),
      "App/E.swift": `${fill("static var a: Font {").slice(0, 256 * 1024)}${"}".repeat(10_000)}`,
    });
    expect(performance.now() - started).toBeLessThan(20_000);
  }, 60_000);

  it("stays fast on a hostile file", async () => {
    const started = performance.now();
    await tokens("", {
      "App/A.swift": ".font(.system(size: 1".repeat(20_000),
      "App/B.swift": '.custom("x", size: '.repeat(20_000),
      "App/C.swift": "static var a: Font {".repeat(20_000),
      "App/D.swift": `static var a${" ".repeat(40_000)}`,
      "App/F.swift": `${"static var a: Font {".repeat(20_000)}${"}".repeat(20_000)}`,
      "App/G.swift": "static let a: Font = .system(size: 1) ".repeat(12_000),
      "App/E.swift": `x.font(.system(size: 1${" ".repeat(40_000)}`,
    });
    expect(performance.now() - started).toBeLessThan(5000);
  });
});

describe("weights written after the font", () => {
  it("reads .bold(), .weight(…), a weight: argument and UIKit's weight type", async () => {
    const { typeStyles } = await tokens(
      [
        "a.font(.title.bold())",
        "b.font(.headline.weight(.regular))",
        "c.font(.system(.title, design: .rounded, weight: .bold))",
        'd.font(.custom("Inter", size: 17).weight(.bold))',
        "let e = UIFont.systemFont(ofSize: 17, weight: UIFont.Weight.medium)",
        "f.font(.system(size: 17, weight: .bold, design: .rounded))",
      ].join("\n"),
    );
    expect(summary(typeStyles).sort()).toEqual(
      [
        ["Inter 17 bold", 17, "bold", 1],
        ["System 17 bold", 17, "bold", 1],
        ["System 17 medium", 17, "medium", 1],
        ["headline regular", 17, "regular", 1],
        ["title bold", 28, "bold", 2],
      ].sort(),
    );
  });

  it("reads UIKit's title1 and leaves computed sizes without a size", async () => {
    const { typeStyles } = await tokens(
      [
        "let a = UIFont.preferredFont(forTextStyle: .title1)",
        "b.font(.system(size: 17 * scale))",
        'c.font(.custom("Inter", size: 1.5 * base))',
      ].join("\n"),
    );
    expect(summary(typeStyles).sort()).toEqual(
      [
        ["Inter, computed size", undefined, "regular", 1],
        ["System, computed size", undefined, "regular", 1],
        ["title1", 28, "regular", 1],
      ].sort(),
    );
  });
});

describe("helper bodies", () => {
  it("counts a helper's font only through its uses, never on its own", async () => {
    const { typeStyles, fonts } = await tokens(
      [
        "extension Font {",
        "  static var scaledBody: Font { .system(size: 18) }",
        '  static let brand: Font = .custom("Inter-Bold", size: 17)',
        "}",
        "a.font(.scaledBody)",
      ].join("\n"),
    );
    expect(summary(typeStyles)).toEqual([["scaledBody", 18, "regular", 1]]);
    // Inter is still one of the app's fonts, though no use of `brand` was found.
    expect(fonts).toEqual(["Inter"]);
  });

  it("reads each helper from its own body, not the next one's", async () => {
    const { typeStyles } = await tokens(
      [
        "extension Font {",
        "  static var plain: Font { compute() }",
        "  static var small: Font { .system(size: 12) }",
        "  static let heading: Font = .title.bold()",
        "}",
        "a.font(.plain)",
        "b.font(.small)",
        "c.font(.heading)",
      ].join("\n"),
    );
    expect(typeStyles.map((s) => [s.name, s.size, s.weight])).toEqual([
      ["heading", 28, "bold"],
      ["plain", undefined, "computed"],
      ["small", 12, "regular"],
    ]);
  });

  it("counts helpers declared on the app's own type", async () => {
    const { typeStyles } = await tokens(
      ["enum AppFont { static let heading: Font = .system(size: 24) }", "a.font(AppFont.heading)"].join("\n"),
    );
    expect(summary(typeStyles)).toEqual([["heading", 24, "regular", 1]]);
  });
});

describe("helpers in real apps' shapes", () => {
  it("reads a helper whose font is on the next line, counting it once", async () => {
    const { typeStyles } = await tokens(
      [
        'extension Font { static let brand: Font =\n  .custom("Inter", size: 20) }',
        "a.font(.brand)",
        "b.font(.brand)",
      ].join("\n"),
    );
    expect(summary(typeStyles)).toEqual([["brand", 20, "regular", 2]]);
  });

  it("doesn't count a helper used inside another helper's body on its own", async () => {
    const { typeStyles } = await tokens(
      [
        "extension Font {",
        "  static var base: Font { .system(size: 14) }",
        "  static var emphasis: Font { compute(.font(.base)) }",
        "}",
        "a.font(.base)",
      ].join("\n"),
    );
    expect(summary(typeStyles)).toEqual([["base", 14, "regular", 1]]);
  });

  it("keeps helpers of the same name on different types apart", async () => {
    const { typeStyles } = await tokens(
      [
        "enum A { static let h: Font = .system(size: 12) }",
        'enum B { static let h: Font = .custom("Lora", size: 30) }',
        "a.font(B.h)",
      ].join("\n"),
    );
    expect(typeStyles.map((s) => [s.name, s.family, s.size])).toEqual([["h", "Lora", 30]]);
  });

  it("counts a helper named after a text style on the app's own type, and helpers on nested types", async () => {
    const { typeStyles, fonts } = await tokens(
      [
        'enum Typography { static let headline: Font = .custom("Inter-Bold", size: 20) }',
        'enum Theme { enum Fonts { static let title2x: Font = .custom("Lora", size: 24) } }',
        "a.font(Typography.headline)",
        "b.font(Typography.headline)",
        "c.font(.headline)",
        "d.font(Theme.Fonts.title2x)",
      ].join("\n"),
    );
    expect(summary(typeStyles)).toEqual([
      ["headline", 20, "bold", 2],
      ["headline", 17, "semibold", 1],
      ["title2x", 24, "regular", 1],
    ]);
    expect(fonts).toEqual(["Inter", "Lora"]);
  });

  it("never takes Font's own custom or system for a helper of the same name", async () => {
    const { typeStyles } = await tokens(
      [
        "enum AppFont { static func custom(_ n: String) -> Font { .system(size: 9) } }",
        'a.font(.custom("Inter", size: 17))',
      ].join("\n"),
    );
    expect(summary(typeStyles)).toEqual([["Inter 17", 17, "regular", 1]]);
  });

  it("reads weights run into a font's name, and calls an interpolated weight computed", async () => {
    const { typeStyles, fonts } = await tokens(
      ['a.font(.custom("Inter-BoldItalic", size: 12))', 'b.font(.custom("Inter-\\(weight)", size: 12))'].join(
        "\n",
      ),
    );
    expect(summary(typeStyles)).toEqual([
      ["Inter 12 bold", 12, "bold", 1],
      ["Inter 12 computed weight", 12, "computed", 1],
    ]);
    expect(fonts).toEqual(["Inter"]);
  });
});

describe("what isn't a font, or isn't this font's", () => {
  it("doesn't take a text style used for scaling (UIFontMetrics) as a font", async () => {
    const { typeStyles } = await tokens(
      [
        'let a = UIFontMetrics(forTextStyle: .body).scaledFont(for: UIFont(name: "Inter-Bold", size: 17)!)',
        "let b = UIFontMetrics(forTextStyle: .title1).scaledValue(for: 16)",
      ].join("\n"),
    );
    expect(summary(typeStyles)).toEqual([["Inter 17 bold", 17, "bold", 1]]);
  });

  it("never takes a neighbour's weight", async () => {
    const { typeStyles } = await tokens(
      ["let a = [Font.title, Font.body.weight(.bold)]", "makeLabel(font: Font.caption, weight: .heavy)"].join(
        "\n",
      ),
    );
    expect(summary(typeStyles).sort()).toEqual(
      [
        ["body bold", 17, "bold", 1],
        ["caption", 12, "regular", 1],
        ["title", 28, "regular", 1],
      ].sort(),
    );
  });

  it("reads .bold() after a sized system font too", async () => {
    const { typeStyles } = await tokens("a.font(.system(size: 17)).bold()");
    expect(summary(typeStyles)).toEqual([["System 17 bold", 17, "bold", 1]]);
  });

  it("ends a helper written with = at a semicolon", async () => {
    const { typeStyles } = await tokens(
      [
        "struct Theme { static let heading: Font = brand(24); static let body: Font = .system(size: 17) }",
        "a.font(Theme.heading)",
        "b.font(Theme.body)",
      ].join("\n"),
    );
    expect(typeStyles.map((s) => [s.name, s.size])).toEqual([
      ["body", 17],
      ["heading", undefined],
    ]);
  });

  it("reads the family before an interpolated weight, the weight being computed", async () => {
    const { typeStyles } = await tokens('a.font(.custom("Inter-\\(weight)", size: 17))');
    expect(summary(typeStyles)).toEqual([["Inter 17 computed weight", 17, "computed", 1]]);
  });

  it("reads UIKit system fonts written without UIFont, as inside UIFontMetrics", async () => {
    const { typeStyles } = await tokens(
      [
        "let a = UIFontMetrics(forTextStyle: .headline).scaledFont(for: .systemFont(ofSize: 17, weight: .semibold))",
        "let b = UIFontMetrics(forTextStyle: .body).scaledFont(for: .boldSystemFont(ofSize: 15))",
      ].join("\n"),
    );
    expect(summary(typeStyles)).toEqual([
      ["System 15 bold", 15, "bold", 1],
      ["System 17 semibold", 17, "semibold", 1],
    ]);
  });

  it("keeps the weight of a font whose family is interpolated", async () => {
    const { typeStyles, fonts } = await tokens('a.font(.custom("\\(base)-Bold", size: 17))');
    expect(summary(typeStyles)).toEqual([["Unknown font 17 bold", 17, "bold", 1]]);
    expect(fonts).toEqual([]);
  });
});

describe("more ways of declaring helpers", () => {
  it("finds helpers without a type annotation, and types with their brace on the next line", async () => {
    const { typeStyles } = await tokens(
      [
        "enum AppFont\n{",
        '  static let brand = Font.custom("Inter", size: 15)',
        "}",
        "a.font(AppFont.brand)",
      ].join("\n"),
    );
    expect(summary(typeStyles)).toEqual([["brand", 15, "regular", 1]]);
  });
});

describe("weights and uses the code doesn't spell out", () => {
  it("calls a weight it can't read computed, not regular, even over two lines", async () => {
    const { typeStyles } = await tokens(
      [
        "a.font(.system(size: 14, weight: isOn ? .semibold : .regular))",
        "b.font(.system(size: 17,\n  weight: .bold))",
      ].join("\n"),
    );
    expect(summary(typeStyles)).toEqual([
      ["System 14 computed weight", 14, "computed", 1],
      ["System 17 bold", 17, "bold", 1],
    ]);
  });

  it("reads the size and weight a helper call passes, labelled or not", async () => {
    const { typeStyles } = await tokens(
      [
        "extension Font { static func app(size: CGFloat, weight: Font.Weight = .regular) -> Font { .system(size: size, weight: weight) } }",
        "a.font(.app(size: 17, weight: .bold))",
        "b.font(.app(17, .bold))",
        "c.font(.app(size: 12))",
      ].join("\n"),
    );
    expect(summary(typeStyles)).toEqual([
      ["app 17 bold", 17, "bold", 2],
      ["app 12", 12, "computed", 1],
    ]);
  });

  it("finds helpers wherever they're used: in a ternary, on Self, or passed as an argument", async () => {
    const { typeStyles, fonts } = await tokens(
      [
        'enum AppFont { static let title: Font = .custom("Lora", size: 24); var t: Font { Self.title } }',
        "extension Font { static let heading: Font = .system(size: 20) }",
        "a.font(on ? .heading : .body)",
        "L(font: AppFont.title)",
      ].join("\n"),
    );
    expect(summary(typeStyles)).toEqual([
      ["title", 24, "regular", 2],
      ["body", 17, "regular", 1],
      ["heading", 20, "regular", 1],
    ]);
    expect(fonts).toEqual(["Lora"]);
  });

  it("reads fonts passed as a font: argument", async () => {
    const { typeStyles } = await tokens(
      [
        "extension Font { static let heading: Font = .system(size: 20) }",
        "L(font: .heading)",
        "M(font: .title, size: 3)",
      ].join("\n"),
    );
    expect(summary(typeStyles)).toEqual([
      ["heading", 20, "regular", 1],
      ["title", 28, "regular", 1],
    ]);
  });

  it("reads .fontWeight(…) after a font", async () => {
    const { typeStyles } = await tokens("a.font(.headline).fontWeight(.regular)");
    expect(summary(typeStyles)).toEqual([["headline regular", 17, "regular", 1]]);
  });

  it("reads a size followed by a comment as written", async () => {
    const { typeStyles } = await tokens("a.font(.system(size: 17 // spec\n))");
    expect(summary(typeStyles)).toEqual([["System 17", 17, "regular", 1]]);
  });
});

describe("design-system enums", () => {
  it("doesn't take Font.Weight, Font.TextStyle or Font.Design constants for fonts", async () => {
    const { typeStyles } = await tokens(
      [
        "enum T {",
        "  static let strong: Font.Weight = .semibold",
        "  static let main: Font.TextStyle = .title",
        "  static let look: Font.Design = .rounded",
        "}",
        "a.font(.body).fontWeight(T.strong)",
      ].join("\n"),
    );
    expect(summary(typeStyles)).toEqual([["body computed weight", 17, "computed", 1]]);
  });

  it("calls a weight a modifier sets but can't be read computed", async () => {
    const { typeStyles } = await tokens(
      [
        "a.font(.body.weight(on ? .bold : .regular))",
        "b.font(.system(size: 17)).fontWeight(on ? .bold : .light)",
        "c.font(.headline).bold(isOn)",
        "d.font(.caption).bold(false)",
      ].join("\n"),
    );
    expect(summary(typeStyles).sort()).toEqual(
      [
        ["System 17 computed weight", 17, "computed", 1],
        ["body computed weight", 17, "computed", 1],
        ["caption", 12, "regular", 1],
        ["headline computed weight", 17, "computed", 1],
      ].sort(),
    );
  });

  it("gives a helper that switches between sizes no single size", async () => {
    const { typeStyles } = await tokens(
      [
        "enum T { static func font(for s: S) -> Font { switch s {",
        '  case .title: return .custom("Inter", size: 28)',
        '  case .body: return .custom("Inter", size: 15)',
        "} } }",
        "a.font(T.font(for: .title))",
        "b.font(T.font(for: .body))",
      ].join("\n"),
    );
    expect(typeStyles.map((s) => [s.name, s.family, s.size, s.uses])).toEqual([
      ["font", "Inter", undefined, 2],
    ]);
  });

  it("reads an app's own Font type, and skips key paths", async () => {
    const { typeStyles } = await tokens(
      [
        'enum Theme { enum Font { static let body: SwiftUI.Font = .custom("Inter", size: 15) } }',
        "a.font(Theme.Font.body)",
        "let k = \\Font.body",
      ].join("\n"),
    );
    expect(summary(typeStyles)).toEqual([["body", 15, "regular", 1]]);
  });
});

describe("helpers that look like other things", () => {
  it("reads a helper called like a text style as the helper, once", async () => {
    const { typeStyles } = await tokens(
      [
        "extension Font { static func title(_ w: Font.Weight) -> Font { .system(size: 28, weight: w) } }",
        "a.font(.title(.bold))",
        "b.font(.body(17))",
      ].join("\n"),
    );
    expect(summary(typeStyles)).toEqual([["title bold", 28, "bold", 1]]);
  });

  it("reads a font whose family is a constant, rather than guessing from the helper's name", async () => {
    const { typeStyles } = await tokens(
      [
        "enum AppFont { static let headline = Font.custom(Brand.family, size: 22) }",
        "a.font(AppFont.headline)",
      ].join("\n"),
    );
    expect(typeStyles.map((s) => [s.name, s.family, s.size, s.weight])).toEqual([
      ["headline", "", 22, "computed"],
    ]);
  });

  it("doesn't guess from a helper's name when its body makes a font call it can't read", async () => {
    const { typeStyles } = await tokens(
      ["enum AppFont { static var headline: Font { Font(Brand.uiFont) } }", "a.font(AppFont.headline)"].join(
        "\n",
      ),
    );
    expect(typeStyles.map((s) => [s.name, s.family, s.size, s.weight])).toEqual([
      ["headline", "", undefined, "computed"],
    ]);
  });

  it("reads a size written as CGFloat(17), and the weight past a nested call", async () => {
    const { typeStyles } = await tokens(
      [
        "a.font(.system(size: CGFloat(17), weight: .bold))",
        "b.font(.system(size: 17, weight: theme.weight(for: .x)))",
      ].join("\n"),
    );
    expect(summary(typeStyles)).toEqual([
      ["System 17 bold", 17, "bold", 1],
      ["System 17 computed weight", 17, "computed", 1],
    ]);
  });

  it("keeps a helper's size when its cases only change the weight, and drops it when any size differs", async () => {
    const { typeStyles } = await tokens(
      [
        'enum A { static func w(_ b: Bool) -> Font { b ? .custom("Inter-Bold", size: 17) : .custom("Inter", size: 17) } }',
        "enum B { static func s(_ k: K) -> Font { switch k {",
        "  case .a: return .system(size: 17)",
        "  case .b: return .system(size: 17)",
        "  case .c: return .system(size: 30)",
        "} } }",
        "x.font(A.w(true))",
        "y.font(B.s(.c))",
      ].join("\n"),
    );
    expect(typeStyles.map((s) => [s.name, s.family, s.size, s.weight])).toEqual([
      ["s", "System", undefined, "regular"],
      ["w", "Inter", 17, "computed"],
    ]);
  });
});

describe("helpers and fallbacks in UIKit-bridged apps", () => {
  it("takes a call's size only when the helper passes it on unchanged", async () => {
    const { typeStyles } = await tokens(
      [
        'extension Font { static func app(_ s: CGFloat) -> Font { .custom("Inter", size: s * 1.2) } }',
        'extension Font { static func plain(size: CGFloat) -> Font { .custom("Inter", size: size) } }',
        "a.font(.app(14))",
        "b.font(.plain(size: 14))",
      ].join("\n"),
    );
    expect(typeStyles.map((s) => [s.name, s.size])).toEqual([
      ["app", undefined],
      ["plain 14", 14],
    ]);
  });

  it("counts a font with a system fallback once, as the font, and keeps a helper's family", async () => {
    const { typeStyles } = await tokens(
      [
        'let f = UIFont(name: "Inter-Bold", size: 17) ?? .systemFont(ofSize: 17, weight: .bold)',
        'extension Font { static func inter(_ s: CGFloat) -> Font { Font(UIFont(name: "Inter", size: s) ?? UIFont.systemFont(ofSize: s)) } }',
        "a.font(.inter(12))",
      ].join("\n"),
    );
    expect(typeStyles.map((s) => [s.name, s.family, s.size])).toEqual([
      ["inter 12", "Inter", 12],
      ["Inter 17 bold", "Inter", 17],
    ]);
  });
});

describe("fonts read with the Swift reader", () => {
  it("reads UIKit and AppKit font helpers, with weights and sizes changed after them", async () => {
    const { typeStyles } = await tokens(
      [
        "extension UIFont { class var dynamicTypeBody: UIFont { UIFont.preferredFont(forTextStyle: .body) } }",
        "let a = UIFont.dynamicTypeBody",
        "let b = UIFont.dynamicTypeBody.semibold()",
        "let c = UIFont.dynamicTypeBody.withSize(32)",
        'let d = NSFont(name: "Inter-Bold", size: 13)',
      ].join("\n"),
    );
    expect(summary(typeStyles)).toEqual([
      ["dynamicTypeBody", 17, "regular", 1],
      ["dynamicTypeBody 32", 32, "regular", 1],
      ["dynamicTypeBody semibold", 17, "semibold", 1],
      ["Inter 13 bold", 13, "bold", 1],
    ]);
  });

  it("doesn't count a measurement read from a font as a font, but does its descriptor", async () => {
    const { typeStyles } = await tokens(
      [
        "let h = UIFont.systemFont(ofSize: 12).lineHeight",
        "let d = UIFont.systemFont(ofSize: 10, weight: .regular).fontDescriptor",
      ].join("\n"),
    );
    expect(summary(typeStyles)).toEqual([["System 10", 10, "regular", 1]]);
  });

  it("reads the font inside a cast, and SwiftUI.Font written out", async () => {
    const { typeStyles } = await tokens(
      [
        "a.font(Font(UIFontMetrics(forTextStyle: .body).scaledFont(for: .systemFont(ofSize: 17)) as CTFont))",
        "let b = SwiftUI.Font.system(size: 11, weight: .semibold).width(.condensed)",
      ].join("\n"),
    );
    expect(summary(typeStyles)).toEqual([
      ["System 11 semibold", 11, "semibold", 1],
      ["System 17", 17, "regular", 1],
    ]);
  });

  it("reads a UIKit text style, caption1 included, and a font passed as an attribute", async () => {
    const { typeStyles } = await tokens(
      [
        "let a = UIFont.preferredFont(forTextStyle: .caption1)",
        "let s = NSAttributedString(string: t, attributes: [.font: UIFont.systemFont(ofSize: 14, weight: .medium)])",
      ].join("\n"),
    );
    expect(summary(typeStyles)).toEqual([
      ["caption1", 12, "regular", 1],
      ["System 14 medium", 14, "medium", 1],
    ]);
  });

  it("stops a font's weight changes at a later .font(…), which replaces it", async () => {
    const { typeStyles } = await tokens("a.font(.title).font(.body).bold()");
    expect(summary(typeStyles)).toEqual([
      ["body bold", 17, "bold", 1],
      ["title", 28, "regular", 1],
    ]);
  });

  it("keeps a helper's font once when its body is a font written on its own", () => {
    const text = "extension UIFont {\n  class var x: UIFont { UIFont.preferredFont(forTextStyle: .body) }\n}";
    const { helperFonts } = swiftType([
      {
        rel: "F.swift",
        text,
        code: withoutPreviews(codeOnly(text)),
        lines: text.split("\n"),
        swiftUI: false,
      },
    ]);
    expect(helperFonts.map((u) => [u.style, u.line])).toEqual([["body", 2]]);
  });

  it("knows where each font is set, and where the app's helpers write theirs", () => {
    const source = (rel: string, text: string) => {
      const code = withoutPreviews(codeOnly(text));
      return { rel, text, code, lines: text.split("\n"), swiftUI: true };
    };
    const { uses, helperFonts } = swiftType([
      source("Fonts.swift", 'extension Font {\n  static let brand: Font = .custom("Inter", size: 15)\n}'),
      source("View.swift", "let a = Text(x)\n  .font(.brand)"),
    ]);
    expect(uses.map((u) => [u.style, u.file, u.line])).toEqual([["brand", "View.swift", 2]]);
    expect(helperFonts.map((u) => [u.family, u.file, u.line])).toEqual([["Inter", "Fonts.swift", 2]]);
  });
});

describe("helpers in this rebuild's reviews", () => {
  it("lists every family a helper switches between, even when they differ", async () => {
    const { fonts } = await tokens(
      [
        "enum T { static func f(_ s: S) -> UIFont { switch s {",
        '  case .a: return UIFont(name: "Lora", size: 17)!',
        '  case .b: return UIFont(name: "Inter-Bold", size: 17)!',
        "} } }",
        'let y = Text(x).font(.custom("Merriweather", size: 12))',
        "let x = T.f(.a)",
      ].join("\n"),
    );
    // A used family comes first; then those written only in helpers, in the order they're written.
    expect(fonts).toEqual(["Merriweather", "Lora", "Inter"]);
  });

  it("tells a helper function from a property of the same name", async () => {
    const { typeStyles } = await tokens(
      [
        "extension Font {",
        "  static var brand: Font { .system(size: 17) }",
        '  static func brand(size: CGFloat) -> Font { .custom("Inter", size: size) }',
        "}",
        "a.font(.brand)",
        "b.font(.brand(size: 24))",
      ].join("\n"),
    );
    expect(typeStyles.map((s) => [s.name, s.family, s.size])).toEqual([
      ["brand", "System", 17],
      ["brand 24", "Inter", 24],
    ]);
  });

  it("reads only a plain conversion as a written size, not a computed one", async () => {
    const { typeStyles } = await tokens(
      [
        'a.font(.custom("Inter", size: CGFloat(14)))',
        'b.font(.custom("Inter", size: adaptive(14)))',
        'c.font(.custom("Inter", size: CGFloat(exactly: 15)))',
      ].join("\n"),
    );
    expect(summary(typeStyles)).toEqual([
      ["Inter, computed size", undefined, "regular", 2],
      ["Inter 14", 14, "regular", 1],
    ]);
  });
});
