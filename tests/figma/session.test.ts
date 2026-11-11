import { describe, expect, it } from "vitest";
import { plugin } from "../helpers/figma-plugin.js";
import { tokensJson } from "../helpers/tokens-json.js";

describe("syncing through the plugin's session", () => {
  it("creates every token, then finds nothing to change when synced again", async () => {
    const app = plugin();
    const json = tokensJson({
      colors: [{ key: "surface", hex: "#18191c" }],
      spacing: [8],
      styles: [{ key: "heading", size: 22, weight: 600 }],
    });
    expect(await app.sync(json)).toEqual([]);
    const again = await app.plan(json);
    expect([again.create, again.update, again.restore, again.deprecate]).toEqual([[], [], [], []]);
    expect(again.applicable).toBe(false);
    expect(again.unchanged).toBe(3);
  });

  it("marks nothing deprecated when the scan didn't read the whole app", async () => {
    const app = plugin();
    await app.sync(tokensJson({ spacing: [8, 16] }));
    const plan = await app.plan(tokensJson({ spacing: [8], partial: true }));
    expect([plan.partial, plan.deprecate]).toEqual([true, []]);
  });

  it("takes actions in turn, so a file picked during an apply is planned against its result", async () => {
    const app = plugin();
    const json = tokensJson({ spacing: [8] });
    await app.plan(json);
    await Promise.all([app.session({ type: "apply", id: 1 }), app.session({ type: "plan", id: 2, json })]);
    expect(app.last()).toMatchObject({ type: "plan", summary: { create: [], unchanged: 1 } });
  });

  it("applies only the plan on screen", async () => {
    const app = plugin();
    await app.session({ type: "plan", id: 1, json: tokensJson({ spacing: [8] }) });
    await app.session({ type: "plan", id: 2, json: tokensJson({ spacing: [16] }) });
    await app.session({ type: "apply", id: 1 });
    expect(app.last()).toEqual({
      type: "error",
      message: "The plan changed. Look it over, then press Apply again.",
    });
    expect(app.fake.variables.size).toBe(0);
  });

  it("drops the plan shown when a file that can't be read is picked after it", async () => {
    const app = plugin();
    await app.plan(tokensJson({ spacing: [8] }));
    await app.session({ type: "plan", id: 2, json: "not json" });
    expect(app.last()).toMatchObject({ type: "error", message: expect.stringMatching(/isn't valid JSON/) });
    await app.session({ type: "apply", id: 1 });
    expect(app.last()).toEqual({ type: "error", message: "There's no plan to apply yet." });
    expect(app.fake.variables.size).toBe(0);
  });

  it("ignores a message that isn't one the window sends", async () => {
    const app = plugin();
    await app.plan(tokensJson({ spacing: [8] }));
    await app.session({ type: "delete-everything" });
    await app.session({ type: "apply" });
    await app.session({ type: "apply", id: 1.5 });
    expect([app.sent.length, app.fake.variables.size]).toEqual([1, 0]);
  });

  it("closes only after an apply already under way has finished", async () => {
    const app = plugin();
    await app.plan(tokensJson({ spacing: [8] }));
    let variablesWhenClosed = -1;
    app.fake.api.closePlugin = () => {
      variablesWhenClosed = app.fake.variables.size;
    };
    await Promise.all([app.session({ type: "apply", id: 1 }), app.session({ type: "close" })]);
    expect(variablesWhenClosed).toBe(1);
  });

  it("says the sync stopped partway when Figma fails during an apply", async () => {
    const app = plugin();
    await app.plan(tokensJson({ styles: [{ key: "body", size: 17, weight: 400 }] }));
    app.fake.api.createTextStyle = () => {
      throw new Error("Figma is unavailable");
    };
    await app.session({ type: "apply", id: 1 });
    expect(app.last()).toEqual({
      type: "error",
      message: "The sync stopped partway. Pick tokens.json again to see what is left. (Figma is unavailable)",
    });
  });
});
