import type { ViewFacts } from "../scan/classify.js";
import type { SourceFile } from "../scan/files.js";
import type { DesignTokens, FrameworkId, Platform } from "../scan/types.js";

export interface ScanContext {
  root: string;
  files: SourceFile[];
  /** True when the project had more files than the scan reads. */
  truncated: boolean;
  /** Folders that couldn't be read. */
  unreadable: string[];
  /** Reads a file's text, or undefined when it's missing or too large to be source. */
  read(file: SourceFile): Promise<string | undefined>;
}

/**
 * One framework Designmap understands. Supporting a new framework means writing one of these: how to detect it,
 * the facts about each of its views (the shared classifier decides screens from those), and its design tokens.
 */
export interface FrameworkPlugin {
  id: FrameworkId;
  platforms: Platform[];
  detect(ctx: ScanContext): Promise<boolean>;
  views(ctx: ScanContext): Promise<ViewFacts[]>;
  extractTokens(ctx: ScanContext): Promise<DesignTokens>;
}
