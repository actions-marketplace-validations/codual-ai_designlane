import { chmod, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../../src/cli/run.js";
import { tempDir } from "../helpers/temp.js";

const APP = {
  "App/Theme.swift":
    "import SwiftUI\nenum Theme { static let brand = Color(red: 0.2, green: 0.4, blue: 0.9) }",
  "App/Home.swift": [
    "import SwiftUI",
    "struct Home: View {",
    "  var body: some View { NavigationStack { List { Text(t) }.navigationTitle(t).tint(Theme.brand) } }",
    "}",
  ].join("\n"),
};

async function designmap(...argv: string[]) {
  const out: string[] = [];
  const error: string[] = [];
  const code = await run(argv, { out: (t) => out.push(t), error: (t) => error.push(t) });
  return { code, out: out.join("\n"), error: error.join("\n") };
}

describe("designmap [dir]", () => {
  it("writes tokens.json and DESIGN.md into designmap/ and says what it found", async () => {
    const root = await tempDir(APP);
    const { code, out } = await designmap(root);
    expect(code).toBe(0);
    expect(out).toContain(`${path.basename(root)}: 1 screen, 0 components`);
    expect(out).toContain("1 colour, 0 text styles");
    expect(out).toContain("most used colours: brand (1)");
    expect(await readFile(path.join(root, "designmap", "DESIGN.md"), "utf8")).toContain("**brand**");
    expect(
      JSON.parse(await readFile(path.join(root, "designmap", "tokens.json"), "utf8")).color.brand,
    ).toBeDefined();
  });

  it("writes where --out says", async () => {
    const root = await tempDir(APP);
    const elsewhere = path.join(await tempDir({}), "system");
    expect((await designmap(root, "--out", elsewhere)).code).toBe(0);
    expect(await readFile(path.join(elsewhere, "tokens.json"), "utf8")).toContain('"brand"');
  });

  it("prints the scan as JSON with --json, writing nothing", async () => {
    const root = await tempDir(APP);
    const { code, out } = await designmap(root, "--json");
    expect(code).toBe(0);
    expect(JSON.parse(out).frameworks[0].framework).toBe("swiftui");
    await expect(stat(path.join(root, "designmap"))).rejects.toThrow();
  });

  it("fails plainly when there's no SwiftUI code, or the arguments are wrong", async () => {
    const empty = await designmap(await tempDir({ "README.md": "hi" }));
    expect(empty.code).toBe(1);
    expect(empty.error).toMatch(/^designmap: no SwiftUI or Jetpack Compose code found in /);
    expect((await designmap("--nope")).code).toBe(2);
    expect((await designmap("a", "b")).error).toContain("expected one folder, got 2");
  });

  it("refuses a project with both SwiftUI and Compose code rather than syncing only one of them", async () => {
    const root = await tempDir({
      ...APP,
      "android/Theme.kt": "import androidx.compose.ui.graphics.Color\nval Brand = Color(0xFF6650A4)",
    });
    const { code, error } = await designmap(root, "--out", path.join(root, "out"));
    expect(code).toBe(1);
    expect(error).toContain(
      "has SwiftUI and Jetpack Compose code, and syncing both into one Figma file isn't supported yet",
    );
  });

  it("says when the path isn't a folder, rather than that it has no code", async () => {
    const root = await tempDir(APP);
    for (const target of [path.join(root, "missing"), path.join(root, "App", "Home.swift")]) {
      const { code, error } = await designmap(target, "--json");
      expect(code).toBe(1);
      expect(error).toBe(`designmap: not a folder: ${target}`);
    }
  });

  it.skipIf(process.platform === "win32")("warns when only part of the app could be read", async () => {
    const root = await tempDir({ ...APP, "Locked/A.swift": "" });
    await chmod(path.join(root, "Locked"), 0o000);
    try {
      const { code, error } = await designmap(root, "--out", path.join(await tempDir({}), "out"));
      expect(code).toBe(0);
      expect(error).toBe(
        "designmap: Only part of the app was read: 1 folder couldn't be opened (Locked; check their permissions).",
      );
    } finally {
      await chmod(path.join(root, "Locked"), 0o755);
    }
  });

  it("checks the folder before serving MCP", async () => {
    const root = await tempDir(APP);
    expect(await designmap("mcp", path.join(root, "missing"))).toMatchObject({ code: 1 });
    expect(await designmap("mcp", root, root)).toMatchObject({ code: 2 });
  });

  it("prints help and the version", async () => {
    expect((await designmap("--help")).out).toContain("Usage");
    const manifest = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
    expect((await designmap("-v")).out).toBe(manifest.version);
  });
});
