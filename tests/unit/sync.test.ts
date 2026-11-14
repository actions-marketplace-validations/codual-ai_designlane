import { describe, expect, it } from "vitest";
import { scanRepo, toDesignTokens } from "../../src/index.js";
import {
  type CodeToken,
  type DesignFile,
  type DesignFileEntry,
  planSync,
  type VariableValue,
} from "../../src/sync/plan.js";
import {
  readTokensFile,
  type SyncColor,
  type SyncTokens,
  type TextValue,
} from "../../src/sync/tokens-file.js";
import { tempDir } from "../helpers/temp.js";

const APP = {
  "App/Theme.swift": [
    "import SwiftUI",
    "enum Theme {",
    "  static let brand = Color(red: 0.2, green: 0.4, blue: 0.9)",
    "  static let glass = Color(red: 1, green: 0, blue: 0, opacity: 0.5)",
    "}",
    "extension Font { static let heading = Font.system(size: 22, weight: .semibold) }",
  ].join("\n"),
  "App/Home.swift": [
    "import SwiftUI",
    "let accent = Color(red: 0, green: 0.5, blue: 0)",
    "struct Home: View {",
    "  var body: some View { Text(t).font(.heading).foregroundStyle(Theme.brand).tint(accent)",
    "    .padding(8).cornerRadius(12).background(Theme.glass) }",
    "}",
  ].join("\n"),
};

/** The tokens Designmap writes for `files`, read back the way a sync reads them. */
async function tokensOf(files: Record<string, string>): Promise<SyncTokens> {
  return readTokensFile(JSON.parse(JSON.stringify(toDesignTokens(await scanRepo(await tempDir(files))))));
}

const tokens = (parts: Partial<SyncTokens>): SyncTokens => ({
  colors: [],
  textStyles: [],
  spacing: [],
  radii: [],
  complete: true,
  ...parts,
});
const color = (identity: string, hex: string, extra: Partial<SyncColor> = {}): SyncColor => ({
  identity,
  key: identity.replace(/^color:/, ""),
  light: { hex, alpha: 1 },
  ...extra,
});

/** A colour token as tokens.json writes it, for a file-local `reference` in `source`. */
const colorEntry = (hex: string, reference: string, source = "A.swift", line?: number) => ({
  $type: "color",
  $value: { colorSpace: "srgb", components: [0, 0, 0], hex },
  $extensions: { designmap: { reference, source, uses: 1, ...(line ? { line } : {}) } },
});

/** A design file as a first sync of `code` leaves it: every token made, with its identity. */
function syncedFile(code: SyncTokens): DesignFile {
  const first = planSync(code, { variables: [], textStyles: [] });
  const entry = <V>(token: CodeToken<V>, i: number): DesignFileEntry<V> => ({
    id: `${token.identity}#${i}`,
    name: token.name,
    identity: token.identity,
    value: token.value,
    deprecated: false,
  });
  const fullStyle = (value: TextValue): Required<TextValue> => ({
    family: "SF Pro",
    size: 17,
    weight: 400,
    ...value,
  });
  return {
    variables: first.variables.create.map(entry),
    textStyles: first.textStyles.create.map((token, i) => ({
      ...entry(token, i),
      value: fullStyle(token.value),
    })),
  };
}

/** The first variable a synced file has; every caller syncs at least one. */
function firstVariable(file: DesignFile): DesignFileEntry<VariableValue> {
  const [first] = file.variables;
  if (!first) throw new Error("the synced file has no variables");
  return first;
}

describe("reading tokens.json", () => {
  it("reads each token with the identity a sync tracks it by", async () => {
    const read = await tokensOf(APP);
    expect(read.colors.map((c) => [c.identity, c.light])).toEqual([
      ["color:Theme.brand", { hex: "#3366e6", alpha: 1 }],
      ["color:Theme.glass", { hex: "#ff0000", alpha: 0.502 }],
      ["color:accent@App/Home.swift", { hex: "#008000", alpha: 1 }],
    ]);
    expect(read.textStyles).toEqual([
      {
        identity: "type:Font.heading|heading",
        key: "heading",
        value: { family: "SF Pro", size: 22, weight: 600 },
        reference: "Font.heading",
      },
    ]);
    // Spacing and radii the code writes in place are DESIGN.md's, not a sync's.
    expect([read.spacing, read.radii]).toEqual([[], []]);
  });

  it("gives a file-local colour the same identity whether or not another file has one of that name", async () => {
    const alone = await tokensOf(APP);
    const withAnother = await tokensOf({
      ...APP,
      "App/Other.swift": "import SwiftUI\nlet accent = Color(red: 1, green: 1, blue: 0)",
    });
    expect(alone.colors.find((c) => c.key === "accent")?.identity).toBe("color:accent@App/Home.swift");
    expect(withAnother.colors.map((c) => c.identity)).toEqual(
      expect.arrayContaining(["color:accent@App/Home.swift", "color:accent@App/Other.swift"]),
    );
  });

  it("tells apart two colours one file declares under the same name, in declaration order", () => {
    const read = readTokensFile({
      $description: "test",
      color: {
        accent: colorEntry("#111111", "accent", "A.swift", 4),
        "accent-2": colorEntry("#222222", "accent", "A.swift", 9),
      },
    });
    expect(read.colors.map((c) => c.identity)).toEqual(["color:accent@A.swift", "color:accent@A.swift#2"]);
  });

  it("keeps two same-named colours' identities when one's value changes and their keys swap", () => {
    const identityOf = (json: object, hex: string) =>
      readTokensFile({ $description: "test", ...json }).colors.find((c) => c.light.hex === hex)?.identity;
    const before = {
      color: {
        accent: colorEntry("#111111", "accent", "A.swift", 4),
        "accent-2": colorEntry("#999999", "accent", "A.swift", 9),
      },
    };
    const after = {
      color: {
        accent: colorEntry("#999999", "accent", "A.swift", 9),
        "accent-2": colorEntry("#aaaaaa", "accent", "A.swift", 4),
      },
    };
    expect(identityOf(after, "#999999")).toBe(identityOf(before, "#999999"));
    expect(identityOf(after, "#aaaaaa")).toBe(identityOf(before, "#111111"));
  });

  it("keeps each size of a font helper its own identity when another size changes", async () => {
    const appUsing = (sizes: number[]) => ({
      "App/Fonts.swift":
        "import SwiftUI\nextension Font { static func app(size: CGFloat, weight: Font.Weight) -> Font { .system(size: size, weight: weight) } }",
      "App/Home.swift": `import SwiftUI\nstruct Home: View { var body: some View { VStack { ${sizes
        .map((n) => `Text(t).font(.app(size: ${n}, weight: .bold))`)
        .join("\n")} } } }`,
    });
    const identityOfSize = (read: SyncTokens, size: number) =>
      read.textStyles.find((s) => s.value.size === size)?.identity;
    const before = await tokensOf(appUsing([15, 20]));
    const after = await tokensOf(appUsing([25, 20]));
    expect(identityOfSize(after, 20)).toBe(identityOfSize(before, 20));
    expect(identityOfSize(after, 25)).not.toBe(identityOfSize(before, 15));
  });

  it("knows when the scan couldn't read the whole app", async () => {
    const scan = await scanRepo(await tempDir(APP));
    const read = (s: typeof scan) => readTokensFile(JSON.parse(JSON.stringify(toDesignTokens(s))));
    expect(read(scan).complete).toBe(true);
    expect(read({ ...scan, unreadable: ["Locked"] }).complete).toBe(false);
    expect(read({ ...scan, truncated: true }).complete).toBe(false);
  });

  it("refuses a file shaped otherwise, or with no tokens, rather than deprecating everything", () => {
    expect(() => readTokensFile({ swiftui: {}, compose: {} })).toThrow(
      /^This isn't a tokens\.json Designmap writes/,
    );
    expect(() => readTokensFile({ $description: "empty", color: {} })).toThrow(
      /has no tokens\. Run designmap/,
    );
  });

  it("syncs an app whose code names nothing, unless the scan missed part of it", () => {
    const empty = (partial: boolean) => ({
      $description: "test",
      $extensions: { designmap: { app: "Shop", ...(partial ? { partial: true } : {}) } },
    });
    expect(readTokensFile(empty(false))).toMatchObject({ colors: [], textStyles: [], complete: true });
    expect(() => readTokensFile(empty(true))).toThrow(/has no tokens\. Run designmap/);
  });

  it("refuses a token Designmap wouldn't write, naming it and saying what to do", () => {
    const refusal = (file: object) => () => readTokensFile({ $description: "test", ...file });
    const say = (path: string) =>
      new RegExp(`Run designmap on the app again[\\s\\S]*${path.replace(".", "\\.")}`);
    expect(refusal({ color: { brand: { $type: "color", $value: "blue" } } })).toThrow(say("color.brand"));
    expect(refusal({ color: { brand: "blue" } })).toThrow(say("color"));
    const ext = { designmap: { name: "empty", uses: 1 } };
    expect(refusal({ typography: { empty: { $extensions: ext } } })).toThrow(say("typography.empty"));
    const tooOpaque = { colorSpace: "srgb", components: [0, 0, 0], hex: "#000000", alpha: 2 };
    const ink = {
      $type: "color",
      $value: tooOpaque,
      $extensions: { designmap: { source: "A.swift", uses: 1 } },
    };
    expect(refusal({ color: { ink } })).toThrow(say("color.ink"));
    const darkOnStyle = { designmap: { name: "s", uses: 1, modes: { dark: tooOpaque } } };
    expect(
      refusal({
        typography: { s: { $extensions: darkOnStyle, fontWeight: { $type: "fontWeight", $value: 400 } } },
      }),
    ).toThrow(say("typography.s"));
  });
});

describe("planning a sync", () => {
  it("creates everything on a first sync, named from the code", async () => {
    const plan = planSync(await tokensOf(APP), { variables: [], textStyles: [] });
    expect(plan.variables.create.map((v) => v.name)).toEqual(["color/brand", "color/glass", "color/accent"]);
    expect(plan.textStyles.create.map((s) => [s.name, s.reference])).toEqual([
      ["Text/heading", "Font.heading"],
    ]);
  });

  it("names fractional spacing and radii without a dot, which a design file reads as a group", () => {
    const plan = planSync(tokens({ spacing: [1.5], radii: [0.5] }), { variables: [], textStyles: [] });
    expect(plan.variables.create.map((v) => v.name)).toEqual(["spacing/1_5", "radius/0_5"]);
  });

  it("changes nothing when the code hasn't, whatever case or opacity precision the file stores", async () => {
    const code = await tokensOf(APP);
    const file = syncedFile(code);
    for (const v of file.variables) {
      if (typeof v.value === "number") continue;
      const { hex, alpha } = v.value.light;
      v.value = { light: { hex: hex.toUpperCase(), alpha: alpha === 1 ? 1 : 0.50196 } };
    }
    const plan = planSync(code, file);
    expect(plan.variables).toEqual({
      create: [],
      update: [],
      deprecate: [],
      rename: [],
      renamesSkipped: false,
      unchanged: 3,
    });
    expect(plan.textStyles.unchanged).toBe(1);
  });

  it("updates a colour whose opacity really changed", () => {
    const file = syncedFile(tokens({ colors: [color("color:Theme.glass", "#ffffff")] }));
    const faded = color("color:Theme.glass", "#ffffff", { light: { hex: "#ffffff", alpha: 0.6 } });
    expect(planSync(tokens({ colors: [faded] }), file).variables.update).toHaveLength(1);
  });

  it("updates a colour whose dark value alone changed", () => {
    const withDark = (hex: string) => color("color:Theme.bg", "#ffffff", { dark: { hex, alpha: 1 } });
    const file = syncedFile(tokens({ colors: [withDark("#000000")] }));
    expect(planSync(tokens({ colors: [withDark("#111111")] }), file).variables.update).toHaveLength(1);
  });

  it("updates a changed value in place and keeps the name a designer gave it", () => {
    const file = syncedFile(tokens({ colors: [color("color:Theme.brand", "#3366e6")] }));
    const brand = firstVariable(file);
    brand.name = "brand/primary";
    const plan = planSync(tokens({ colors: [color("color:Theme.brand", "#112233")] }), file).variables;
    expect(plan.create).toEqual([]);
    expect(plan.update.map((u) => [u.id, u.name, u.restored])).toEqual([[brand.id, "brand/primary", false]]);
  });

  it("deprecates what a full group no longer lists, once", () => {
    const file = syncedFile(tokens({ spacing: [8, 16] }));
    const without8 = tokens({ spacing: [16] });
    expect(planSync(without8, file).variables.deprecate.map((d) => d.name)).toEqual(["spacing/8"]);
    for (const v of file.variables) if (v.identity === "spacing:8") v.deprecated = true;
    expect(planSync(without8, file).variables.deprecate).toEqual([]);
  });

  it("deprecates nothing after a scan that couldn't read the whole app", () => {
    const file = syncedFile(tokens({ spacing: [8, 16] }));
    expect(planSync(tokens({ spacing: [16], complete: false }), file).variables.deprecate).toEqual([]);
  });

  it("proposes a rename when one token is gone and one new token in its group has the same value", () => {
    const file = syncedFile(
      tokens({ colors: [color("color:Theme.c3", "#969ca5"), color("color:Theme.ink", "#111111")] }),
    );
    const c3 = firstVariable(file);
    c3.name = "text/secondary";
    const renamed = tokens({
      colors: [color("color:Theme.secondaryText", "#969ca5"), color("color:Theme.ink", "#111111")],
    });
    const plan = planSync(renamed, file).variables;
    expect(plan.rename.map((r) => [r.id, r.name, r.token.identity])).toEqual([
      [c3.id, "text/secondary", "color:Theme.secondaryText"],
    ]);
    expect([plan.create, plan.deprecate]).toEqual([[], []]);
  });

  it("follows a theme the code renamed, though its colours share values, keeping every variable", () => {
    const theme = (owner: string, surface = "#ffffff") =>
      tokens({
        colors: [
          color(`color:${owner}.colors.surface`, surface),
          color(`color:${owner}.colors.background`, "#ffffff"),
          color(`color:${owner}.colors.primary`, "#3366e6"),
        ],
      });
    const file = syncedFile(theme("MainTheme"));
    const plan = planSync(theme("BoltTheme"), file).variables;
    expect(plan.rename.map((r) => [r.name, r.token.identity])).toEqual([
      ["color/MainTheme.colors.surface", "color:BoltTheme.colors.surface"],
      ["color/MainTheme.colors.background", "color:BoltTheme.colors.background"],
      ["color/MainTheme.colors.primary", "color:BoltTheme.colors.primary"],
    ]);
    expect([plan.create, plan.deprecate]).toEqual([[], []]);
    // A member whose value changed too is a different colour: no guess.
    const changed = planSync(theme("BoltTheme", "#000000"), file).variables;
    expect(changed.rename.map((r) => r.token.identity)).not.toContain("color:BoltTheme.colors.surface");
  });

  it("follows no owner rename when two owners have the member", () => {
    const file = syncedFile(
      tokens({
        colors: [color("color:Light.colors.bg", "#ffffff"), color("color:Dark.colors.bg", "#ffffff")],
      }),
    );
    const plan = planSync(tokens({ colors: [color("color:Bolt.colors.bg", "#ffffff")] }), file).variables;
    expect(plan.rename).toEqual([]);
  });

  it("follows owners only in a path: not an asset's dotted name, a file's own constant or a value", () => {
    const pair = (from: string, to: string) => {
      const file = syncedFile(tokens({ colors: [color(from, "#ffffff"), color(`${from}2`, "#ffffff")] }));
      const plan = planSync(tokens({ colors: [color(to, "#ffffff"), color(`${to}2`, "#ffffff")] }), file);
      return plan.variables.rename.length;
    };
    expect(pair("color:Main.bg", "color:Bolt.bg")).toBe(2);
    expect(pair('color:Color("Old.bg', 'color:Color("New.bg')).toBe(0);
    expect(pair("color:bg@Old.swift", "color:bg@New.swift")).toBe(0);
  });

  it("follows a text style's owner by its member and name", () => {
    const style = (identity: string) => ({ identity, key: "body", value: { size: 15 } });
    const file = syncedFile(
      tokens({ textStyles: [style("type:Main.type.body|body"), style("type:Main.type.note|note")] }),
    );
    const plan = planSync(
      tokens({ textStyles: [style("type:Bolt.type.body|body"), style("type:Bolt.type.note|note")] }),
      file,
    );
    expect(plan.textStyles.rename.map((r) => r.token.identity)).toEqual([
      "type:Bolt.type.body|body",
      "type:Bolt.type.note|note",
    ]);
    // One helper called at two sizes is two styles of one member, each told apart by its name.
    const sized = (owner: string) =>
      tokens({
        textStyles: [style(`type:${owner}.font.brand|brand 20`), style(`type:${owner}.font.brand|brand 15`)],
      });
    expect(planSync(sized("Bolt"), syncedFile(sized("Main"))).textStyles.rename).toHaveLength(2);
  });

  it("follows a renamed owner however many colours changed, then guesses the rest within the budget", () => {
    const hex = (i: number) => `#${i.toString(16).padStart(6, "0")}`;
    const theme = (owner: string) =>
      Array.from({ length: 400 }, (_, i) => color(`color:${owner}.c${i}`, hex(i)));
    const file = syncedFile(tokens({ colors: [...theme("Main"), color("color:Theme.c3", "#969ca5")] }));
    const plan = planSync(
      tokens({ colors: [...theme("Bolt"), color("color:Theme.secondaryText", "#969ca5")] }),
      file,
    ).variables;
    expect([plan.renamesSkipped, plan.rename.length, plan.deprecate.length]).toEqual([false, 401, 0]);
  });

  it("gives a token its owner took to no other gone entry of the same value", () => {
    const file = syncedFile(
      tokens({ colors: [color("color:Main.bg", "#ffffff"), color("color:Old.x", "#ffffff")] }),
    );
    const plan = planSync(tokens({ colors: [color("color:Bolt.bg", "#ffffff")] }), file).variables;
    expect(plan.rename.map((r) => r.token.identity)).toEqual(["color:Bolt.bg"]);
    expect(plan.deprecate).toHaveLength(1);
  });

  it("follows no owner rename of an entry a designer duplicated", () => {
    const file = syncedFile(tokens({ colors: [color("color:Main.colors.bg", "#ffffff")] }));
    const [first] = file.variables;
    if (!first) throw new Error("no variable");
    file.variables.push({ ...first, id: "copy", name: "copy" });
    const plan = planSync(tokens({ colors: [color("color:Bolt.colors.bg", "#ffffff")] }), file).variables;
    expect(plan.rename).toEqual([]);
  });

  it("follows no owner rename when two new owners have the member", () => {
    const file = syncedFile(tokens({ colors: [color("color:Main.colors.bg", "#ffffff")] }));
    const two = tokens({
      colors: [color("color:Light.colors.bg", "#ffffff"), color("color:Dark.colors.bg", "#ffffff")],
    });
    expect(planSync(two, file).variables.rename).toEqual([]);
  });

  it("guesses no rename when two gone tokens share the new one's value", () => {
    const file = syncedFile(
      tokens({ colors: [color("color:Theme.a", "#ffffff"), color("color:Theme.b", "#ffffff")] }),
    );
    const plan = planSync(tokens({ colors: [color("color:Theme.white", "#ffffff")] }), file).variables;
    expect(plan.rename).toEqual([]);
    expect(plan.deprecate).toHaveLength(2);
  });

  it("guesses no rename when two new tokens share the gone one's value", () => {
    const file = syncedFile(tokens({ colors: [color("color:Theme.a", "#ffffff")] }));
    const twoNew = tokens({ colors: [color("color:Theme.x", "#ffffff"), color("color:Theme.y", "#ffffff")] });
    expect(planSync(twoNew, file).variables.rename).toEqual([]);
  });

  it("guesses no rename across kinds: a radius of 8 isn't a renamed spacing of 8", () => {
    const file = syncedFile(tokens({ spacing: [8] }));
    expect(planSync(tokens({ radii: [8] }), file).variables.rename).toEqual([]);
  });

  it("says when too many tokens changed at once to guess renames, rather than skipping them silently", () => {
    const hex = (i: number) => `#${i.toString(16).padStart(6, "0")}`;
    const swap = (count: number) => {
      const old = Array.from({ length: count }, (_, i) => color(`color:Old.c${i}`, hex(i)));
      const fresh = Array.from({ length: count }, (_, i) => color(`color:New.d${i}`, hex(i)));
      return planSync(tokens({ colors: fresh }), syncedFile(tokens({ colors: old }))).variables;
    };
    const small = swap(300);
    expect([small.renamesSkipped, small.rename.length]).toEqual([false, 300]);
    const large = swap(400);
    expect([large.renamesSkipped, large.rename.length, large.deprecate.length]).toEqual([true, 0, 400]);
  });

  it("renames no entry a designer duplicated, so its copy never takes over the old identity", () => {
    const file = syncedFile(tokens({ colors: [color("color:Theme.c3", "#969ca5")] }));
    const original = firstVariable(file);
    file.variables.push({ ...original, id: "copy", name: "c3 copy" });
    const plan = planSync(
      tokens({ colors: [color("color:Theme.secondaryText", "#969ca5")] }),
      file,
    ).variables;
    expect(plan.rename).toEqual([]);
    expect(plan.deprecate.map((d) => d.id)).toEqual([original.id]);
  });

  it("guesses no rename when a duplicated entry that's also gone matches the new token just as well", () => {
    const file = syncedFile(
      tokens({ colors: [color("color:Theme.a", "#969ca5"), color("color:Theme.b", "#969ca5")] }),
    );
    const b = file.variables.find((v) => v.identity === "color:Theme.b") as DesignFileEntry<VariableValue>;
    file.variables.push({ ...b, id: "b copy", name: "b copy" });
    const plan = planSync(tokens({ colors: [color("color:Theme.c", "#969ca5")] }), file).variables;
    expect(plan.rename).toEqual([]);
  });

  it("gives a new token its plain name when the token that wanted it first turned out to be a rename", () => {
    const file = syncedFile(tokens({ colors: [color("color:Theme.c3", "#969ca5")] }));
    const renamedAndNew = tokens({
      colors: [
        color("color:Theme.secondaryText", "#969ca5", { key: "surface" }),
        color("color:Other.surface", "#000000", { key: "surface" }),
      ],
    });
    const plan = planSync(renamedAndNew, file).variables;
    expect(plan.rename.map((r) => r.token.identity)).toEqual(["color:Theme.secondaryText"]);
    expect(plan.create.map((c) => c.name)).toEqual(["color/surface"]);
  });

  it("guesses no rename after a partial scan", () => {
    const file = syncedFile(tokens({ colors: [color("color:Theme.c3", "#969ca5")] }));
    const partial = tokens({ colors: [color("color:Theme.secondaryText", "#969ca5")], complete: false });
    expect(planSync(partial, file).variables.rename).toEqual([]);
  });

  it("restores a deprecated token the code has again", () => {
    const file = syncedFile(tokens({ spacing: [8] }));
    for (const v of file.variables) v.deprecated = true;
    const plan = planSync(tokens({ spacing: [8] }), file).variables;
    expect(plan.update.map((u) => [u.name, u.restored])).toEqual([["spacing/8", true]]);
  });

  it("doesn't count a size the code computes as a change, whatever the file holds", () => {
    const title = { identity: "type:Font.title(_:)", key: "title", value: { family: "SF Pro", weight: 600 } };
    const code = tokens({ textStyles: [title] });
    const file = syncedFile(code);
    for (const s of file.textStyles) s.value = { ...s.value, size: 28 };
    expect(planSync(code, file).textStyles.unchanged).toBe(1);
  });

  it("syncs the first of a duplicated variable and leaves the copy alone", () => {
    const file = syncedFile(tokens({ colors: [color("color:Theme.brand", "#3366e6")] }));
    const original = firstVariable(file);
    file.variables.push({ ...original, id: "copy", name: "brand copy" });
    const changed = planSync(tokens({ colors: [color("color:Theme.brand", "#112233")] }), file).variables;
    expect(changed.update.map((u) => u.id)).toEqual([original.id]);
    const dropped = planSync(tokens({ spacing: [4] }), file).variables;
    expect(dropped.deprecate.map((d) => d.id)).toEqual([original.id]);
  });

  it("leaves what a designer made alone, and doesn't take its name", () => {
    const designer: DesignFileEntry<VariableValue> = {
      id: "d",
      name: "color/brand",
      value: 4,
      deprecated: false,
    };
    const code = tokens({ colors: [color("color:Theme.brand", "#3366e6", { key: "brand" })] });
    const plan = planSync(code, { variables: [designer], textStyles: [] }).variables;
    expect([plan.deprecate, plan.update]).toEqual([[], []]);
    expect(plan.create.map((v) => v.name)).toEqual(["color/brand 2"]);
  });
});
