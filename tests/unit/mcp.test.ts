import { chmod } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { createServer } from "../../src/mcp/server.js";
import { tempDir } from "../helpers/temp.js";

const APP = {
  "App/Theme.swift":
    "import SwiftUI\nenum Theme { static let brand = Color(red: 0.2, green: 0.4, blue: 0.9) }",
  "App/Home.swift": [
    "import SwiftUI",
    "struct Home: View {",
    "  var body: some View { NavigationStack { List { PriceRow() }.navigationTitle(t).tint(Theme.brand) } }",
    "}",
    "struct PriceRow: View { var body: some View { Text(p) } }",
  ].join("\n"),
};

/** A client connected to a server reading `root`. */
async function connect(root: string) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer(root, "1.2.3").connect(serverSide);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const [first] = result.content as { text: string }[];
  return { text: first?.text ?? "", isError: result.isError === true };
}

describe("MCP server", () => {
  it("tells the agent to use the app's own names, and offers read-only tools", async () => {
    const client = await connect(await tempDir(APP));
    expect(client.getServerVersion()).toMatchObject({ name: "designmap", version: "1.2.3" });
    expect(client.getInstructions()).toContain("1. Call get_design_system first.");
    const { tools } = await client.listTools();
    expect(tools.map((t) => [t.name, t.annotations?.readOnlyHint])).toEqual([
      ["get_design_system", true],
      ["find_views", true],
    ]);
  });

  it("hands over the design system as a DESIGN.md", async () => {
    const { text, isError } = await call(await connect(await tempDir(APP)), "get_design_system");
    expect(isError).toBe(false);
    expect(text).toContain('  brand: "#3366e6"');
    expect(text).toContain("- **brand** `#3366e6`: 1 use, from `App/Theme.swift`.");
  });

  it("finds views by part of a name or by kind, with where each is", async () => {
    const client = await connect(await tempDir(APP));
    expect((await call(client, "find_views", { query: "row" })).text).toBe(
      "1 view:\n- PriceRow (component) App/Home.swift:5",
    );
    expect((await call(client, "find_views", { kind: "screen" })).text).toBe(
      "1 view:\n- Home (screen) App/Home.swift:2",
    );
    expect((await call(client, "find_views", { query: "nothing" })).text).toBe("No matching views.");
  });

  it("says a wrong path is wrong, and reads a relative path from the app's folder", async () => {
    const root = await tempDir(APP);
    const client = await connect(root);
    const file = await call(client, "get_design_system", { repo: "App/Home.swift" });
    expect(file).toEqual({
      isError: true,
      text: `Not a folder: ${path.join(root, "App", "Home.swift")}. Pass the app's folder as repo.`,
    });
    expect((await call(client, "find_views", { repo: ".", query: "row" })).text).toContain("PriceRow");
  });

  it.skipIf(process.platform === "win32")("says when only part of the app could be read", async () => {
    const root = await tempDir({ ...APP, "Locked/A.swift": "" });
    await chmod(path.join(root, "Locked"), 0o000);
    try {
      const { text } = await call(await connect(root), "find_views", { kind: "screen" });
      expect(text).toBe(
        "Only part of the app was read: 1 folder couldn't be opened (Locked; check their permissions).\n\n1 view:\n- Home (screen) App/Home.swift:2",
      );
    } finally {
      await chmod(path.join(root, "Locked"), 0o755);
    }
  });

  it("tells the agent to check a token name exists in the code before using it", async () => {
    const instructions = (await connect(await tempDir(APP))).getInstructions() ?? "";
    expect(instructions).toContain("before using a name in code, search the code for it");
    expect(instructions).toContain(
      "If it isn't there (like hex-33a854 or system-15-semibold), write the value itself",
    );
  });

  it("reads another app when a call names one, and says so when it has no SwiftUI code", async () => {
    const client = await connect(await tempDir({ "README.md": "hi" }));
    const empty = await call(client, "get_design_system");
    expect(empty.isError).toBe(true);
    expect(empty.text).toMatch(/^No SwiftUI code found in /);
    const other = await call(client, "find_views", { repo: await tempDir(APP), kind: "screen" });
    expect(other.text).toContain("Home");
  });

  it("turns an unexpected failure into a message the agent can act on", async () => {
    vi.resetModules();
    vi.doMock("../../src/scan/index.js", () => ({
      scanRepo: async () => {
        throw new Error("disk read failed");
      },
    }));
    try {
      const { createServer: withFailingScan } = await import("../../src/mcp/server.js");
      const root = await tempDir(APP);
      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
      await withFailingScan(root, "0").connect(serverSide);
      const client = new Client({ name: "test", version: "0" });
      await client.connect(clientSide);
      expect(await call(client, "find_views")).toEqual({
        isError: true,
        text: `Designmap couldn't read ${root}: disk read failed`,
      });
    } finally {
      vi.doUnmock("../../src/scan/index.js");
      vi.resetModules();
    }
  });
});
