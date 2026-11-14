/** Writes catalog.html and drift.md, which read the app's code again for its components and plain values. */

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { type ComponentInfo, inventory } from "../catalog/components.js";
import { readSources } from "../catalog/sources.js";
import { findDrift } from "../drift/drift.js";
import { loadPreviews } from "../previews/previews.js";
import type { ScanResult } from "../scan/types.js";
import { toCatalogHtml } from "./catalog-html.js";
import { toDriftMd } from "./drift-md.js";

const CATALOG_FILE = "catalog.html";
const DRIFT_FILE = "drift.md";

/** Writes the catalog into `outDir`, with the pictures saved there, and returns its path. */
export async function writeCatalog(
  scan: ScanResult,
  components: ComponentInfo[],
  outDir: string,
): Promise<string> {
  const file = path.join(outDir, CATALOG_FILE);
  await writeFile(file, toCatalogHtml(scan, components, await loadPreviews(outDir, components)));
  return file;
}

export async function writeReports(scan: ScanResult, outDir: string) {
  const sources = await readSources(scan);
  const components = inventory(scan, sources);
  const catalog = await writeCatalog(scan, components, outDir);
  const drift = path.join(outDir, DRIFT_FILE);
  await writeFile(drift, toDriftMd(scan, findDrift(scan, sources, components)));
  return { catalog, drift };
}
