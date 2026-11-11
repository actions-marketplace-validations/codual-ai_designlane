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
  const file = document.getElementById("file") as HTMLInputElement;
  const result = document.getElementById("result") as HTMLDivElement;
  const apply = document.getElementById("apply") as HTMLButtonElement;
  return {
    sent,
    file,
    result,
    apply,
    async pick(json: string) {
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
    await ui.pick("{}");
    await ui.pick("{}");
    ui.receive({ type: "plan", id: 1, summary });
    expect(ui.result.textContent).toBe("Reading tokens.json…");
    ui.receive({ type: "plan", id: 2, summary });
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
    expect(ui.sent).toEqual([{ type: "plan", id: 1, json: "{}" }]);
  });

  it("applies the plan on screen by its id", async () => {
    const ui = await openWindow();
    await ui.pick("{}");
    ui.receive({ type: "plan", id: 1, summary });
    ui.apply.click();
    expect(ui.sent.at(-1)).toEqual({ type: "apply", id: 1 });
  });

  it("keeps Apply off for a plan with nothing to do", async () => {
    const ui = await openWindow();
    await ui.pick("{}");
    ui.receive({ type: "plan", id: 1, summary: { ...summary, create: [], applicable: false } });
    expect(ui.apply.disabled).toBe(true);
  });

  it("turns Apply off when an error replaces the plan", async () => {
    const ui = await openWindow();
    await ui.pick("{}");
    ui.receive({ type: "plan", id: 1, summary });
    ui.receive({ type: "error", message: "Something went wrong." });
    expect([ui.apply.disabled, ui.result.textContent]).toEqual([true, "Something went wrong."]);
  });

  it("turns the file picker off while applying, and back on when done", async () => {
    const ui = await openWindow();
    await ui.pick("{}");
    ui.receive({ type: "plan", id: 1, summary });
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
    await ui.pick("{}");
    ui.receive({ type: "plan", id: 1, summary: { ...summary, partial: true } });
    expect(ui.result.textContent).toContain(
      "The scan couldn't read the whole app, so nothing is marked deprecated.",
    );
  });

  it("says when the picked file can't be read", async () => {
    const ui = await openWindow();
    await ui.pickUnreadable();
    expect([ui.result.textContent, ui.sent]).toEqual(["That file couldn't be read. Pick it again.", []]);
  });
});
