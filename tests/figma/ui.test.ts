// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanSummary, ToPlugin } from "../../figma-plugin/src/messages.js";

// Tests run from the repo root; under happy-dom a module's own URL isn't a file path.
const page = readFileSync(path.join(process.cwd(), "figma-plugin/src/ui.html"), "utf8");

const summary: PlanSummary = {
  create: ["color/ink"],
  update: [],
  restore: [],
  rename: [],
  deprecate: [],
  missingFonts: [],
  unchanged: 0,
  partial: false,
  renamesSkipped: false,
  darkLeftOut: false,
  applicable: true,
};

/** The plugin window, freshly loaded, with what it sends to the Figma side. */
async function openWindow() {
  document.body.innerHTML = page.slice(page.indexOf("<body>") + "<body>".length, page.indexOf("<script>"));
  const sent: ToPlugin[] = [];
  vi.spyOn(window, "postMessage").mockImplementation((data: { pluginMessage: ToPlugin }) => {
    sent.push(data.pluginMessage);
  });
  vi.resetModules();
  await import("../../figma-plugin/src/ui.js");
  // What the window sends as it opens, set apart so each test sees only what it does.
  const opening = sent.splice(0);
  const file = document.getElementById("file") as HTMLInputElement;
  const result = document.getElementById("result") as HTMLDivElement;
  const apply = document.getElementById("apply") as HTMLButtonElement;
  return {
    opening,
    sent,
    file,
    result,
    apply,
    /** Picks a file and returns the id the window gave its plan. */
    async pick(json: string): Promise<number> {
      const before = sent.length;
      Object.defineProperty(file, "files", {
        value: [{ name: "tokens.json", text: async () => json }],
        configurable: true,
      });
      // A browser shows the picked file's name; happy-dom leaves it empty, so set one to see it cleared.
      Object.defineProperty(file, "value", {
        value: "C:\\fakepath\\tokens.json",
        writable: true,
        configurable: true,
      });
      file.dispatchEvent(new Event("change"));
      await vi.waitFor(() => expect(sent).toHaveLength(before + 1));
      const message = sent.at(-1);
      if (message?.type !== "plan") throw new Error("the window sent no plan");
      return message.id;
    },
    /** Picks a file the window can't read. */
    async pickUnreadable() {
      const unreadable = { name: "tokens.json", text: async () => Promise.reject(new Error("unreadable")) };
      Object.defineProperty(file, "files", { value: [unreadable], configurable: true });
      file.dispatchEvent(new Event("change"));
      await vi.waitFor(() => expect(result.textContent).not.toBe("Reading tokens.json…"));
    },
    /** A message as the Figma side sends it. */
    receive(pluginMessage: unknown) {
      window.dispatchEvent(new MessageEvent("message", { data: { pluginMessage } }));
    },
  };
}

describe("the plugin window", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows only the plan for the file picked last", async () => {
    const ui = await openWindow();
    const first = await ui.pick("{}");
    const last = await ui.pick("{}");
    ui.receive({ type: "plan", id: first, summary });
    expect(ui.result.textContent).toBe("Reading tokens.json…");
    ui.receive({ type: "plan", id: last, summary });
    expect(ui.result.textContent).toContain("color/ink");
  });

  it("names the file it's reading, since the picker itself is cleared", async () => {
    const ui = await openWindow();
    await ui.pick("{}");
    expect(ui.result.textContent).toBe("Reading tokens.json…");
  });

  it("clears the picked file, so the same file can be picked again after it changes", async () => {
    const ui = await openWindow();
    await ui.pick("{}");
    expect(ui.file.value).toBe("");
    expect(ui.sent).toEqual([{ type: "plan", id: expect.any(Number), json: "{}" }]);
  });

  it("applies the plan on screen by its id", async () => {
    const ui = await openWindow();
    const id = await ui.pick("{}");
    ui.receive({ type: "plan", id, summary });
    ui.apply.click();
    expect(ui.sent.at(-1)).toEqual({ type: "apply", id });
  });

  it("keeps Apply off for a plan with nothing to do", async () => {
    const ui = await openWindow();
    const id = await ui.pick("{}");
    ui.receive({ type: "plan", id, summary: { ...summary, create: [], applicable: false } });
    expect(ui.apply.disabled).toBe(true);
  });

  it("turns Apply off when an error replaces the plan", async () => {
    const ui = await openWindow();
    const id = await ui.pick("{}");
    ui.receive({ type: "plan", id, summary });
    ui.receive({ type: "error", message: "Something went wrong." });
    expect([ui.apply.disabled, ui.result.textContent]).toEqual([true, "Something went wrong."]);
  });

  it("turns the file picker off while applying, and back on when done", async () => {
    const ui = await openWindow();
    const id = await ui.pick("{}");
    ui.receive({ type: "plan", id, summary });
    ui.apply.click();
    expect(ui.file.disabled).toBe(true);
    ui.receive({ type: "applied", notes: [] });
    expect(ui.file.disabled).toBe(false);
  });

  it("says the sync is done, and lists what it left out", async () => {
    const ui = await openWindow();
    ui.receive({ type: "applied", notes: [] });
    expect(ui.result.textContent).toBe("Synced. Your variables and text styles now match the code.");
    ui.receive({ type: "applied", notes: ["Text/hero was left out: this file doesn't have SF Pro."] });
    expect(ui.result.textContent).toBe(
      "Synced, with the notes below.Text/hero was left out: this file doesn't have SF Pro.",
    );
  });

  it("says when the scan behind a plan didn't read the whole app", async () => {
    const ui = await openWindow();
    const id = await ui.pick("{}");
    ui.receive({ type: "plan", id, summary: { ...summary, partial: true } });
    expect(ui.result.textContent).toContain(
      "The scan couldn't read the whole app, so nothing is marked deprecated.",
    );
  });

  it("says when the picked file can't be read", async () => {
    const ui = await openWindow();
    await ui.pickUnreadable();
    expect([ui.result.textContent, ui.sent]).toEqual(["That file couldn't be read. Pick it again.", []]);
  });

  it("asks which repo is connected as it opens", async () => {
    const ui = await openWindow();
    expect(ui.opening).toEqual([{ type: "ready", id: 1 }]);
  });

  it("shows the connect form when no repo is connected, and connects with what's typed", async () => {
    const ui = await openWindow();
    ui.receive({ type: "connection", repo: null });
    const shown = (id: string) => !(document.getElementById(id) as HTMLElement).hidden;
    expect([shown("connect"), shown("connected")]).toEqual([true, false]);
    (document.getElementById("repo") as HTMLInputElement).value = " octo/app ";
    (document.getElementById("token") as HTMLInputElement).value = "github_pat_secret";
    (document.getElementById("connect-button") as HTMLButtonElement).click();
    expect(ui.sent.at(-1)).toEqual({
      type: "connect",
      id: 2,
      repo: "octo/app",
      branch: "main",
      path: "designmap/tokens.json",
      token: "github_pat_secret",
    });
  });

  it("fills the form with the repo the file syncs from, so a teammate types only a token", async () => {
    const ui = await openWindow();
    const saved = { repo: "octo/app", branch: "release", path: "designmap/tokens.android.json" };
    ui.receive({ type: "connection", repo: null, saved });
    const value = (id: string) => (document.getElementById(id) as HTMLInputElement).value;
    expect([value("repo"), value("branch"), value("path"), value("token")]).toEqual([
      "octo/app",
      "release",
      "designmap/tokens.android.json",
      "",
    ]);
  });

  it("shows the connected repo, and checks it again or disconnects", async () => {
    const ui = await openWindow();
    ui.receive({
      type: "connection",
      repo: { repo: "octo/app", branch: "main", path: "designmap/tokens.json" },
    });
    expect([
      (document.getElementById("connect") as HTMLElement).hidden,
      document.getElementById("connected-to")?.textContent,
    ]).toEqual([true, "Connected to octo/app (main)"]);
    (document.getElementById("refresh") as HTMLButtonElement).click();
    (document.getElementById("disconnect") as HTMLButtonElement).click();
    expect(ui.sent).toEqual([{ type: "fetch", id: 2 }, { type: "disconnect" }]);
  });

  it("clears its opening status when no repo is connected", async () => {
    const ui = await openWindow();
    ui.receive({ type: "connection", repo: null });
    expect(ui.result.textContent).toBe("");
  });

  it("clears the typed token once the connection is saved", async () => {
    const ui = await openWindow();
    ui.receive({ type: "connection", repo: null });
    const token = document.getElementById("token") as HTMLInputElement;
    token.value = "github_pat_secret";
    ui.receive({
      type: "connection",
      repo: { repo: "octo/app", branch: "main", path: "designmap/tokens.json" },
    });
    expect(token.value).toBe("");
  });

  it("drops the plan on screen when disconnecting", async () => {
    const ui = await openWindow();
    ui.receive({
      type: "connection",
      repo: { repo: "octo/app", branch: "main", path: "designmap/tokens.json" },
    });
    ui.receive({ type: "plan", id: 1, summary });
    (document.getElementById("disconnect") as HTMLButtonElement).click();
    expect([ui.apply.disabled, ui.sent.at(-1)]).toEqual([true, { type: "disconnect" }]);
  });

  it("keeps Check again, Disconnect and Connect off while applying, so nothing replaces the result", async () => {
    const ui = await openWindow();
    ui.receive({
      type: "connection",
      repo: { repo: "octo/app", branch: "main", path: "designmap/tokens.json" },
    });
    ui.receive({ type: "plan", id: 1, summary });
    ui.apply.click();
    const disconnect = document.getElementById("disconnect") as HTMLButtonElement;
    const refresh = document.getElementById("refresh") as HTMLButtonElement;
    const connect = document.getElementById("connect-button") as HTMLButtonElement;
    expect([disconnect.disabled, refresh.disabled, connect.disabled]).toEqual([true, true, true]);
    ui.receive({ type: "applied", notes: [] });
    expect([disconnect.disabled, refresh.disabled, connect.disabled]).toEqual([false, false, false]);
  });
});
