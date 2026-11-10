import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ScanResult } from "../scan/types.js";
import { toDesignMd } from "./design-md.js";
import { toDesignTokens } from "./tokens-json.js";

/** Where the outputs go inside the app, unless told otherwise. */
export const OUTPUT_DIR = "designmap";

/** Writes tokens.json and DESIGN.md into `outDir` (by default `designmap/` in the app) and returns their paths. */
export async function writeOutputs(scan: ScanResult, outDir = path.join(scan.root, OUTPUT_DIR)) {
  await mkdir(outDir, { recursive: true });
  const tokens = path.join(outDir, "tokens.json");
  const design = path.join(outDir, "DESIGN.md");
  await writeFile(tokens, `${JSON.stringify(toDesignTokens(scan), null, 2)}\n`);
  await writeFile(design, toDesignMd(scan));
  return { tokens, design };
}
