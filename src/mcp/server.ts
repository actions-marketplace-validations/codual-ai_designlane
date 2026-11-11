/** The MCP server: hands a coding agent the app's design system while it builds, so new screens match the app. */

import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toDesignMd } from "../output/design-md.js";
import { isFolder, readGaps } from "../scan/files.js";
import { scanRepo } from "../scan/index.js";
import { themesOutsideNote } from "../scan/themes-outside.js";
import { type ScanResult, type ScreenRef, SUPPORTED_FRAMEWORKS } from "../scan/types.js";

const INSTRUCTIONS = `Designmap reads this app's design system from its code.
When you build or change UI in this app:
1. Call get_design_system first. Prefer the app's most used colours, text styles, spacing and corner radii over new values.
2. Write values the way the app's code does. A token name is only a label: before using a name in code, search the code for it. If it isn't there (like hex-33a854 or system-15-semibold), write the value itself, in the app's own style.
3. Call find_views before creating a view, and reuse an existing component when one fits.
If a tool says only part of the app was read, its lists are incomplete.`;

/** How many views find_views lists; a narrower query shows the rest. */
const MAX_VIEWS_LISTED = 40;

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };

const text = (t: string): Result => ({ content: [{ type: "text", text: t }] });
const failure = (t: string): Result => ({ isError: true, ...text(t) });

/** Every tool's one way in: reads the app the call names, notes when only part of it could be read, and turns any
 * failure into a message the agent can act on. */
async function withApp(root: string, answer: (scan: ScanResult) => string): Promise<Result> {
  try {
    if (!(await isFolder(root))) return failure(`Not a folder: ${root}. Pass the app's folder as repo.`);
    const scan = await scanRepo(root);
    const gaps = [readGaps(scan), themesOutsideNote(scan)].filter(Boolean).join(" ");
    if (!scan.frameworks.length)
      return failure([`No ${SUPPORTED_FRAMEWORKS} code found in ${root}.`, gaps].filter(Boolean).join(" "));
    return text(`${gaps ? `${gaps}\n\n` : ""}${answer(scan)}`);
  } catch (e) {
    return failure(`Designmap couldn't read ${root}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

const listed = (v: ScreenRef) => `- ${v.name} (${v.kind}) ${v.file}:${v.line}`;

function views(scan: ScanResult, query?: string, kind?: ScreenRef["kind"]): string {
  const q = query?.toLowerCase();
  const found = scan.frameworks
    .flatMap((f) => f.screens)
    .filter((v) => (!kind || v.kind === kind) && (!q || v.name.toLowerCase().includes(q)));
  if (!found.length) return "No matching views.";
  const shown = found.slice(0, MAX_VIEWS_LISTED);
  const more = found.length > shown.length ? ` (showing ${shown.length}; narrow with query or kind)` : "";
  return `${found.length} view${found.length === 1 ? "" : "s"}${more}:\n${shown.map(listed).join("\n")}`;
}

/** A server reading the app at `defaultRoot`, or at the `repo` a tool call names. */
export function createServer(defaultRoot: string, version: string): McpServer {
  const server = new McpServer({ name: "designmap", version }, { instructions: INSTRUCTIONS });
  const repo = z
    .string()
    .optional()
    .describe(`The app's folder. Defaults to ${defaultRoot}; a relative path is read from there`);
  const rootOf = (r?: string) => path.resolve(defaultRoot, r ?? ".");
  const annotations = { readOnlyHint: true } as const;

  server.registerTool(
    "get_design_system",
    {
      title: "Get the design system",
      description:
        "Call before building or restyling any UI in the app. Returns its DESIGN.md: colours and text styles most used first, with use counts and the file each is declared in, plus spacing, corner radii, screens and components. Token names are labels: search the code for one before using it.",
      inputSchema: { repo },
      annotations,
    },
    ({ repo: r }) => withApp(rootOf(r), toDesignMd),
  );

  server.registerTool(
    "find_views",
    {
      title: "Find views",
      description:
        "Call before creating a view, to reuse one the app already has. Returns its screens and components whose names contain the query, with the file and line of each.",
      inputSchema: {
        repo,
        query: z.string().optional().describe("Part of a name, e.g. Button or Row"),
        kind: z.enum(["screen", "component"]).optional(),
      },
      annotations,
    },
    ({ repo: r, query, kind }) => withApp(rootOf(r), (scan) => views(scan, query, kind)),
  );

  return server;
}
