import { describe, expect, it } from "vitest";
import {
  argumentsAt,
  chain,
  type Expression,
  expressionAt,
  subexpressions,
} from "../../src/frameworks/swift-expressions.js";
import { swiftTokens } from "../../src/frameworks/swift-tokens.js";

/** The expression at the start of `code`, written back compactly so tests read like the Swift they check. */
function read(code: string): string {
  const e = expressionAt(swiftTokens(code), 0);
  return e ? show(e, code) : "nothing";
}

/** The source text of the expression read from `from` (an offset, or the first place a string appears). */
function spanAt(code: string, from: number | string): string {
  const e = expressionAt(swiftTokens(code), typeof from === "number" ? from : code.indexOf(from));
  return e ? code.slice(e.start, e.end) : "nothing";
}

/** `unit` repeated to fill 512KB, the largest file the scanner reads, after `head`. */
const fill = (unit: string, head = "") =>
  head + unit.repeat(Math.floor((512 * 1024 - head.length) / unit.length));

function show(e: Expression, code: string): string {
  switch (e.kind) {
    case "name":
      return e.name;
    case "number":
      return String(e.value);
    case "string":
      return JSON.stringify(e.value) + (e.interpolated ? "~" : "");
    case "member":
      return `${e.base ? show(e.base, code) : ""}.${e.name}`;
    case "call":
    case "subscript": {
      const args = e.args.map((a) => `${a.label ? `${a.label}: ` : ""}${show(a.value, code)}`).join(", ");
      const callee = show(e.kind === "call" ? e.callee : e.base, code);
      return e.kind === "call" ? `${callee}(${args})` : `${callee}[${args}]`;
    }
    case "ternary":
      return `(${show(e.condition, code)} ? ${show(e.then, code)} : ${show(e.otherwise, code)})`;
    case "binary":
      return `(${show(e.left, code)} ${e.operator} ${show(e.right, code)})`;
    case "prefix":
      return `${e.operator}${show(e.operand, code)}`;
    case "postfix":
      return `${show(e.operand, code)}${e.operator}`;
    case "opaque":
      return `‹${code.slice(e.start, e.end)}›`;
  }
}

describe("calls and arguments", () => {
  it("reads labelled and unlabelled arguments, nested calls included", () => {
    expect(read(".system(size: CGFloat(17), weight: .bold)")).toBe(
      ".system(size: CGFloat(17), weight: .bold)",
    );
    expect(read('UIFont(name: "Inter-Bold", size: 17)')).toBe('UIFont(name: "Inter-Bold", size: 17)');
  });

  it("reads keyword labels", () => {
    expect(read("T.font(for: .title, in: ctx)")).toBe("T.font(for: .title, in: ctx)");
  });

  it("reads the arguments of a bracket by its offset", () => {
    const code = "x.font(.headline, weight: .bold)";
    const args = argumentsAt(swiftTokens(code), code.indexOf("("));
    expect(args?.map((a) => [a.label, a.value.kind])).toEqual([
      [undefined, "member"],
      ["weight", "member"],
    ]);
  });

  it("keeps trailing closures whole, labelled ones too", () => {
    expect(read("Button(action: go) { Text(x) } label: { Image(y) }")).toBe(
      "Button(action: go, ‹{ Text(x) }›, label: ‹{ Image(y) }›)",
    );
  });

  it("takes only one run of trailing closures", () => {
    expect(read("f {} {}")).toBe("f(‹{}›)");
  });

  it("doesn't take a ( on the next line as a call", () => {
    expect(read("font\n(x)")).toBe("font");
  });
});

describe("member chains", () => {
  it("reads chains with implicit members, across lines", () => {
    expect(read(".title.bold()")).toBe(".title.bold()");
    expect(read("Font.system(size: 17)\n  .weight(.bold)")).toBe("Font.system(size: 17).weight(.bold)");
  });

  it("reads tuple indexes as members", () => {
    const e = expressionAt(swiftTokens("t.0.1"), 0);
    expect(e && chain(e).links.map((l) => l.name)).toEqual(["0", "1"]);
  });

  it("splits a chain into its root and links", () => {
    const code = "Font.system(size: 17).weight(.bold)";
    const e = expressionAt(swiftTokens(code), 0);
    const { root, links } = chain(e as Expression);
    expect(root?.kind === "name" && root.name).toBe("Font");
    expect(links.map((l) => [l.name, l.args?.length])).toEqual([
      ["system", 1],
      ["weight", 1],
    ]);
  });

  it("gives an implicit member chain no root", () => {
    const e = expressionAt(swiftTokens(".title.bold()"), 0);
    const implicit = e && chain(e);
    expect([implicit?.root, implicit?.links.map((l) => l.name)]).toEqual([undefined, ["title", "bold"]]);
  });

  it("reads force unwraps, optional chaining and subscripts", () => {
    expect(read('UIFont(name: "X", size: 1)!')).toBe('UIFont(name: "X", size: 1)!');
    expect(read("a?.b[0]")).toBe("a?.b[0]");
  });
});

describe("operators", () => {
  it("reads ternaries, `??` fallbacks and arithmetic with Swift's precedence", () => {
    expect(read("on ? .title : .body")).toBe("(on ? .title : .body)");
    expect(read('UIFont(name: "X", size: 1) ?? .systemFont(ofSize: 1)')).toBe(
      '(UIFont(name: "X", size: 1) ?? .systemFont(ofSize: 1))',
    );
    expect(read("a ?? b ?? c")).toBe("(a ?? (b ?? c))");
    expect(read("base * 1.2 + 2")).toBe("((base * 1.2) + 2)");
    expect(read("a == b ? 1 : 2")).toBe("((a == b) ? 1 : 2)");
    expect(read("a || b ? .black : Color(white: 0.5)")).toBe("((a || b) ? .black : Color(white: 0.5))");
  });

  it("tells prefix minus from subtraction by spacing", () => {
    expect(read("f(x: -1)")).toBe("f(x: -1)");
    expect(read("a - 1")).toBe("(a - 1)");
    expect(read("a-1")).toBe("(a - 1)");
    expect(read("a\n-1")).toBe("a");
  });

  it("stops at an assignment", () => {
    expect(read("x = .title")).toBe("x");
    expect(read("x += 1")).toBe("x");
  });

  it("reads casts, keeping the type whole", () => {
    expect(read("x as? UIFont")).toBe("(x as? ‹UIFont›)");
  });

  it("applies stacked prefix operators innermost first", () => {
    const e = expressionAt(swiftTokens("-...x"), 0) as Expression;
    expect(e.kind === "prefix" && [e.operator, e.operand.kind === "prefix" && e.operand.operator]).toEqual([
      "-",
      "...",
    ]);
  });

  it("reads an operator with nothing after it as applying to what came before", () => {
    expect(read("colors[1...]")).toBe("colors[1...]");
    expect(read("f(x: a...)")).toBe("f(x: a...)");
  });

  it("stops before a custom operator rather than guess its precedence", () => {
    expect(read("a <> b + c")).toBe("a");
  });

  it("gives bit shifts their precedence, above multiplication", () => {
    expect(read("Double(hex >> 16 & 0xFF)")).toBe("Double(((hex >> 16) & 255))");
  });

  it("reads a ternary inside a ternary's middle", () => {
    expect(read("a ? b ? c : d : e")).toBe("(a ? (b ? c : d) : e)");
  });

  it("skips try and await", () => {
    expect(read("try await load()")).toBe("load()");
  });
});

describe("what it keeps whole", () => {
  it("keeps closures, collections, key paths and if/switch values opaque", () => {
    expect(read("{ $0 + 1 }")).toBe("‹{ $0 + 1 }›");
    expect(read("[.title, .body]")).toBe("‹[.title, .body]›");
    expect(read("\\Font.body")).toBe("‹\\Font.body›");
    expect(read("switch s { case .a: 1 default: 2 }")).toBe("‹switch s { case .a: 1 default: 2 }›");
    expect(read("if a { 1 } else if b { 2 } else { 3 }")).toBe("‹if a { 1 } else if b { 2 } else { 3 }›");
  });

  it("keeps a malformed argument whole up to the next comma", () => {
    expect(read("f(a b, c: 1)")).toBe("f(‹a b›, c: 1)");
  });

  it("keeps an empty argument's span just after its label", () => {
    const code = "f(a: , b)";
    const e = expressionAt(swiftTokens(code), 0);
    const empty = e?.kind === "call" ? e.args[0]?.value : undefined;
    expect(empty && [empty.start, empty.end]).toEqual([4, 4]);
  });

  it("reads `(x)` as x and keeps tuples whole", () => {
    expect(read("(a + b) * 2")).toBe("((a + b) * 2)");
    expect(read("(a, b)")).toBe("‹(a, b)›");
  });
});

describe("literals", () => {
  it("reads strings, raw and interpolated, and numbers", () => {
    expect(read('"Inter"')).toBe('"Inter"');
    expect(read('"\\(base)-Bold"')).toBe('"\\\\(base)-Bold"~');
    expect(read('#"a"b"#')).toBe('"a\\"b"');
    expect(read("1_000.5")).toBe("1000.5");
  });

  it("reads a literal written with #, like #colorLiteral, as a call", () => {
    expect(read("#colorLiteral(red: 1)")).toBe("#colorLiteral(red: 1)");
  });

  it("reads strings whose interpolations hold quotes and brackets", () => {
    expect(read('Text("\\(count ?? "-")")')).toBe('Text("\\\\(count ?? \\"-\\")"~)');
    expect(read('Text("\\(a ? "(" : "x")", style: s)')).toBe(
      'Text("\\\\(a ? \\"(\\" : \\"x\\")"~, style: s)',
    );
  });

  it("tells an escaped backslash from an interpolation", () => {
    expect(read('"a\\\\(x)"')).toBe('"a\\\\\\\\(x)"');
  });

  it("tells a raw string's text from its interpolation", () => {
    expect(read('#"\\(x)"#')).toBe('"\\\\(x)"');
    expect(read('#"\\#(x)"#')).toBe('"\\\\#(x)"~');
  });

  it("keeps a number it can't read whole", () => {
    expect(read("0x1p3")).toBe("‹0x1p3›");
  });

  it("ignores comments", () => {
    expect(read("f(/* a */ x, // b\n y)")).toBe("f(x, y)");
  });
});

describe("where it reads", () => {
  it("stays inside the bracket around the starting point", () => {
    expect(spanAt("f(a, b)", "a")).toBe("a");
  });

  it("gives every subexpression with offsets into the source", () => {
    const code = "x.font(on ? .a : .b)";
    const e = expressionAt(swiftTokens(code), 0);
    const members = e ? [...subexpressions(e)].filter((s) => s.kind === "member") : [];
    expect(members.map((m) => code.slice(m.start, m.end))).toEqual(["x.font", ".a", ".b"]);
  });
});

describe("types", () => {
  it("reads generic types as types, not comparisons", () => {
    expect(read("Array<Color>(repeating: .red, count: 3)")).toBe("Array(repeating: .red, count: 3)");
    expect(read("Binding<Set<Int>>(get: g, set: s)")).toBe("Binding(get: g, set: s)");
    expect(read("a < b && c > d")).toBe("((a < b) && (c > d))");
    expect(read("a<b>c")).toBe("((a < b) > c)");
  });

  it("reads function types inside generic arguments", () => {
    expect(read("Array<(Int) -> Void>()")).toBe("Array()");
  });

  it("reads a cast's type whole: collections, generics, some/any and function types", () => {
    expect(read("x as? [Color]")).toBe("(x as? ‹[Color]›)");
    expect(read("x as? Font<A>")).toBe("(x as? ‹Font<A>›)");
    expect(read("x as any View")).toBe("(x as ‹any View›)");
    expect(read("x as (Int) -> Color")).toBe("(x as ‹(Int) -> Color›)");
    expect(read("x as (Int) throws -> Void")).toBe("(x as ‹(Int) throws -> Void›)");
  });

  it("ends a cast's type at the line, and before a keyword", () => {
    expect(read("value as? UIFont\nfoo.bar = 1")).toBe("(value as? ‹UIFont›)");
    expect(spanAt("guard let f = v as? UIFont else { return }", "v as?")).toBe("v as? UIFont");
  });
});

describe("keywords", () => {
  it("never reads a declaration or statement keyword as a value", () => {
    for (const code of [
      "func foo(x: Int) { go() }",
      "init(x: Int) { }",
      "do { try go() }",
      "for x in y { }",
    ]) {
      expect(read(code)).toBe("nothing");
    }
  });

  it("reads get and set as ordinary names outside an accessor", () => {
    expect(read("f(set)")).toBe("f(set)");
  });
});

describe("bodies that aren't trailing closures", () => {
  it("never takes a statement's body for a trailing closure", () => {
    for (const [code, from] of [
      ["if let f = UIFont(name: n, size: 12) { use(f) }", "UIFont"],
      ["while ok { step() }", "ok"],
      ["for c in colors { draw(c) }", "colors"],
      ["do { try go() } catch MyError.bad { retry() }", "MyError"],
      ["if case .some(let c) = loadColor(named: n) { use(c) }", "loadColor"],
      ["for case let c? in colors { draw(c) }", "colors"],
      ["if let a = b, case .x = theme { go() }", "theme"],
      ["switch theme.font { case .a: 1 }", "theme"],
    ] as const) {
      expect(spanAt(code, from)).not.toContain("{");
    }
  });

  it("allows a trailing closure inside a condition's parentheses", () => {
    expect(spanAt("if items.contains(where: { $0.on }) { go() }", "items")).toBe(
      "items.contains(where: { $0.on })",
    );
    expect(spanAt("if a(x), let f = UIFont(name: n, size: 1) { use(f) }", "UIFont")).toBe(
      "UIFont(name: n, size: 1)",
    );
  });

  it("never takes a declaration's body for a trailing closure", () => {
    for (const [code, from] of [
      ["extension Color { static let a = 1 }", "Color"],
      ["var accent: Color { .blue }", "Color"],
      ["func tint() -> Color { .red }", "Color"],
      ["var body: some View { Text(a) }", "View"],
    ] as const) {
      expect(spanAt(code, from)).toBe(from);
    }
  });

  it("takes a trailing closure after a case label", () => {
    expect(spanAt("switch tab { case .home: VStack { Text(a) } }", "VStack")).toBe("VStack { Text(a) }");
  });

  it("never takes a property's observers or an accessor's body for a trailing closure", () => {
    expect(spanAt("var accent: Color = .blue { didSet { save() } }", ".blue")).toBe(".blue");
    expect(spanAt("@Published var accent = Color.blue { willSet { a() } }", "Color")).toBe("Color.blue");
    expect(read("get { 1 }")).toBe("get");
  });

  it("doesn't take a ternary's : for a type annotation", () => {
    expect(spanAt('x ? a : Button("b") { go() }', "Button")).toBe('Button("b") { go() }');
  });

  it("doesn't let a case or a ternary on an earlier line change how this one reads", () => {
    expect(spanAt("enum Theme {\n  case light, dark\n  var accent: Color { .blue }\n}", "Color")).toBe(
      "Color",
    );
    expect(spanAt("@State var x = a ? b : c\nvar body: some View { Text(a) }", "View")).toBe("View");
  });

  it("reads a condition continued over several lines as one", () => {
    for (const code of [
      "if let a = b,\n  let f = UIFont(name: n, size: 1) { use(f) }",
      "if let a = foo(x)\n   , let f = UIFont(name: n, size: 1) { use(f) }",
      "if\n let f = UIFont(name: n, size: 1) { use(f) }",
    ]) {
      expect(spanAt(code, "UIFont")).toBe("UIFont(name: n, size: 1)");
    }
  });
});

describe("compiler directives", () => {
  it("reads a modifier chain across #if lines", () => {
    expect(read("Text(a)\n#if os(iOS)\n.font(.title)\n#endif")).toBe("Text(a).font(.title)");
  });

  it("takes trailing closures under #if", () => {
    expect(spanAt("#if DEBUG\nButton(go) { Text(a) }\n#endif", "Button")).toBe("Button(go) { Text(a) }");
  });

  it("makes a chain with #else opaque rather than join its two alternatives", () => {
    const code = "Text(a)\n#if os(iOS)\n.font(.title)\n#else\n.font(.body)\n#endif";
    expect(expressionAt(swiftTokens(code), 0)?.kind).toBe("opaque");
  });

  it("keeps a view readable when an #else around it has no chain link after it", () => {
    expect(read('Text("a").font(.title)\n#else\nText("b")\n#endif')).toBe('Text("a").font(.title)');
  });

  it("gives no arguments rather than part of them when the read can't finish", () => {
    const code = "f(Text(a)\n#if X\n.bold()\n#else\n.italic()\n#endif, weight: .bold)";
    expect(argumentsAt(swiftTokens(code), code.indexOf("("))).toBeUndefined();
  });

  it("reads #if itself as no expression", () => {
    expect(read("#if DEBUG")).toBe("nothing");
  });
});

describe("hostile input", () => {
  it("reads any 512KB hostile file quickly, from its start or its middle", () => {
    for (const code of [
      fill(".font(a)", "x"),
      fill("a<a"),
      fill(" + 1", "x"),
      `${fill("try ")}x`,
      fill("if "),
      fill("\n#if X\n.b", "a"),
      fill("(", "f"),
      `x as ${fill("a.")}b`,
    ]) {
      const file = swiftTokens(code);
      const started = performance.now();
      expressionAt(file, 0);
      expressionAt(file, code.length >> 1);
      expect(performance.now() - started).toBeLessThan(100);
    }
  });

  it("reads every call's arguments in a 512KB file quickly, hostile or not", () => {
    for (const code of [
      fill(".font(.title)", "Text(a)"),
      fill('Text("a").font(.system(size: 17, weight: .bold))\n'),
      fill("("),
      fill("f(a, "),
      fill(".font("),
      `${fill("f(a, ").slice(0, 256 * 1024)}${")".repeat(50_000)}`,
    ]) {
      const file = swiftTokens(code);
      const started = performance.now();
      for (const token of file.tokens) if (token.text === "(") argumentsAt(file, token.start);
      expect(performance.now() - started).toBeLessThan(5000);
    }
  });

  it("reads an expression too long to be real as one opaque span", () => {
    expect(expressionAt(swiftTokens(`x${".a".repeat(1000)}`), 0)?.kind).toBe("opaque");
    expect(expressionAt(swiftTokens(`x${".a".repeat(100)}`), 0)?.kind).toBe("member");
  });

  it("stays fast and doesn't overflow on deep nesting, long chains or unclosed brackets", () => {
    for (const code of [
      "f(".repeat(50_000),
      `${"(".repeat(20_000)}x${")".repeat(20_000)}`,
      `a${".b".repeat(100_000)}`,
      "a ? ".repeat(20_000),
      `x${" + 1".repeat(100_000)}`,
      "[{(".repeat(30_000),
      `x${"{}".repeat(50_000)}`,
      "{".repeat(100_000),
      `${"-...".repeat(100_000)}x`,
    ]) {
      const started = performance.now();
      const file = swiftTokens(code);
      for (let offset = 0; offset < code.length; offset += Math.ceil(code.length / 50))
        expressionAt(file, offset);
      expect(performance.now() - started).toBeLessThan(1000);
    }
  });
});
