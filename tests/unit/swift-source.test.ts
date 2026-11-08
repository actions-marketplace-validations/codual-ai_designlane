import { describe, expect, it } from "vitest";
import { codeOnly, structs, withoutPreviews } from "../../src/frameworks/swift-source.js";

describe("codeOnly", () => {
  it("blanks comments and strings but keeps code, newlines and offsets", () => {
    const text =
      'let a = 1 // struct A: View {\n/* struct B: View { /* nested */ } */ let s = "struct C: View {"\n';
    const code = codeOnly(text);
    expect(code).toHaveLength(text.length);
    expect(code.split("\n")).toHaveLength(3);
    expect(code).toContain("let a = 1");
    expect(code).toContain("let s =");
    expect(code).not.toMatch(/struct/);
  });

  it("handles escaped quotes, multi-line and raw strings", () => {
    const text =
      'let a = "x\\"struct A: View {"\nlet b = """\nstruct B: View {\n"""\nlet c = #"struct C: View { "quoted" }"#\nstruct D {}';
    const code = codeOnly(text);
    expect(code).not.toMatch(/struct [ABC]/);
    expect(code).toContain("struct D {}");
  });
});

it("withoutPreviews blanks #Preview blocks, including views declared inside them", () => {
  const text =
    "struct A: View {}\n#Preview {\n  struct Wrapper: View { var body: some View { A() } }\n  return Wrapper()\n}\nstruct B: View {}";
  const code = withoutPreviews(codeOnly(text));
  expect(structs(code).map((s) => s.name)).toEqual(["A", "B"]);
});

describe("structs", () => {
  it("reads names, conformances and bodies", () => {
    const [view] = structs("struct Home: View, Equatable {\n  var body: some View { Text() }\n}");
    expect(view).toMatchObject({ name: "Home", conformances: ["View", "Equatable"] });
  });

  it("reads multi-line, generic and constrained declarations", () => {
    const decls = structs(
      "struct Grid<T: Collection<Int>>: View {}\nstruct Box<T>: Equatable where T: View {}\nstruct List2:\n  View,\n  Sendable\n{}",
    );
    expect(decls.map((d) => [d.name, d.conformances])).toEqual([
      ["Grid", ["View"]],
      ["Box", ["Equatable"]],
      ["List2", ["View", "Sendable"]],
    ]);
  });

  it("finds the matching closing brace for nested bodies", () => {
    const text = "struct Outer: View { struct Inner: View { var x = { 1 }() } var y = 2 }";
    const [outer, inner] = structs(text);
    expect(text.slice(outer!.open, outer!.close + 1)).toBe(text.slice(text.indexOf("{")));
    expect(text.slice(inner!.open, inner!.close + 1)).toBe("{ var x = { 1 }() }");
  });

  it("doesn't let an unclosed parenthesis swallow a struct's closing brace", () => {
    const text = "struct A: View { f(1 }\nstruct B: View { Text() }";
    const [a, b] = structs(text);
    expect(a?.close).toBe(text.indexOf("}"));
    expect(b?.close).toBe(text.length - 1);
  });

  it("stays fast on pathological input", () => {
    const hostile = [
      `${"(".repeat(100_000)}${"}".repeat(100_000)}`,
      "struct A: x ".repeat(40_000),
      `let a${" ".repeat(200_000)}=`,
      "#Preview {".repeat(20_000),
    ];
    for (const text of hostile) {
      const started = performance.now();
      structs(withoutPreviews(codeOnly(text)));
      expect(performance.now() - started).toBeLessThan(1000);
    }
  });
});
