import { chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
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

  it("names the app's other themes, when it has some", async () => {
    const set = (name: string, hex: string) =>
      `struct ${name}: ColorSet { var tint: Color = Color(hex: 0x${hex}) }`;
    const root = await tempDir({
      ...APP,
      "App/ColorSet.swift": [
        "import SwiftUI",
        "protocol ColorSet { var tint: Color { get } }",
        set("MainLight", "111111"),
        set("MainDark", "222222"),
        set("DesertLight", "df915e"),
        set("OceanLight", "0000ff"),
      ].join("\n"),
    });
    expect((await designmap(root)).out).toContain("  2 other themes: Desert, Ocean");
    expect((await designmap(await tempDir(APP))).out).not.toContain("other theme");
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
    expect(empty.error).toMatch(/^designmap: no SwiftUI, Jetpack Compose or React Native code found in /);
    expect((await designmap("--nope")).code).toBe(2);
    expect((await designmap("a", "b")).error).toContain("expected one folder, got 2");
  });

  describe("a repo with both an iPhone and an Android app", () => {
    const BOTH = {
      ...APP,
      "android/Theme.kt": "import androidx.compose.ui.graphics.Color\nval Brand = Color(0xFF6650A4)",
    };
    const tokensAt = async (root: string, name: string) =>
      JSON.parse(await readFile(path.join(root, "designmap", name), "utf8"));
    const absent = (root: string, name: string) =>
      expect(stat(path.join(root, "designmap", name))).rejects.toThrow();

    it("writes a tokens file for each app beside one DESIGN.md, and says what it found in each", async () => {
      const root = await tempDir(BOTH);
      const { code, out } = await designmap(root);
      expect(code).toBe(0);
      expect(out).toContain(`${path.basename(root)} (SwiftUI): 1 screen`);
      expect(out).toContain(`${path.basename(root)} (Jetpack Compose): 0 screens`);
      expect((await tokensAt(root, "tokens.ios.json")).color.brand.$value.hex).toBe("#3366e6");
      expect((await tokensAt(root, "tokens.android.json")).color.Brand.$value.hex).toBe("#6650a4");
      expect(await readFile(path.join(root, "designmap", "DESIGN.md"), "utf8")).toContain(
        "SwiftUI and Jetpack Compose",
      );
      await absent(root, "tokens.json");
    });

    it("removes the tokens files it wrote in the other layout, says so, and leaves anyone else's", async () => {
      const root = await tempDir(APP);
      expect((await designmap(root)).code).toBe(0);
      await mkdir(path.join(root, "android"));
      await writeFile(path.join(root, "android", "Theme.kt"), BOTH["android/Theme.kt"]);
      const split = await designmap(root);
      expect(split.code).toBe(0);
      expect(split.error).toContain("designmap: removed ");
      expect(split.error).toContain(
        "tokens.json, as the repo now has more than one app: connect each Figma file to ",
      );
      await absent(root, "tokens.json");

      await rm(path.join(root, "android"), { recursive: true });
      const joined = await designmap(root);
      expect(joined.error).toContain("as the repo now has one app");
      expect((await tokensAt(root, "tokens.json")).color.brand).toBeDefined();
      await absent(root, "tokens.ios.json");
      await absent(root, "tokens.android.json");

      await writeFile(path.join(root, "designmap", "tokens.ios.json"), '{"theirs": true}\n');
      expect((await designmap(root)).error).not.toContain("removed");
      expect(await tokensAt(root, "tokens.ios.json")).toEqual({ theirs: true });
    });

    it("doesn't take a file that only looks like its own for one it wrote", async () => {
      const root = await tempDir(BOTH);
      expect((await designmap(root)).code).toBe(0);
      await writeFile(
        path.join(root, "designmap", "tokens.android.json"),
        '{"$extensions":{"designmap":null}}\n',
      );
      await rm(path.join(root, "android"), { recursive: true });
      expect((await designmap(root)).error).toContain("removed");
      expect(await tokensAt(root, "tokens.android.json")).toEqual({ $extensions: { designmap: null } });
      await absent(root, "tokens.ios.json");
    });

    it.skipIf(process.platform === "win32")(
      "removes nothing when it couldn't read the whole app",
      async () => {
        const root = await tempDir(BOTH);
        expect((await designmap(root)).code).toBe(0);
        await chmod(path.join(root, "android"), 0o000);
        try {
          expect((await designmap(root)).error).not.toContain("removed");
          expect((await tokensAt(root, "tokens.android.json")).color.Brand).toBeDefined();
        } finally {
          await chmod(path.join(root, "android"), 0o755);
        }
      },
    );

    it("keeps the tokens files in the out folder, even when it's the repo itself", async () => {
      const root = await tempDir(BOTH);
      expect((await designmap(root, "--out", root)).code).toBe(0);
      expect(
        JSON.parse(await readFile(path.join(root, "tokens.android.json"), "utf8")).color.Brand,
      ).toBeDefined();
      expect(await readFile(path.join(root, "android", "Theme.kt"), "utf8")).toBe(BOTH["android/Theme.kt"]);
    });
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
