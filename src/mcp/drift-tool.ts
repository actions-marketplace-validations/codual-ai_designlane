/** The MCP tool that checks code an agent wrote against the app's own design system. */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { inventory } from "../catalog/components.js";
import { readSources } from "../catalog/sources.js";
import { type DriftReport, findDrift, type Location } from "../drift/drift.js";
import { appPath, withApp } from "./app.js";

/** How many places an item lists before counting the rest. */
const MAX_PLACES = 5;

const places = (uses: Location[]) =>
  `${uses
    .slice(0, MAX_PLACES)
    .map((u) => `${u.file}:${u.line}`)
    .join(", ")}${uses.length > MAX_PLACES ? ` +${uses.length - MAX_PLACES} more` : ""}`;

/** `report` with only what happens in `only`, when given: places elsewhere dropped, and items left with none. Text
 * styles written in place are counted, not located, so they're kept for the whole app. */
function within(report: DriftReport, only: ReadonlySet<string> | undefined): DriftReport {
  if (!only) return report;
  const keep = <T extends { uses: Location[] }>(items: T[]) =>
    items.map((i) => ({ ...i, uses: i.uses.filter((u) => only.has(u.file)) })).filter((i) => i.uses.length);
  return {
    colors: keep(report.colors),
    scale: keep(report.scale),
    typeStyles: report.typeStyles,
    duplicates: report.duplicates.filter((d) => only.has(d.first.file) || only.has(d.second.file)),
  };
}

function describeDrift(report: DriftReport, filtered: boolean): string {
  const lines: string[] = [];
  if (report.colors.length)
    lines.push(
      "Colours written as values:",
      ...report.colors.map(
        (c) =>
          `- ${c.value} → ${c.token ? `use ${c.token.reference ?? c.token.key}` : "no named colour has this value: add one, or use the nearest"} · ${places(c.uses)}`,
      ),
    );
  if (report.scale.length)
    lines.push(
      "Spacing and corners off the scale the code uses:",
      ...report.scale.map(
        (s) =>
          `- ${s.kind === "spacing" ? "spacing" : "corner radius"} ${s.value}, beside ${s.nearest} (used ${s.nearestUses}×): use the value on the scale, written the way the code writes it · ${places(s.uses)}`,
      ),
    );
  if (report.typeStyles.length)
    lines.push(
      filtered
        ? "Text styles written in place, anywhere in the app (counted, not located, so not just in these files):"
        : "Text styles written in place:",
      ...report.typeStyles.map((t) => `- ${t.name} (${t.uses}×) → use ${t.token.reference ?? t.token.key}`),
    );
  if (report.duplicates.length)
    lines.push(
      "Near-duplicate components:",
      ...report.duplicates.map(
        (d) =>
          `- ${d.first.name} (${d.first.file}) and ${d.second.name} (${d.second.file}) are ${Math.round(d.similarity * 100)}% the same: reuse one`,
      ),
    );
  return lines.length ? lines.join("\n") : filtered ? "No drift in these files." : "No drift found.";
}

export function registerDriftTool(
  server: McpServer,
  repo: z.ZodOptional<z.ZodString>,
  rootOf: (r?: string) => string,
) {
  server.registerTool(
    "check_drift",
    {
      title: "Check drift",
      description:
        "Call after writing UI code. Returns colours written as values (with the named colour to use, when one matches), spacing and corner values off the scale the code uses, text styles written in place that a named one matches, and near-duplicate components. Pass the files you changed to check just those.",
      inputSchema: {
        repo,
        files: z
          .array(z.string())
          .max(200)
          .optional()
          .describe("Paths of the files to check, from the app's folder"),
      },
      annotations: { readOnlyHint: true },
    },
    ({ repo: r, files }) =>
      withApp(rootOf(r), async (scan) => {
        const sources = await readSources(scan);
        const report = findDrift(scan, sources, inventory(scan, sources));
        const only = files?.length ? new Set(files.map((f) => appPath(scan.root, f))) : undefined;
        return describeDrift(within(report, only), only !== undefined);
      }),
  );
}
