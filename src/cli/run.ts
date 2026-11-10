import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { writeOutputs } from "../output/write.js";
import { scanRepo } from "../scan/index.js";
import type { ScanResult } from "../scan/types.js";

const HELP = `designmap: map a mobile app's design system from its code

Usage
  designmap [dir]   Read the app in dir (default: here) and write designmap/tokens.json and designmap/DESIGN.md

Options
  --out <dir>       Write the files here instead
  --json            Print the whole scan as JSON instead of writing files
  -v, --version
  -h, --help
`;

export interface Output {
  out: (text: string) => void;
  error: (text: string) => void;
}

/** Runs the command line with `argv` (without `node` and the script), and returns the exit code. */
export async function run(argv: string[], { out, error }: Output): Promise<number> {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv);
  } catch (e) {
    error(`designmap: ${(e as Error).message}\n\n${HELP}`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.help) return done(out, HELP);
  if (values.version) return done(out, await version());
  if (positionals.length > 1) {
    error(`designmap: expected one folder, got ${positionals.length}\n\n${HELP}`);
    return 2;
  }
  const root = path.resolve(positionals[0] ?? ".");
  if (!(await isFolder(root))) {
    error(`designmap: not a folder: ${root}`);
    return 1;
  }
  const scan = await scanRepo(root);
  if (values.json) return done(out, JSON.stringify(scan, null, 2));
  if (scan.frameworks.length === 0) {
    error(`designmap: no SwiftUI code found in ${scan.root}`);
    return 1;
  }
  out(summary(scan));
  const written = await writeOutputs(scan, values.out ? path.resolve(values.out) : undefined);
  out(`Wrote ${shown(written.tokens)}\n      ${shown(written.design)}`);
  return 0;
}

const parse = (argv: string[]) =>
  parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });

function done(out: Output["out"], text: string): number {
  out(text);
  return 0;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** What was found, in a few lines. */
function summary(scan: ScanResult): string {
  return scan.frameworks
    .map(({ screens, tokens }) => {
      const pages = screens.filter((s) => s.kind === "screen").length;
      const colours = tokens.colors.length + tokens.colorsOmitted;
      const styles = tokens.typeStyles.length + tokens.typeStylesOmitted;
      const lines = [
        `${path.basename(scan.root)}: ${plural(pages, "screen")}, ${plural(screens.length - pages, "component")}`,
        `  ${plural(colours, "colour")}, ${plural(styles, "text style")}`,
      ];
      const top = tokens.colors.slice(0, 3).map((c) => `${c.name} (${c.uses})`);
      if (top.length) lines.push(`  most used colours: ${top.join(", ")}`);
      return lines.join("\n");
    })
    .join("\n");
}

async function isFolder(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isDirectory();
  } catch {
    return false;
  }
}

/** A path relative to where the command was run, unless it's outside it. */
function shown(file: string): string {
  const relative = path.relative(process.cwd(), file);
  return relative.startsWith("..") ? file : relative;
}

async function version(): Promise<string> {
  const manifest = new URL("../../package.json", import.meta.url);
  return JSON.parse(await readFile(manifest, "utf8")).version;
}
