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

/** What a plugin found in one framework's code. */
export interface FrameworkFindings {
  views: ViewFacts[];
  tokens: DesignTokens;
  /** Theme objects the code reads its design from that are defined outside the project, in a library. */
  themesOutside?: string[];
}

/**
 * One framework Designmap understands. Supporting a new framework means writing one `scan`: the facts about each of
 * its views (the shared classifier decides screens from those) and its design tokens, or nothing when the project
 * doesn't use the framework.
 */
export interface FrameworkPlugin {
  id: FrameworkId;
  platforms: Platform[];
  /** False while the plugin reads only design tokens, so no screens means none were looked for. */
  screensRead?: false;
  scan(ctx: ScanContext): Promise<FrameworkFindings | undefined>;
}
