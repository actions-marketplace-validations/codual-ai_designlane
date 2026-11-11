/** The plugin's window: reads the picked tokens.json, shows the plan in words, and asks the Figma side to apply it. */

import { type PlanSummary, type ToPlugin, toWindow } from "./messages.js";

/** The window's element with `id`, which ui.html must have, of the kind expected. */
function element<T extends HTMLElement>(id: string, kind: new () => T): T {
  const found = document.getElementById(id);
  if (!(found instanceof kind)) throw new Error(`ui.html has no ${kind.name} #${id}`);
  return found;
}

const file = element("file", HTMLInputElement);
const result = element("result", HTMLDivElement);
const apply = element("apply", HTMLButtonElement);

const send = (message: ToPlugin) => parent.postMessage({ pluginMessage: message }, "*");

/** The latest file picked, and the plan on screen: only that file's plan is shown, and only the plan shown applied. */
let picked = 0;
let shown: number | undefined;

/** A heading and a list, built from text only so a token's name can never be read as markup. */
function section(title: string, items: readonly string[]): HTMLElement {
  const block = document.createElement("section");
  const heading = document.createElement("h2");
  heading.textContent = `${title} (${items.length})`;
  const list = document.createElement("ul");
  for (const item of items) {
    const row = document.createElement("li");
    row.textContent = item;
    list.append(row);
  }
  block.append(heading, list);
  return block;
}

function paragraph(text: string, className = ""): HTMLElement {
  const p = document.createElement("p");
  p.className = className;
  p.textContent = text;
  return p;
}

function showPlan(id: number, summary: PlanSummary): void {
  shown = id;
  const blocks = [
    ["New", summary.create],
    ["Changed", summary.update],
    ["Back in the code", summary.restore],
    ["Renamed in the code", summary.rename.map(({ from, to }) => `${from} → ${to}`)],
    ["No longer in the code (marked deprecated, not deleted)", summary.deprecate],
    ["Left out: this file doesn't have their font", summary.missingFonts],
  ] as const;
  const notes = [
    [
      summary.darkLeftOut,
      "Dark values are left out: the Designmap collection couldn't take a Dark mode on this Figma plan. Apply tries again.",
    ],
    [summary.partial, "The scan couldn't read the whole app, so nothing is marked deprecated."],
    [summary.renamesSkipped, "Too much changed at once to spot renames, so renamed tokens show as new."],
  ] as const;
  result.replaceChildren(
    ...blocks.filter(([, items]) => items.length > 0).map(([title, items]) => section(title, items)),
    paragraph(`${summary.unchanged} unchanged.`),
    ...notes.filter(([shows]) => shows).map(([, text]) => paragraph(text, "note")),
  );
  apply.disabled = !summary.applicable;
}

file.addEventListener("change", async () => {
  const id = ++picked;
  shown = undefined;
  apply.disabled = true;
  result.replaceChildren();
  const chosen = file.files?.[0];
  if (!chosen) return;
  result.replaceChildren(paragraph(`Reading ${chosen.name}…`));
  try {
    const json = await chosen.text();
    if (id === picked) send({ type: "plan", id, json });
  } catch {
    if (id === picked)
      result.replaceChildren(paragraph("That file couldn't be read. Pick it again.", "error"));
  } finally {
    // So picking the same file again, after it changed, plans it again.
    file.value = "";
  }
});
apply.addEventListener("click", () => {
  if (shown === undefined) return;
  apply.disabled = true;
  file.disabled = true;
  send({ type: "apply", id: shown });
  shown = undefined;
});
element("close", HTMLButtonElement).addEventListener("click", () => send({ type: "close" }));

window.onmessage = (event: MessageEvent<unknown>) => {
  const data = event.data;
  const message = toWindow(
    typeof data === "object" && data !== null && "pluginMessage" in data ? data.pluginMessage : undefined,
  );
  if (!message) return;
  if (message.type === "plan" && message.id !== picked) return;
  file.disabled = false;
  if (message.type === "plan") showPlan(message.id, message.summary);
  else if (message.type === "applied") {
    const done = message.notes.length
      ? "Synced, with the notes below."
      : "Synced. Your variables and text styles now match the code.";
    result.replaceChildren(paragraph(done), ...message.notes.map((note) => paragraph(note, "note")));
  } else {
    shown = undefined;
    apply.disabled = true;
    result.replaceChildren(paragraph(message.message, "error"));
  }
};
