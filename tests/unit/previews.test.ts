import { readFile, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  loadPreviews,
  previewDocument,
  previewFile,
  previewVariables,
  problemWith,
  savePreview,
} from "../../src/previews/previews.js";
import { catalogOf, named, swift } from "../helpers/catalog.js";
import { tempDir } from "../helpers/temp.js";

const APP = {
  "App/Colors.swift": swift("enum Theme { static let brand = Color(red: 0.2, green: 0.4, blue: 0.9) }"),
  "App/Row.swift": swift(
    "struct PriceRow: View { let price: String; var body: some View { Text(price).foregroundStyle(Theme.brand) } }",
  ),
  "App/Home.swift": swift(
    "struct Home: View { var body: some View { NavigationStack { PriceRow(price: p).navigationTitle(t) } } }",
  ),
};

describe("preview rules", () => {
  it("accepts plain HTML, styles and inline SVG with its namespace", () => {
    expect(
      problemWith(
        '<style>.a{color:var(--color-brand)}</style><svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg><img src="data:image/png;base64,AA">',
      ),
    ).toBeUndefined();
  });

  it.each([
    ["", "empty"],
    ["<script>alert(1)</script>", "scripts"],
    ['<div onclick="x()">a</div>', "scripts"],
    ['<a href="javascript:x()">a</a>', "scripts"],
    ['<iframe src="data:text/html,a"></iframe>', "plain HTML"],
    ['<link rel="stylesheet" href="a.css">', "plain HTML"],
    ['<meta http-equiv="refresh" content="0">', "plain HTML"],
    ['<img src="https://example.com/a.png">', "external"],
    ['<img src="//example.com/a.png">', "external"],
    ['<img srcset="https://example.com/a.png 2x">', "external"],
    ["<div style=\"background:url('//example.com/a.png')\"></div>", "external"],
    ['<style>@import "a.css";</style>', "external"],
    [`<p>${"a".repeat(100_001)}</p>`, "100 KB"],
  ])("refuses %s", (html, reason) => {
    expect(problemWith(html)?.toLowerCase()).toContain(reason.toLowerCase());
  });
});

describe("saved previews", () => {
  it("saves a picture, loads it back, and says when the component's code changed since", async () => {
    const { components } = await catalogOf(APP);
    const row = named(components, "PriceRow");
    const outDir = await tempDir();
    const file = await savePreview(outDir, row, "  <b>$4.99</b>\n");
    expect(file).toBe(previewFile(outDir, row));
    expect(await loadPreviews(outDir, components)).toEqual(
      new Map([[row.id, { html: "<b>$4.99</b>\n", stale: false }]]),
    );
    const changed = { ...row, source: `${row.source} ` };
    expect((await loadPreviews(outDir, [changed])).get(row.id)).toEqual({
      html: "<b>$4.99</b>\n",
      stale: true,
    });
  });

  it("refuses to save a picture breaking a rule, and leaves out one edited to break it since", async () => {
    const { components } = await catalogOf(APP);
    const row = named(components, "PriceRow");
    const outDir = await tempDir();
    await expect(savePreview(outDir, row, "<script>x</script>")).rejects.toThrow(/scripts/);
    const file = await savePreview(outDir, row, "<b>a</b>");
    await writeFile(file, `${await readFile(file, "utf8")}<img src="https://example.com/a.png">`);
    const loaded = (await loadPreviews(outDir, components)).get(row.id);
    expect(loaded && "problem" in loaded && loaded.problem).toMatch(/external URLs/);
  });

  it("keeps two components sharing a name apart", async () => {
    const outDir = "/out";
    const a = previewFile(outDir, { name: "Row", file: "A/Row.swift", framework: "swiftui" });
    const b = previewFile(outDir, { name: "Row", file: "B/Row.swift", framework: "swiftui" });
    expect(a).not.toBe(b);
    expect(previewFile(outDir, { name: "../x", file: "A/Row.swift", framework: "swiftui" })).toMatch(
      /previews[/\\]x-/,
    );
  });
});

describe("a preview's page", () => {
  const tokens = {
    colors: [
      {
        name: "brand",
        light: "#3366e6",
        dark: "#99aaff",
        source: "a",
        kind: "code",
        uses: 1,
        reference: "Theme.brand",
      },
      {
        name: "bad",
        light: "red;}body{background:url(//x)",
        source: "a",
        kind: "code",
        uses: 1,
        reference: "Theme.bad",
      },
    ],
    systemColors: [],
    typeStyles: [],
    fonts: ['Inter"; } * { background: url(//x) } '],
    spacing: [],
    radii: [],
  } as const;
  const copy = JSON.parse(JSON.stringify(tokens));

  it("gives the app's colours as variables that switch in dark mode, and fetches nothing", () => {
    const page = previewDocument("<b>a</b>", copy);
    expect(page).toContain("--color-brand: #3366e6;");
    expect(page).toMatch(/prefers-color-scheme:dark\)\{:root\{--color-brand: #99aaff;\}/);
    expect(page).toContain(
      `content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:"`,
    );
    expect(page).not.toContain("url(//x)");
    expect(previewVariables(copy)).toContain("--color-brand (#3366e6, dark #99aaff)");
  });
});
