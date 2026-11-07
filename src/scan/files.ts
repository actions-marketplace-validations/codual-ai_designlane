import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const IGNORED_DIRS = new Set([
  "node_modules",
  "build",
  "dist",
  "DerivedData",
  "Pods",
  "Carthage",
  "vendor",
  "coverage",
  "__snapshots__",
]);

const MAX_FILES = 20_000;
/** Larger files are generated or data, not hand-written UI. */
const MAX_FILE_BYTES = 512 * 1024;

export interface SourceFile {
  /** Relative to the project root, with forward slashes on every platform. */
  rel: string;
  abs: string;
}

export interface FileList {
  files: SourceFile[];
  /** The walk stopped at the file limit. */
  truncated: boolean;
  /** Folders that couldn't be read, relative to the root. */
  unreadable: string[];
}

/** Lists the project's files, skipping hidden folders, dependencies, build output and symlinks. */
export async function listFiles(root: string): Promise<FileList> {
  const list: FileList = { files: [], truncated: false, unreadable: [] };
  const walk = async (dir: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      list.unreadable.push(toRel(root, dir));
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (list.files.length >= MAX_FILES) {
        list.truncated = true;
        return;
      }
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory() && !IGNORED_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
        await walk(abs);
      } else if (entry.isFile()) {
        list.files.push({ abs, rel: toRel(root, abs) });
      }
    }
  };
  await walk(root);
  return list;
}

/** A file's text, or undefined when it's missing, unreadable or too large to be source. */
export async function readText(abs: string): Promise<string | undefined> {
  try {
    if ((await stat(abs)).size > MAX_FILE_BYTES) return undefined;
    return await readFile(abs, "utf8");
  } catch {
    return undefined;
  }
}

const toRel = (root: string, abs: string) => path.relative(root, abs).split(path.sep).join("/");
