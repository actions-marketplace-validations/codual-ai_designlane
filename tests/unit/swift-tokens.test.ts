import { describe, expect, it } from "vitest";
import { swiftTokens } from "../../src/frameworks/swift-tokens.js";

const texts = (code: string) => swiftTokens(code).tokens.map((t) => t.text);
const kinds = (code: string) => swiftTokens(code).tokens.map((t) => `${t.kind}:${t.text}`);

describe("tokens", () => {
  it("splits names, numbers, strings, operators and punctuation", () => {
    expect(kinds('let x = .custom("Inter", size: 1.5)')).toEqual([
      "name:let",
      "name:x",
      "operator:=",
      "punctuation:.",
      "name:custom",
      "punctuation:(",
      'string:"Inter"',
      "punctuation:,",
      "name:size",
      "punctuation::",
      "number:1.5",
      "punctuation:)",
    ]);
  });

  it("reads Swift's own names and numbers: backticks, unicode, $0, hex, underscores", () => {
    expect(texts("`default` café $0 0xFF_00 1_000 1e3")).toEqual([
      "`default`",
      "café",
      "$0",
      "0xFF_00",
      "1_000",
      "1e3",
    ]);
  });

  it("reads operators whole, ranges included, and keeps 1...5 apart", () => {
    expect(texts("a ?? b != c 1...5 0..<n x?.y")).toEqual([
      "a",
      "??",
      "b",
      "!=",
      "c",
      "1",
      "...",
      "5",
      "0",
      "..<",
      "n",
      "x",
      "?",
      ".",
      "y",
    ]);
  });

  it("ends an operator before a comment, and a hex number before a member", () => {
    expect(texts("a+// note\nb")).toEqual(["a", "+", "b"]);
    expect(texts("0xFF.description 0x1.8p1")).toEqual(["0xFF", ".", "description", "0x1.8p1"]);
  });

  it("reads raw, multi-line and escaped strings whole", () => {
    expect(texts('#"a"b"# """\nline "x"\n""" "q\\"q"')).toEqual(['#"a"b"#', '"""\nline "x"\n"""', '"q\\"q"']);
  });

  it("marks what comes before each token: a space, or a line break", () => {
    const flags = swiftTokens("a.b (c)\n  .d").tokens.map((t) => [t.text, t.spaceBefore, t.newlineBefore]);
    expect(flags).toEqual([
      ["a", true, false],
      [".", false, false],
      ["b", false, false],
      ["(", true, false],
      ["c", false, false],
      [")", false, false],
      [".", true, true],
      ["d", false, false],
    ]);
  });

  it("skips comments, nested ones too, treating them as the space or line break they span", () => {
    const tokens = swiftTokens("a /* x /* y */ z */ b // c\nd").tokens;
    expect(tokens.map((t) => [t.text, t.spaceBefore, t.newlineBefore])).toEqual([
      ["a", true, false],
      ["b", true, false],
      ["d", true, true],
    ]);
  });

  it("skips #Preview blocks", () => {
    expect(texts('#Preview { Text("a") }\nlet x')).toEqual(["let", "x"]);
  });
});

describe("brackets", () => {
  it("pairs each bracket with its close, and knows the bracket around every token", () => {
    const { tokens, match, enclosing } = swiftTokens("f(a[0], { b })");
    const at = (text: string) => tokens.findIndex((t) => t.text === text);
    expect(match[at("(")]).toBe(at(")"));
    expect(match[at("[")]).toBe(at("]"));
    expect(match[at("{")]).toBe(at("}"));
    expect(enclosing[at("b")]).toBe(at("{"));
    expect(enclosing[at("a")]).toBe(at("("));
  });

  it("doesn't let an unclosed ( swallow a }", () => {
    const { tokens, match } = swiftTokens("struct A { f( }");
    expect(match[tokens.findIndex((t) => t.text === "{")]).toBe(tokens.length - 1);
  });
});

describe("hostile input", () => {
  it("stays fast on long runs, unclosed strings and comments, and deep brackets", () => {
    for (const code of [
      "+".repeat(500_000),
      `"${"a".repeat(500_000)}`,
      `/*${"/*".repeat(100_000)}`,
      "(".repeat(200_000),
      `a${" ".repeat(500_000)}b`,
      "x.".repeat(200_000),
    ]) {
      const started = performance.now();
      swiftTokens(code);
      expect(performance.now() - started).toBeLessThan(1000);
    }
  });
});
