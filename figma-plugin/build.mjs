// Bundles the plugin: its Figma side into dist/code.js, and its window into dist/ui.html with the script inlined,
// since Figma loads a plugin's window from one HTML string.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = new URL(".", import.meta.url);
const options = {
  bundle: true,
  minify: true,
  write: false,
  format: "iife",
  target: "es2020",
  logLevel: "warning",
};

const code = await build({ ...options, entryPoints: [fileURLToPath(new URL("src/code.ts", here))] });
const ui = await build({ ...options, entryPoints: [fileURLToPath(new URL("src/ui.ts", here))] });
const page = await readFile(new URL("src/ui.html", here), "utf8");

await mkdir(new URL("dist", here), { recursive: true });
await writeFile(new URL("dist/code.js", here), code.outputFiles[0].text);
await writeFile(
  new URL("dist/ui.html", here),
  page.replace("__UI_SCRIPT__", () => ui.outputFiles[0].text),
);
