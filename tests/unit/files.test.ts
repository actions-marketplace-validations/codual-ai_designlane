import { chmodSync, symlinkSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listFiles, readGaps, readText } from "../../src/scan/files.js";
import { tempDir } from "../helpers/temp.js";

describe("listFiles", () => {
  it("lists source files in a stable order and skips dependencies, build output and hidden folders", async () => {
    const root = await tempDir({
      "b.swift": "",
      "a/View.swift": "",
      "node_modules/x/index.js": "",
      "build/out.swift": "",
      ".git/config": "",
    });
    const list = await listFiles(root);
    expect(list.files.map((f) => f.rel)).toEqual(["a/View.swift", "b.swift"]);
    expect(list).toMatchObject({ truncated: false, unreadable: [] });
  });

  it("doesn't follow symlinks out of the project", async () => {
    const root = await tempDir({ "App.swift": "" });
    const outside = await tempDir({ "Secret.swift": "" });
    symlinkSync(outside, path.join(root, "linked"), "junction");
    const { files } = await listFiles(root);
    expect(files.map((f) => f.rel)).toEqual(["App.swift"]);
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "reports folders it can't read instead of skipping them silently",
    async () => {
      const root = await tempDir({ "App.swift": "", "locked/Secret.swift": "" });
      chmodSync(path.join(root, "locked"), 0o000);
      try {
        expect(await listFiles(root)).toMatchObject({ unreadable: ["locked"] });
      } finally {
        chmodSync(path.join(root, "locked"), 0o755);
      }
    },
  );
});

describe("readText", () => {
  it("reads source files and skips missing or oversized ones", async () => {
    const root = await tempDir({ "App.swift": "import SwiftUI", "Big.swift": "x".repeat(600 * 1024) });
    expect(await readText(path.join(root, "App.swift"))).toBe("import SwiftUI");
    expect(await readText(path.join(root, "Big.swift"))).toBeUndefined();
    expect(await readText(path.join(root, "Missing.swift"))).toBeUndefined();
  });
});

describe("what a read missed", () => {
  it("says nothing when everything was read, and names what was missed otherwise", () => {
    expect(readGaps({ truncated: false, unreadable: [] })).toBeUndefined();
    expect(readGaps({ truncated: true, unreadable: ["a", "b", "c", "d"] })).toBe(
      "Only part of the app was read: it stopped after 20,000 files (point it at the app's own folder to read fewer), and 4 folders couldn't be opened (a, b, c, …; check their permissions).",
    );
  });
});
